/**
 * Turns an HTTP request (as edited, possibly unsaved) plus inherited settings into
 * what goes on the wire. Pure except for reading form-data files (injected).
 */
import path from 'node:path'
import { FormData } from 'undici'
import type { Auth, KeyValue } from '@shared/schemas/collection'
import type { HttpBody, HttpRequest } from '@shared/schemas/http-request'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import type { HttpErrorCode, InheritedHeader, InheritedSettings } from '@shared/http'
import type { CodegenBody, CodegenRequest } from '@shared/codegen'

/** A collection / folder in the chain above a request, outermost first. */
export interface ContainerLevel {
  id: string
  name: string
  headers: KeyValue[]
  auth: Auth
}

export class HttpBuildError extends Error {
  constructor(
    readonly code: HttpErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HttpBuildError'
  }
}

export interface EffectiveOptions {
  timeoutMs: number
  validateSSL: boolean
  followRedirects: boolean
  maxRedirects: number
  useProxy: boolean
}

export interface BuiltRequest {
  method: string
  url: string
  headers: [string, string][]
  body: string | FormData | null
  options: EffectiveOptions
}

const isActive = (row: KeyValue): boolean => row.enabled && row.key.trim() !== ''

/**
 * Headers and auth inherited from the containers above an item (outermost first).
 * A header set at an inner level replaces same-named headers from outer levels;
 * auth comes from the nearest level whose auth is not "inherit".
 */
export function resolveInherited(chain: readonly ContainerLevel[]): InheritedSettings {
  let headers: InheritedHeader[] = []
  for (const level of chain) {
    const own = level.headers.filter(isActive)
    const names = new Set(own.map((h) => h.key.trim().toLowerCase()))
    headers = [
      ...headers.filter((h) => !names.has(h.key.trim().toLowerCase())),
      ...own.map((h) => ({ ...h, sourceId: level.id, sourceName: level.name }))
    ]
  }
  let auth: InheritedSettings['auth'] = null
  for (let i = chain.length - 1; i >= 0; i--) {
    const level = chain[i] as ContainerLevel
    if (level.auth.type !== 'inherit') {
      auth = { auth: level.auth, sourceId: level.id, sourceName: level.name }
      break
    }
  }
  return { headers, auth }
}

/** The auth that applies to a request: its own, or the inherited one ("none" if nothing). */
export function effectiveAuth(own: Auth, inherited: InheritedSettings): Auth {
  if (own.type !== 'inherit') return own
  return inherited.auth?.auth ?? { type: 'none' }
}

function encodeQuery(text: string): string {
  return encodeURIComponent(text).replace(/%20/g, '+')
}

/**
 * The URL field as typed plus the enabled Params rows. The query string typed in
 * the URL is kept exactly as written; params are appended after it.
 */
export function buildUrl(
  rawUrl: string,
  params: readonly KeyValue[],
  extra: [string, string][] = [],
  protocols: { default: string; allowed: readonly string[] } = {
    default: 'http',
    allowed: ['http:', 'https:']
  }
): string {
  let input = rawUrl.trim()
  if (input === '') throw new HttpBuildError('INVALID_URL', 'URL is empty')
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) input = `${protocols.default}://${input}`
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new HttpBuildError('INVALID_URL', `Invalid URL: ${rawUrl}`)
  }
  if (!protocols.allowed.includes(url.protocol)) {
    throw new HttpBuildError('INVALID_URL', `Unsupported protocol: ${url.protocol}`)
  }
  const pairs = [
    ...params.filter(isActive).map((p): [string, string] => [p.key.trim(), p.value]),
    ...extra
  ]
  if (pairs.length > 0) {
    const appended = pairs.map(([k, v]) => `${encodeQuery(k)}=${encodeQuery(v)}`).join('&')
    url.search = url.search.length > 1 ? `${url.search}&${appended}` : `?${appended}`
  }
  return url.toString()
}

export function hasHeader(headers: [string, string][], name: string): boolean {
  const lower = name.toLowerCase()
  return headers.some(([k]) => k.toLowerCase() === lower)
}

/** Body content + the content type it implies (null = let the client decide, e.g. multipart). */
export async function buildBody(
  body: HttpBody,
  method: string,
  readFile: (absPath: string) => Promise<Uint8Array>
): Promise<{ body: string | FormData | null; contentType: string | null }> {
  if (method === 'HEAD') return { body: null, contentType: null }
  switch (body.mode) {
    case 'none':
      return { body: null, contentType: null }
    case 'json':
      return { body: body.json, contentType: 'application/json' }
    case 'raw':
      return { body: body.raw, contentType: body.rawContentType || 'text/plain' }
    case 'urlencoded': {
      const text = body.urlencoded
        .filter(isActive)
        .map((row) => `${encodeQuery(row.key.trim())}=${encodeQuery(row.value)}`)
        .join('&')
      return { body: text, contentType: 'application/x-www-form-urlencoded' }
    }
    case 'formData': {
      const form = new FormData()
      for (const field of body.formData) {
        if (!field.enabled || field.key.trim() === '') continue
        if (field.type === 'file') {
          if (!field.filePath) continue
          let data: Uint8Array
          try {
            data = await readFile(field.filePath)
          } catch {
            throw new HttpBuildError('FILE_NOT_FOUND', `File not found: ${field.filePath}`)
          }
          form.append(
            field.key.trim(),
            new Blob([data as Uint8Array<ArrayBuffer>]),
            path.basename(field.filePath)
          )
        } else {
          form.append(field.key.trim(), field.value)
        }
      }
      return { body: form, contentType: null }
    }
  }
}

export interface BuildInput {
  request: HttpRequest
  inherited: InheritedSettings
  workspace: WorkspaceSettings
  userAgent: string
  readFile: (absPath: string) => Promise<Uint8Array>
}

/**
 * Headers (own > inherited) plus auth. Bearer / Basic add `Authorization` unless it
 * was set explicitly; API Key goes to a header or, as `authQuery`, to the query.
 */
export function buildHeaders(
  own: readonly KeyValue[],
  inherited: InheritedSettings,
  auth: Auth
): { headers: [string, string][]; authQuery: [string, string][] } {
  const authQuery: [string, string][] =
    auth.type === 'apiKey' && auth.in === 'query' && auth.key.trim() !== ''
      ? [[auth.key.trim(), auth.value]]
      : []

  // Request headers win over inherited ones with the same name.
  const headers: [string, string][] = own
    .filter(isActive)
    .map((h): [string, string] => [h.key.trim(), h.value])
  for (const h of inherited.headers) {
    if (!hasHeader(headers, h.key.trim())) headers.push([h.key.trim(), h.value])
  }

  // Auth adds its header unless one was set explicitly.
  if (auth.type === 'bearer' && !hasHeader(headers, 'authorization')) {
    headers.push(['Authorization', `Bearer ${auth.token}`])
  } else if (auth.type === 'basic' && !hasHeader(headers, 'authorization')) {
    const token = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')
    headers.push(['Authorization', `Basic ${token}`])
  } else if (auth.type === 'apiKey' && auth.in === 'header' && auth.key.trim() !== '') {
    if (!hasHeader(headers, auth.key.trim())) headers.push([auth.key.trim(), auth.value])
  }
  return { headers, authQuery }
}

export async function buildRequest(input: BuildInput): Promise<BuiltRequest> {
  const { request, inherited, workspace } = input
  const auth = effectiveAuth(request.auth, inherited)
  const { headers, authQuery } = buildHeaders(request.headers, inherited, auth)
  const url = buildUrl(request.url, request.params, authQuery)

  const { body, contentType } = await buildBody(request.body, request.method, input.readFile)
  if (contentType && !hasHeader(headers, 'content-type'))
    headers.push(['Content-Type', contentType])
  if (!hasHeader(headers, 'user-agent')) headers.push(['User-Agent', input.userAgent])
  if (!hasHeader(headers, 'accept')) headers.push(['Accept', '*/*'])

  const s = request.settings
  return {
    method: request.method,
    url,
    headers,
    body,
    options: {
      timeoutMs: s.timeoutMs ?? workspace.timeoutMs,
      validateSSL: s.validateSSL ?? workspace.validateSSL,
      followRedirects: s.followRedirects ?? workspace.followRedirects,
      maxRedirects: workspace.maxRedirects,
      useProxy: s.useProxy
    }
  }
}

export interface CodegenBuild {
  request: CodegenRequest
  /** Set when the URL is not valid; the code then uses the URL field as typed. */
  urlError: string | null
}

/**
 * What code generation needs (decision 69): like buildRequest, but Basic auth stays
 * separate, form-data files are referenced by path, and Hachi's own default headers
 * (User-Agent, Accept) are left out.
 */
export function buildCodegenRequest(input: {
  request: HttpRequest
  inherited: InheritedSettings
  workspace: WorkspaceSettings
}): CodegenBuild {
  const { request, inherited, workspace } = input
  const auth = effectiveAuth(request.auth, inherited)
  const { headers, authQuery } = buildHeaders(
    request.headers,
    inherited,
    auth.type === 'basic' ? { type: 'none' } : auth
  )
  // An explicit Authorization header wins over Basic auth, as when sending.
  const basicAuth =
    auth.type === 'basic' && !hasHeader(headers, 'authorization')
      ? { username: auth.username, password: auth.password }
      : null

  let url = request.url.trim()
  let urlError: string | null = null
  try {
    url = buildUrl(request.url, request.params, authQuery)
  } catch (error) {
    urlError = error instanceof Error ? error.message : String(error)
  }

  const b = request.body
  let body: CodegenBody = { kind: 'none' }
  let contentType: string | null = null
  if (request.method !== 'HEAD') {
    switch (b.mode) {
      case 'json':
        body = { kind: 'text', text: b.json, json: true }
        contentType = 'application/json'
        break
      case 'raw':
        contentType = b.rawContentType || 'text/plain'
        body = { kind: 'text', text: b.raw, json: /json/i.test(contentType) }
        break
      case 'urlencoded':
        body = {
          kind: 'urlencoded',
          fields: b.urlencoded
            .filter(isActive)
            .map((r): [string, string] => [r.key.trim(), r.value])
        }
        contentType = 'application/x-www-form-urlencoded'
        break
      case 'formData':
        body = {
          kind: 'formData',
          fields: b.formData
            .filter((f) => f.enabled && f.key.trim() !== '' && (f.type === 'text' || f.filePath))
            .map((f) =>
              f.type === 'file'
                ? { type: 'file' as const, key: f.key.trim(), path: f.filePath }
                : { type: 'text' as const, key: f.key.trim(), value: f.value }
            )
        }
        break
    }
  }
  if (contentType && !hasHeader(headers, 'content-type'))
    headers.push(['Content-Type', contentType])

  const s = request.settings
  return {
    request: {
      method: request.method,
      url,
      headers,
      basicAuth,
      body,
      options: {
        validateSSL: s.validateSSL ?? workspace.validateSSL,
        followRedirects: s.followRedirects ?? workspace.followRedirects,
        maxRedirects: workspace.maxRedirects,
        timeoutMs: s.timeoutMs ?? workspace.timeoutMs
      }
    },
    urlError
  }
}
