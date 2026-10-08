/**
 * Postman Collection (v2.0 / v2.1) and Environment import, Collection v2.1 export.
 * Pure: input is parsed JSON, output is a PortableCollection (or Postman JSON).
 * Mapping rules: docs/schema.md (「匯入 / 匯出」).
 */
import {
  HTTP_METHODS,
  ITEM_NAME_MAX,
  type Auth,
  type HttpMethod,
  type KeyValue,
  type Variable
} from '../schemas/collection'
import {
  httpRequestSchema,
  type FormDataField,
  type HttpBody,
  type HttpRequest,
  type RequestScripts
} from '../schemas/http-request'
import type {
  PortableCollection,
  PortableContainer,
  PortableEnvironment,
  PortableItem
} from './portable'
import { TransferWarnings } from './warnings'

export const POSTMAN_SCHEMA_V21 =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

/** Nesting deeper than this is skipped (protects against hostile files). */
const MAX_DEPTH = 32
/** Items (folders + requests) per import. */
const MAX_ITEMS = 20_000

export type ImportFormat = 'postman-collection' | 'postman-environment'

export class TransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransferError'
  }
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asString = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''

/** Postman descriptions are a string or `{ content }`. */
function description(v: unknown): string | undefined {
  const text = isObject(v) ? asString(v.content) : asString(v)
  return text === '' ? undefined : text
}

function itemName(v: unknown, fallback: string): string {
  const name = asString(v).replace(/\s+/g, ' ').trim()
  return (name === '' ? fallback : name).slice(0, ITEM_NAME_MAX).trim() || fallback
}

/** Which kind of file this is, or null when it is neither. */
export function detectImportFormat(json: unknown): ImportFormat | null {
  if (!isObject(json)) return null
  const info = json.info
  if (isObject(info) && /getpostman\.com\/json\/collection\/v2/i.test(asString(info.schema))) {
    return 'postman-collection'
  }
  if (Array.isArray(json.values)) {
    const scope = asString(json._postman_variable_scope)
    if (scope === 'environment' || scope === 'globals' || typeof json.name === 'string') {
      return 'postman-environment'
    }
  }
  return null
}

/** Explains why a file cannot be imported (for files detectImportFormat rejected). */
export function unsupportedReason(json: unknown): string {
  if (isObject(json) && Array.isArray(json.requests) && Array.isArray(json.order)) {
    return '這是 Postman v1 格式，請在 Postman 中重新匯出成 Collection v2.1'
  }
  if (isObject(json) && isObject(json.info)) {
    return '不支援這個 Collection 格式版本（需要 Postman Collection v2.0 / v2.1）'
  }
  return '無法辨識的檔案：目前支援 Postman Collection（v2.0 / v2.1）與 Postman Environment'
}

// ---------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------

export interface ImportContext {
  newId: () => string
}

const defaultContext: ImportContext = { newId: () => globalThis.crypto.randomUUID() }

function keyValues(list: unknown, ctx: ImportContext): KeyValue[] {
  // v2.0 allows headers as one "Key: value\n…" string.
  if (typeof list === 'string') {
    return list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const at = line.indexOf(':')
        return {
          id: ctx.newId(),
          key: (at < 0 ? line : line.slice(0, at)).trim(),
          value: at < 0 ? '' : line.slice(at + 1).trim(),
          enabled: true
        }
      })
  }
  return asArray(list)
    .filter(isObject)
    .map((row) => {
      const kv: KeyValue = {
        id: ctx.newId(),
        key: asString(row.key),
        value: asString(row.value),
        enabled: row.disabled !== true
      }
      const desc = description(row.description)
      if (desc) kv.description = desc
      return kv
    })
}

function variables(list: unknown, ctx: ImportContext): Variable[] {
  return asArray(list)
    .filter(isObject)
    .map((row) => {
      const v: Variable = {
        id: ctx.newId(),
        key: asString(row.key),
        value: asString(row.value),
        enabled: row.disabled !== true && row.enabled !== false,
        secret: asString(row.type) === 'secret'
      }
      const desc = description(row.description)
      if (desc) v.description = desc
      return v
    })
    .filter((v) => v.key.trim() !== '')
}

/** Value of an auth attribute: v2.1 `[{ key, value }]`, v2.0 `{ key: value }`. */
function authAttr(list: unknown, name: string): string {
  if (Array.isArray(list)) {
    const found = list.find((a) => isObject(a) && a.key === name)
    return isObject(found) ? asString(found.value) : ''
  }
  return isObject(list) ? asString(list[name]) : ''
}

function parseAuth(raw: unknown, fallback: Auth, where: string, warnings: TransferWarnings): Auth {
  if (!isObject(raw)) return fallback
  const type = asString(raw.type).toLowerCase()
  switch (type) {
    case 'noauth':
      return { type: 'none' }
    case 'inherit':
      return { type: 'inherit' }
    case 'bearer':
      return { type: 'bearer', token: authAttr(raw.bearer, 'token') }
    case 'basic':
      return {
        type: 'basic',
        username: authAttr(raw.basic, 'username'),
        password: authAttr(raw.basic, 'password')
      }
    case 'apikey':
      return {
        type: 'apiKey',
        key: authAttr(raw.apikey, 'key'),
        value: authAttr(raw.apikey, 'value'),
        in: authAttr(raw.apikey, 'in') === 'query' ? 'query' : 'header'
      }
    default:
      warnings.add(`不支援的 Auth 類型「${type || '未知'}」，已改為 None`, where)
      return { type: 'none' }
  }
}

/** Postman script APIs the Hachi sandbox does not provide (decision 72). */
const UNSUPPORTED_SCRIPT_APIS: [RegExp, string][] = [
  [/\bpm\.sendRequest\b/, 'pm.sendRequest'],
  [/\bpm\.cookies\b/, 'pm.cookies'],
  [/\bpm\.vault\b/, 'pm.vault'],
  [/\bpm\.execution\b/, 'pm.execution'],
  [/\bpm\.visualizer\b/, 'pm.visualizer'],
  [/\b(pm|postman)\.setNextRequest\b/, 'setNextRequest'],
  [/\bpm\.require\b/, 'pm.require'],
  [/\bsetTimeout\s*\(/, 'setTimeout'],
  [/\b(?:await|async)\b/, 'async / await']
]

export function unsupportedScriptApis(code: string): string[] {
  const found = UNSUPPORTED_SCRIPT_APIS.filter(([re]) => re.test(code)).map(([, name]) => name)
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (m[1] !== 'crypto-js') found.push(`require('${m[1]}')`)
  }
  return [...new Set(found)]
}

function parseScripts(events: unknown, where: string, warnings: TransferWarnings) {
  const scripts: RequestScripts = { preRequest: '', postResponse: '' }
  let found = false
  for (const event of asArray(events)) {
    if (!isObject(event) || !isObject(event.script)) continue
    const exec = event.script.exec
    const code = (Array.isArray(exec) ? exec.map(asString).join('\n') : asString(exec)).trim()
    if (code === '') continue
    if (event.disabled === true) {
      warnings.add('停用的腳本未匯入', where)
      continue
    }
    const listen = asString(event.listen)
    const unsupported = unsupportedScriptApis(code)
    if (unsupported.length > 0) {
      warnings.add(`腳本使用了 Hachi 不支援的寫法：${unsupported.join('、')}`, where)
    }
    if (listen === 'prerequest') scripts.preRequest = code
    else if (listen === 'test') scripts.postResponse = code
    else continue
    found = true
  }
  return found ? scripts : null
}

const LANGUAGE_CONTENT_TYPES: Record<string, string> = {
  text: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript'
}

function headerValue(headers: KeyValue[], name: string): string | undefined {
  const row = headers.find((h) => h.enabled && h.key.trim().toLowerCase() === name)
  return row?.value
}

function parseBody(
  raw: unknown,
  headers: KeyValue[],
  ctx: ImportContext,
  where: string,
  warnings: TransferWarnings
): Partial<HttpBody> {
  if (!isObject(raw) || raw.disabled === true) return { mode: 'none' }
  const mode = asString(raw.mode)
  switch (mode) {
    case 'raw': {
      const text = asString(raw.raw)
      const options = isObject(raw.options) && isObject(raw.options.raw) ? raw.options.raw : {}
      const language = asString(options.language).toLowerCase()
      const contentType = headerValue(headers, 'content-type') ?? ''
      if (language === 'json' || (language === '' && /json/i.test(contentType))) {
        return { mode: 'json', json: text }
      }
      return {
        mode: 'raw',
        raw: text,
        rawContentType: contentType || LANGUAGE_CONTENT_TYPES[language] || 'text/plain'
      }
    }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: keyValues(raw.urlencoded, ctx) }
    case 'formdata': {
      const fields: FormDataField[] = asArray(raw.formdata)
        .filter(isObject)
        .map((row) => {
          const isFile = asString(row.type) === 'file'
          const src = row.src
          const files = (Array.isArray(src) ? src : [src]).map(asString).filter((s) => s !== '')
          if (isFile && files.length > 1) {
            warnings.add('Form-data 欄位有多個檔案，只匯入第一個', where)
          }
          return {
            id: ctx.newId(),
            key: asString(row.key),
            enabled: row.disabled !== true,
            type: isFile ? 'file' : 'text',
            value: isFile ? '' : asString(row.value),
            filePath: isFile ? (files[0] ?? '') : ''
          }
        })
      if (fields.some((f) => f.type === 'file')) {
        warnings.add('Form-data 檔案路徑來自原本的電腦，可能需要重新選擇檔案', where)
      }
      return { mode: 'formData', formData: fields }
    }
    case 'graphql': {
      // Postman sends GraphQL as a JSON POST body, so this is exactly what goes on the wire.
      const gql = isObject(raw.graphql) ? raw.graphql : {}
      const varsText = asString(gql.variables).trim()
      let vars: unknown
      if (varsText !== '') {
        try {
          vars = JSON.parse(varsText) as unknown
        } catch {
          warnings.add('GraphQL variables 不是有效的 JSON，未匯入', where)
        }
      }
      const payload =
        vars === undefined
          ? { query: asString(gql.query) }
          : { query: asString(gql.query), variables: vars }
      warnings.add('GraphQL Body 已轉成 JSON Body', where)
      return { mode: 'json', json: JSON.stringify(payload, null, 2) }
    }
    case 'file':
      warnings.add('不支援 Binary（檔案）Body，已改為 none', where)
      return { mode: 'none' }
    case '':
      return { mode: 'none' }
    default:
      warnings.add(`不支援的 Body 類型「${mode}」，已改為 none`, where)
      return { mode: 'none' }
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function parseUrl(
  raw: unknown,
  ctx: ImportContext,
  where: string,
  warnings: TransferWarnings
): { url: string; params: KeyValue[] } {
  if (!isObject(raw)) return { url: asString(raw).trim(), params: [] }
  const query = asArray(raw.query).filter(isObject)
  let url = asString(raw.raw).trim()
  if (url === '') {
    // Structured form only: protocol + host + port + path.
    const protocol = asString(raw.protocol)
    const host = Array.isArray(raw.host) ? raw.host.map(asString).join('.') : asString(raw.host)
    const port = asString(raw.port)
    const pathParts = Array.isArray(raw.path)
      ? raw.path.map((p) => (isObject(p) ? asString(p.value) : asString(p)))
      : asString(raw.path).split('/').filter(Boolean)
    url = `${protocol ? `${protocol}://` : ''}${host}${port ? `:${port}` : ''}${
      pathParts.length > 0 ? `/${pathParts.join('/')}` : ''
    }`
  } else if (query.length > 0) {
    // The query lives in the Params table; keep the URL field without it (hash kept).
    const hashAt = url.indexOf('#')
    const hash = hashAt >= 0 ? url.slice(hashAt) : ''
    const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url
    const q = beforeHash.indexOf('?')
    url = (q >= 0 ? beforeHash.slice(0, q) : beforeHash) + hash
  }

  // Path variables (`/users/:id`): Hachi has none, so their values go into the URL.
  for (const v of asArray(raw.variable).filter(isObject)) {
    const key = asString(v.key)
    const value = asString(v.value)
    if (key === '' || value === '') continue
    url = url.replace(new RegExp(`/:${escapeRegExp(key)}(?=[/?#]|$)`, 'g'), `/${value}`)
  }
  if (/\/:[A-Za-z_][\w-]*(?=[/?#]|$)/.test(url)) {
    warnings.add('網址中有 Path 變數（:name），Hachi 沒有對應功能，請改用 {{變數}}', where)
  }

  const params: KeyValue[] = query.map((row) => {
    const kv: KeyValue = {
      id: ctx.newId(),
      key: asString(row.key),
      value: asString(row.value),
      enabled: row.disabled !== true
    }
    const desc = description(row.description)
    if (desc) kv.description = desc
    return kv
  })
  return { url, params }
}

function parseMethod(raw: unknown, where: string, warnings: TransferWarnings): HttpMethod {
  const method = (asString(raw) || 'GET').toUpperCase()
  if ((HTTP_METHODS as readonly string[]).includes(method)) return method as HttpMethod
  warnings.add(`不支援的 HTTP 方法「${method}」，已改為 GET`, where)
  return 'GET'
}

function parseRequest(
  item: Json,
  name: string,
  where: string,
  ctx: ImportContext,
  warnings: TransferWarnings
): HttpRequest {
  // v2.0 allows `request` to be just the URL string.
  const req: Json = isObject(item.request) ? item.request : { url: asString(item.request) }
  const headers = keyValues(req.header, ctx)
  const { url, params } = parseUrl(req.url, ctx, where, warnings)
  const behavior = isObject(item.protocolProfileBehavior) ? item.protocolProfileBehavior : {}
  if (Array.isArray(item.response) && item.response.length > 0) {
    warnings.add('範例回應（Examples）不會匯入')
  }
  return httpRequestSchema.parse({
    version: 1,
    id: ctx.newId(),
    type: 'http',
    name,
    method: parseMethod(req.method, where, warnings),
    url,
    params,
    headers,
    body: parseBody(req.body, headers, ctx, where, warnings),
    auth: parseAuth(req.auth, { type: 'inherit' }, where, warnings),
    settings: {
      validateSSL: behavior.disableStrictSSL === true ? false : null,
      followRedirects: behavior.followRedirects === false ? false : null
    },
    scripts: parseScripts(item.event, where, warnings) ?? {}
  })
}

interface WalkState {
  ctx: ImportContext
  warnings: TransferWarnings
  items: number
}

function parseItems(
  list: unknown,
  path: string[],
  depth: number,
  state: WalkState
): PortableItem[] {
  const result: PortableItem[] = []
  for (const raw of asArray(list)) {
    if (!isObject(raw)) continue
    const isFolder = Array.isArray(raw.item)
    const name = itemName(raw.name, isFolder ? 'Folder' : 'Untitled')
    const where = [...path, name].join(' / ')
    if (++state.items > MAX_ITEMS) {
      throw new TransferError(`項目超過 ${MAX_ITEMS} 個，無法匯入`)
    }
    if (isFolder) {
      if (depth >= MAX_DEPTH) {
        state.warnings.add(`資料夾超過 ${MAX_DEPTH} 層，更深的項目未匯入`, where)
        continue
      }
      const scripts = parseScripts(raw.event, where, state.warnings)
      if (Array.isArray(raw.variable) && raw.variable.length > 0) {
        state.warnings.add('Postman 資料夾變數不支援，未匯入', where)
      }
      result.push({
        kind: 'folder',
        name,
        headers: [],
        auth: parseAuth(raw.auth, { type: 'inherit' }, where, state.warnings),
        scripts,
        children: parseItems(raw.item, [...path, name], depth + 1, state)
      })
    } else if ('request' in raw) {
      result.push({
        kind: 'request',
        request: parseRequest(raw, name, where, state.ctx, state.warnings)
      })
    } else {
      state.warnings.add('無法辨識的項目，已略過', where)
    }
  }
  return result
}

export interface CollectionImport {
  collection: PortableCollection
  warnings: string[]
}

/** Converts a Postman Collection v2.0 / v2.1 (parsed JSON) to a PortableCollection. */
export function importPostmanCollection(
  json: unknown,
  ctx: ImportContext = defaultContext
): CollectionImport {
  if (detectImportFormat(json) !== 'postman-collection') {
    throw new TransferError(unsupportedReason(json))
  }
  const root = json as Json
  const info = root.info as Json
  const warnings = new TransferWarnings()
  const state: WalkState = { ctx, warnings, items: 0 }
  const scripts = parseScripts(root.event, '', warnings)
  const collection: PortableCollection = {
    name: itemName(info.name, 'Imported Collection'),
    headers: [],
    auth: parseAuth(root.auth, { type: 'none' }, '', warnings),
    variables: variables(root.variable, ctx),
    // Postman runs collection → folder → request scripts in that order (decision 126).
    scriptFlow: 'sequential',
    scripts,
    children: parseItems(root.item, [], 0, state)
  }
  if (collection.auth.type === 'inherit') collection.auth = { type: 'none' }
  return { collection, warnings: warnings.list() }
}

/** Converts a Postman Environment (or Globals) export. `type: "secret"` → secret variable. */
export function importPostmanEnvironment(
  json: unknown,
  ctx: ImportContext = defaultContext
): PortableEnvironment {
  if (detectImportFormat(json) !== 'postman-environment') {
    throw new TransferError(unsupportedReason(json))
  }
  const root = json as Json
  const fallback = asString(root._postman_variable_scope) === 'globals' ? 'Globals' : 'Imported'
  return { name: itemName(root.name, fallback), variables: variables(root.values, ctx) }
}

// ---------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------

export interface CollectionExport {
  json: Json
  /** Paths of WebSocket requests left out (Postman v2.1 has no WebSocket items). */
  skipped: string[]
  warnings: string[]
}

const isActive = (row: KeyValue) => row.enabled && row.key.trim() !== ''

function exportKeyValues(rows: readonly KeyValue[]): Json[] {
  return rows
    .filter((r) => r.key.trim() !== '' || r.value !== '')
    .map((r) => ({
      key: r.key,
      value: r.value,
      ...(r.enabled ? {} : { disabled: true }),
      ...(r.description ? { description: r.description } : {})
    }))
}

function exportAuth(auth: Auth, level: 'collection' | 'item'): Json | undefined {
  const attrs = (pairs: Record<string, string>) =>
    Object.entries(pairs).map(([key, value]) => ({ key, value, type: 'string' }))
  switch (auth.type) {
    case 'inherit':
      return undefined // Postman: no `auth` means inherit
    case 'none':
      return level === 'collection' ? undefined : { type: 'noauth' }
    case 'bearer':
      return { type: 'bearer', bearer: attrs({ token: auth.token }) }
    case 'basic':
      return { type: 'basic', basic: attrs({ username: auth.username, password: auth.password }) }
    case 'apiKey':
      return { type: 'apikey', apikey: attrs({ key: auth.key, value: auth.value, in: auth.in }) }
  }
}

function exportScripts(scripts: RequestScripts | null | undefined): Json[] | undefined {
  if (!scripts) return undefined
  const events: Json[] = []
  const add = (listen: string, code: string) => {
    if (code.trim() === '') return
    events.push({ listen, script: { type: 'text/javascript', exec: code.split('\n') } })
  }
  add('prerequest', scripts.preRequest)
  add('test', scripts.postResponse)
  return events.length > 0 ? events : undefined
}

/** Postman URL object (raw + structured parts) from the URL field and the Params table. */
export function toPostmanUrl(rawUrl: string, params: readonly KeyValue[]): Json {
  const input = rawUrl.trim()
  const hashAt = input.indexOf('#')
  const hash = hashAt >= 0 ? input.slice(hashAt + 1) : ''
  const beforeHash = hashAt >= 0 ? input.slice(0, hashAt) : input
  const q = beforeHash.indexOf('?')
  const base = q >= 0 ? beforeHash.slice(0, q) : beforeHash
  const typed = q >= 0 ? beforeHash.slice(q + 1) : ''

  const query: Json[] = typed
    .split('&')
    .filter((part) => part !== '')
    .map((part) => {
      const eq = part.indexOf('=')
      return eq < 0
        ? { key: part, value: null }
        : { key: part.slice(0, eq), value: part.slice(eq + 1) }
    })
  for (const p of params) {
    if (p.key.trim() === '') continue
    query.push({
      key: p.key.trim(),
      value: p.value,
      ...(p.enabled ? {} : { disabled: true }),
      ...(p.description ? { description: p.description } : {})
    })
  }
  const rawQuery = query
    .filter((p) => p.disabled !== true)
    .map((p) => (p.value === null ? asString(p.key) : `${asString(p.key)}=${asString(p.value)}`))
    .join('&')

  const result: Json = {
    raw: `${base}${rawQuery ? `?${rawQuery}` : ''}${hashAt >= 0 ? `#${hash}` : ''}`
  }
  const m = /^([a-z][a-z\d+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(base)
  const authority = m ? (m[2] ?? '') : (base.split('/')[0] ?? '')
  const pathText = m ? (m[3] ?? '') : base.slice(authority.length)
  if (m) result.protocol = m[1]
  const portMatch = /^(.*):(\d+)$/.exec(authority)
  const hostname = portMatch ? (portMatch[1] ?? '') : authority
  if (hostname !== '') result.host = hostname.split('.')
  if (portMatch) result.port = portMatch[2]
  if (pathText !== '') result.path = pathText.slice(1).split('/')
  if (query.length > 0) result.query = query
  if (hashAt >= 0) result.hash = hash
  return result
}

function exportBody(request: HttpRequest, headers: Json[]): Json | undefined {
  const body = request.body
  switch (body.mode) {
    case 'none':
      return undefined
    case 'json':
      return { mode: 'raw', raw: body.json, options: { raw: { language: 'json' } } }
    case 'raw': {
      const type = body.rawContentType.trim() || 'text/plain'
      const language =
        Object.entries(LANGUAGE_CONTENT_TYPES).find(([, ct]) => ct === type)?.[0] ?? 'text'
      // Postman derives Content-Type from the language; keep any other type explicit.
      const hasType = headers.some((h) => asString(h.key).toLowerCase() === 'content-type')
      if (LANGUAGE_CONTENT_TYPES[language] !== type && !hasType) {
        headers.push({ key: 'Content-Type', value: type })
      }
      return { mode: 'raw', raw: body.raw, options: { raw: { language } } }
    }
    case 'urlencoded':
      return {
        mode: 'urlencoded',
        urlencoded: exportKeyValues(body.urlencoded).map((r) => ({ ...r, type: 'text' }))
      }
    case 'formData':
      return {
        mode: 'formdata',
        formdata: body.formData
          .filter((f) => f.key.trim() !== '')
          .map((f) => ({
            key: f.key,
            type: f.type,
            ...(f.type === 'file' ? { src: f.filePath } : { value: f.value }),
            ...(f.enabled ? {} : { disabled: true })
          }))
      }
  }
}

interface ExportState {
  warnings: TransferWarnings
  skipped: string[]
}

function exportRequest(
  request: HttpRequest,
  inheritedHeaders: readonly KeyValue[],
  where: string,
  state: ExportState
): Json {
  // Postman has no shared headers: copy the inherited ones into every request.
  const own = request.headers
  const added = inheritedHeaders.filter(
    (h) =>
      !own.some((o) => isActive(o) && o.key.trim().toLowerCase() === h.key.trim().toLowerCase())
  )
  const header = exportKeyValues([...own, ...added])
  const s = request.settings
  if (s.timeoutMs !== null) state.warnings.add('請求的逾時設定 Postman 不支援，未匯出', where)
  if (!s.useProxy) state.warnings.add('「不使用 App 的 Proxy」設定 Postman 不支援，未匯出', where)
  const behavior: Json = {}
  if (s.validateSSL === false) behavior.disableStrictSSL = true
  if (s.followRedirects === false) behavior.followRedirects = false

  const req: Json = {
    method: request.method,
    header,
    url: toPostmanUrl(request.url, request.params)
  }
  const body = exportBody(request, header)
  if (body) req.body = body
  const auth = exportAuth(request.auth, 'item')
  if (auth) req.auth = auth
  const result: Json = { name: request.name, request: req }
  const event = exportScripts(request.scripts)
  if (event) result.event = event
  if (Object.keys(behavior).length > 0) result.protocolProfileBehavior = behavior
  return result
}

/** Inner headers replace outer ones with the same name (like sending does). */
function mergeHeaders(outer: readonly KeyValue[], inner: readonly KeyValue[]): KeyValue[] {
  const own = inner.filter(isActive)
  const names = new Set(own.map((h) => h.key.trim().toLowerCase()))
  return [...outer.filter((h) => !names.has(h.key.trim().toLowerCase())), ...own]
}

function exportItems(
  container: PortableContainer,
  inherited: readonly KeyValue[],
  path: string[],
  state: ExportState
): Json[] {
  const headers = mergeHeaders(inherited, container.headers)
  if (container.headers.some(isActive)) {
    state.warnings.add('Postman 沒有共用 Headers：Collection / 資料夾的 Headers 已併入每個請求')
  }
  const items: Json[] = []
  for (const child of container.children) {
    if (child.kind === 'request') {
      const where = [...path, child.request.name].join(' / ')
      if (child.request.type !== 'http') {
        state.skipped.push(where)
        continue
      }
      items.push(exportRequest(child.request, headers, where, state))
    } else {
      const folder: Json = {
        name: child.name,
        item: exportItems(child, headers, [...path, child.name], state)
      }
      const auth = exportAuth(child.auth, 'item')
      if (auth) folder.auth = auth
      const event = exportScripts(child.scripts)
      if (event) folder.event = event
      items.push(folder)
    }
  }
  return items
}

/** Builds a Postman Collection v2.1 document. Secret variable values are left empty. */
export function exportPostmanCollection(
  collection: PortableCollection,
  postmanId: string
): CollectionExport {
  const state: ExportState = { warnings: new TransferWarnings(), skipped: [] }
  const json: Json = {
    info: { _postman_id: postmanId, name: collection.name, schema: POSTMAN_SCHEMA_V21 },
    item: exportItems(collection, [], [], state)
  }
  const auth = exportAuth(collection.auth, 'collection')
  if (auth) json.auth = auth
  const event = exportScripts(collection.scripts)
  if (event) json.event = event
  if (collection.variables.length > 0) {
    json.variable = collection.variables.map((v) => ({
      key: v.key,
      value: v.secret ? '' : v.value,
      type: 'string',
      ...(v.enabled ? {} : { disabled: true }),
      ...(v.description ? { description: v.description } : {})
    }))
    if (collection.variables.some((v) => v.secret)) {
      state.warnings.add('機密變數的值不會匯出（已留空）')
    }
  }
  return { json, skipped: state.skipped, warnings: state.warnings.list() }
}
