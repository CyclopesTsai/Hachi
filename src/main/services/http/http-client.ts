import { STATUS_CODES } from 'node:http'
import { performance } from 'node:perf_hooks'
import { Agent, ProxyAgent, interceptors, request, type Dispatcher } from 'undici'
import {
  DISPLAY_LIMIT_BYTES,
  MAX_RESPONSE_BYTES,
  type HttpErrorCode,
  type HttpResult,
  type ResponseBody
} from '@shared/http'
import type { BuiltRequest } from './build-request'
import {
  BodyTooLargeError,
  decodeText,
  decompress,
  isTextual,
  parseSetCookie
} from './response-utils'

export interface SendOptions {
  runId: string
  /** Proxy URL, or null to connect directly. */
  proxyUrl: string | null
  proxyAuth: { username: string; password: string } | null
  /** Aborted when the user cancels. */
  signal: AbortSignal
  maxResponseBytes?: number
  displayLimitBytes?: number
  /**
   * Cookie jar (decision 129). With one, redirects are followed here (not by undici)
   * so every response's Set-Cookie is kept and every hop gets its cookies.
   */
  cookies?: CookieHooks
}

export interface CookieHooks {
  header(url: string): string | null
  store(url: string, setCookies: string[]): void
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])

/** Adds the jar's cookies to a typed Cookie header (typed ones win by name). */
export function withJarCookies(
  headers: readonly [string, string][],
  jar: string | null
): [string, string][] {
  if (!jar) return [...headers]
  const index = headers.findIndex(([k]) => k.toLowerCase() === 'cookie')
  if (index < 0) return [...headers, ['Cookie', jar]]
  const typed = (headers[index] as [string, string])[1]
  const names = new Set(typed.split(';').map((p) => p.split('=')[0]?.trim()))
  const extra = jar.split('; ').filter((p) => !names.has(p.split('=')[0]?.trim()))
  if (extra.length === 0) return [...headers]
  const out = [...headers]
  out[index] = [(headers[index] as [string, string])[0], [typed, ...extra].join('; ')]
  return out
}

export interface SendOutcome {
  result: HttpResult
  /** Decoded body bytes (kept in main for "show" / "download"); null on error. */
  body: Buffer | null
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET'
])
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
])

/** Maps any error thrown while sending to an error code + readable message. */
export function classifyError(
  error: unknown,
  cancelled: boolean,
  timedOut: boolean
): { code: HttpErrorCode; message: string } {
  if (error instanceof BodyTooLargeError) {
    return {
      code: 'TOO_LARGE',
      message: `Response is larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`
    }
  }
  if (cancelled) return { code: 'CANCELLED', message: 'Request cancelled' }
  if (timedOut) return { code: 'TIMEOUT', message: 'Request timed out' }

  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { name?: string; code?: string; message?: string; cause?: unknown }
    if (e.message && !messages.includes(e.message)) messages.push(e.message)
    const code = e.code ?? ''
    const name = e.name ?? ''
    if (TIMEOUT_CODES.has(code) || /Timeout/.test(name)) {
      return { code: 'TIMEOUT', message: messages.join(': ') }
    }
    if (/max redirects/i.test(e.message ?? '')) {
      return { code: 'TOO_MANY_REDIRECTS', message: 'Too many redirects' }
    }
    if (/Proxy/.test(name) || code.startsWith('UND_ERR_PRX')) {
      return { code: 'PROXY', message: messages.join(': ') }
    }
    if (TLS_CODES.has(code) || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL')) {
      return { code: 'TLS', message: messages.join(': ') }
    }
    if (NETWORK_CODES.has(code)) return { code: 'NETWORK', message: messages.join(': ') }
    current = e.cause
  }
  return { code: 'UNKNOWN', message: messages.join(': ') || String(error) }
}

function flattenHeaders(raw: Record<string, string | string[] | undefined>): [string, string][] {
  const pairs: [string, string][] = []
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) pairs.push([name.toLowerCase(), v])
  }
  return pairs
}

/** Sends a built request with undici. Never throws: failures come back as `kind: 'error'`. */
export async function sendHttp(built: BuiltRequest, options: SendOptions): Promise<SendOutcome> {
  const started = performance.now()
  const { timeoutMs, validateSSL, followRedirects, maxRedirects } = built.options
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  const displayLimit = options.displayLimitBytes ?? DISPLAY_LIMIT_BYTES
  const tls = { rejectUnauthorized: validateSSL }
  // 0 disables undici's own idle timeouts; the overall timeout is enforced by the signal below.
  const idle = { headersTimeout: timeoutMs, bodyTimeout: timeoutMs }

  const agent: Dispatcher = options.proxyUrl
    ? new ProxyAgent({
        uri: options.proxyUrl,
        ...(options.proxyAuth
          ? {
              token: `Basic ${Buffer.from(
                `${options.proxyAuth.username}:${options.proxyAuth.password}`,
                'utf8'
              ).toString('base64')}`
            }
          : {}),
        requestTls: tls,
        proxyTls: tls,
        ...idle
      })
    : new Agent({ connect: tls, ...idle })
  const manual = options.cookies !== undefined
  const dispatcher =
    followRedirects && maxRedirects > 0 && !manual
      ? agent.compose(
          interceptors.redirect({ maxRedirections: maxRedirects, throwOnMaxRedirect: true })
        )
      : agent

  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null
  const signal = timeoutSignal ? AbortSignal.any([options.signal, timeoutSignal]) : options.signal

  try {
    let hop = { url: built.url, method: built.method, headers: built.headers, body: built.body }
    let sentHeaders: [string, string][] | null = null
    let hops = 0
    let response: Dispatcher.ResponseData
    for (;;) {
      const headers = withJarCookies(hop.headers, options.cookies?.header(hop.url) ?? null)
      sentHeaders ??= headers
      response = await request(hop.url, {
        method: hop.method as Dispatcher.HttpMethod,
        headers: headers.flat(),
        body: hop.body ?? undefined,
        dispatcher,
        signal
      })
      if (!manual) break
      const raw = response.headers['set-cookie']
      options.cookies?.store(hop.url, raw === undefined ? [] : Array.isArray(raw) ? raw : [raw])
      const location = response.headers.location
      if (
        !followRedirects ||
        maxRedirects === 0 ||
        !REDIRECT_CODES.has(response.statusCode) ||
        typeof location !== 'string'
      ) {
        break
      }
      await response.body.dump()
      if (hops >= maxRedirects) throw new Error('max redirects')
      hops++
      const next = new URL(location, hop.url)
      let { method, body } = hop
      let nextHeaders = hop.headers
      // As browsers / undici: 303 (and 301 / 302 after POST) continue with GET, no body.
      const toGet =
        (response.statusCode === 303 && method !== 'HEAD') ||
        ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST')
      if (toGet) {
        method = 'GET'
        body = null
        nextHeaders = nextHeaders.filter(
          ([k]) => !/^content-(type|length|encoding|language|location)$/i.test(k)
        )
      }
      // Credentials stay with their origin.
      if (next.origin !== new URL(hop.url).origin) {
        nextHeaders = nextHeaders.filter(
          ([k]) => !/^(authorization|cookie|proxy-authorization)$/i.test(k)
        )
      }
      hop = { url: next.toString(), method, headers: nextHeaders, body }
    }
    const headersMs = performance.now() - started

    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of response.body) {
      received += (chunk as Buffer).length
      if (received > maxBytes) {
        response.body.destroy()
        throw new BodyTooLargeError()
      }
      chunks.push(chunk as Buffer)
    }
    const totalMs = performance.now() - started

    const headers = flattenHeaders(response.headers)
    const header = (name: string) => headers.find(([k]) => k === name)?.[1]
    const contentType = header('content-type') ?? ''
    const decoded = decompress(Buffer.concat(chunks), header('content-encoding'), maxBytes)

    let body: ResponseBody
    if (decoded.length === 0) body = { kind: 'empty' }
    else if (!isTextual(contentType, decoded)) body = { kind: 'binary' }
    else if (decoded.length > displayLimit) body = { kind: 'large' }
    else body = { kind: 'text', text: decodeText(decoded, contentType) }

    const statusText = response.statusText || STATUS_CODES[response.statusCode] || ''
    const history = (response.context as { history?: unknown[] } | undefined)?.history
    return {
      result: {
        kind: 'response',
        runId: options.runId,
        status: response.statusCode,
        statusText,
        headers,
        cookies: headers
          .filter(([k]) => k === 'set-cookie')
          .flatMap(([, v]) => parseSetCookie(v) ?? []),
        contentType,
        body,
        bodyBytes: decoded.length,
        headerBytes:
          `HTTP/1.1 ${response.statusCode} ${statusText}\r\n`.length +
          headers.reduce((sum, [k, v]) => sum + k.length + v.length + 4, 2),
        timings: { headersMs, totalMs },
        url: built.url,
        requestHeaders: sentHeaders ?? built.headers,
        redirects: manual ? hops : history && history.length > 1 ? history.length - 1 : 0,
        unresolvedVariables: []
      },
      body: decoded
    }
  } catch (error) {
    const { code, message } = classifyError(
      error,
      options.signal.aborted,
      timeoutSignal?.aborted ?? false
    )
    return {
      result: {
        kind: 'error',
        runId: options.runId,
        code,
        message,
        url: built.url,
        timings: { totalMs: performance.now() - started },
        unresolvedVariables: []
      },
      body: null
    }
  } finally {
    void agent.destroy().catch(() => undefined)
  }
}
