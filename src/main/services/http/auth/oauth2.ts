/**
 * OAuth 2.0 (decision 128): Client Credentials, Password and Authorization Code (with
 * PKCE). Tokens live in memory only; an expired one is refreshed with its refresh
 * token, or fetched again (except Authorization Code, which needs the browser).
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuth2Auth } from '@shared/schemas/collection'
import type { OAuth2TokenStatus } from '@shared/http'

export class OAuth2Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuth2Error'
  }
}

export interface OAuth2Token {
  accessToken: string
  tokenType: string
  refreshToken: string | null
  /** ms since epoch; null = the server did not say. */
  expiresAt: number | null
  scope: string | null
  obtainedAt: number
}

/** A form POST to the token URL; the caller sends it (proxy / SSL settings apply). */
export interface TokenRequest {
  url: string
  headers: [string, string][]
  body: string
}

export type PostForm = (request: TokenRequest) => Promise<{ status: number; body: string }>

/** Seconds before expiry when a token is already treated as expired. */
const EXPIRY_SKEW_MS = 30_000
/** How long to wait for the browser to come back (authorization code). */
export const AUTHORIZE_TIMEOUT_MS = 5 * 60_000

const form = (pairs: [string, string][]) =>
  pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

/**
 * Same configuration → same token (values after variable substitution). Changing a
 * secret also gets a new token; secrets are only kept hashed in the key.
 */
export function tokenKey(auth: OAuth2Auth): string {
  const password = auth.grantType === 'password'
  const secrets = createHash('sha256')
    .update(JSON.stringify([auth.clientSecret, password ? auth.password : '']))
    .digest('hex')
  return JSON.stringify([
    auth.grantType,
    auth.accessTokenUrl.trim(),
    auth.authUrl.trim(),
    auth.clientId,
    auth.scope.trim(),
    password ? auth.username : '',
    secrets
  ])
}

export function requireUrl(value: string, label: string): string {
  const text = value.trim()
  if (text === '') throw new OAuth2Error(`OAuth 2.0 的 ${label} 是空的`)
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new OAuth2Error(`OAuth 2.0 的 ${label} 不是有效的網址：${text}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OAuth2Error(`OAuth 2.0 的 ${label} 需要 http:// 或 https://`)
  }
  return url.toString()
}

export function buildTokenRequest(auth: OAuth2Auth, params: [string, string][]): TokenRequest {
  const url = requireUrl(auth.accessTokenUrl, 'Access Token URL')
  const headers: [string, string][] = [
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Accept', 'application/json']
  ]
  const pairs = [...params]
  if (auth.clientAuth === 'header' && auth.clientId !== '') {
    // RFC 6749 §2.3.1: form-encoded before Base64.
    const id = encodeURIComponent(auth.clientId)
    const secret = encodeURIComponent(auth.clientSecret)
    headers.push(['Authorization', `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`])
  } else {
    if (auth.clientId !== '') pairs.push(['client_id', auth.clientId])
    if (auth.clientSecret !== '') pairs.push(['client_secret', auth.clientSecret])
  }
  return { url, headers, body: form(pairs) }
}

/** Parses a token endpoint answer (JSON, or form-encoded as some old servers send). */
export function parseTokenResponse(status: number, body: string, now = Date.now()): OAuth2Token {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    data = Object.fromEntries(new URLSearchParams(body))
  }
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  if (status < 200 || status >= 300 || text(data.error) !== '' || text(data.access_token) === '') {
    const reason = [text(data.error), text(data.error_description)].filter((s) => s !== '')
    const ok = status >= 200 && status < 300
    const detail =
      reason.length > 0
        ? reason.join('：')
        : ok
          ? '回應中沒有 access_token'
          : body.slice(0, 200) || '沒有內容'
    throw new OAuth2Error(`取得 OAuth 2.0 Token 失敗（HTTP ${status}）：${detail}`)
  }
  const expiresIn = Number(text(data.expires_in))
  return {
    accessToken: text(data.access_token),
    tokenType: text(data.token_type) || 'Bearer',
    refreshToken: text(data.refresh_token) || null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
    scope: text(data.scope) || null,
    obtainedAt: now
  }
}

export const isExpired = (token: OAuth2Token, now = Date.now()) =>
  token.expiresAt !== null && token.expiresAt - EXPIRY_SKEW_MS <= now

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** Loopback callback (RFC 8252): only http://127.0.0.1 / localhost / [::1]. */
export function parseCallbackUrl(value: string): { host: string; port: number; path: string } {
  const text = value.trim() === '' ? 'http://127.0.0.1:0/callback' : value.trim()
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new OAuth2Error(`Callback URL 不是有效的網址：${text}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new OAuth2Error('Callback URL 需要是 http://127.0.0.1、http://localhost 或 http://[::1]')
  }
  return { host, port: url.port === '' ? 80 : Number(url.port), path: url.pathname }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Hachi</title>` +
  `<body style="font-family:system-ui,sans-serif;padding:3em;text-align:center">` +
  `<h2>${title}</h2><p>${text}</p></body>`

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface AuthorizeDeps {
  openBrowser(url: string): Promise<void>
  postForm: PostForm
  signal: AbortSignal
  timeoutMs?: number
}

/** Opens the browser, waits for the redirect on the loopback server, exchanges the code. */
export async function authorizationCodeFlow(
  auth: OAuth2Auth,
  deps: AuthorizeDeps
): Promise<OAuth2Token> {
  const authUrl = new URL(requireUrl(auth.authUrl, 'Auth URL'))
  requireUrl(auth.accessTokenUrl, 'Access Token URL')
  const callback = parseCallbackUrl(auth.callbackUrl)
  const state = randomBytes(16).toString('base64url')
  const pkce = auth.pkce ? pkcePair() : null

  let server: Server | null = null
  let timer: NodeJS.Timeout | null = null
  let onAbort: (() => void) | null = null
  try {
    const result = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== callback.path) {
          res.writeHead(404).end()
          return
        }
        const finish = (ok: boolean, text: string) => {
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(PAGE(ok ? '已完成授權' : '授權失敗', escapeHtml(text)))
        }
        const error = url.searchParams.get('error')
        if (error) {
          const description = url.searchParams.get('error_description')
          finish(false, description ?? error)
          reject(new OAuth2Error(`授權失敗：${error}${description ? `：${description}` : ''}`))
          return
        }
        if (url.searchParams.get('state') !== state) {
          finish(false, 'state 不符，已忽略這個回應')
          return
        }
        const code = url.searchParams.get('code')
        if (!code) {
          finish(false, '回應中沒有 code')
          reject(new OAuth2Error('授權伺服器沒有回傳 code'))
          return
        }
        finish(true, '可以關閉這個分頁，回到 Hachi。')
        resolve({ code, redirectUri: redirectUriOf(server, callback) })
      })
      server.on('error', (e) => reject(new OAuth2Error(`無法啟動 Callback 伺服器：${e.message}`)))
      timer = setTimeout(
        () => reject(new OAuth2Error('等待瀏覽器授權逾時')),
        deps.timeoutMs ?? AUTHORIZE_TIMEOUT_MS
      )
      onAbort = () => reject(new OAuth2Error('已取消'))
      deps.signal.addEventListener('abort', onAbort)
    })
    result.catch(() => undefined)

    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(callback.port, callback.host, () => resolve())
    }).catch((e: Error) => {
      throw new OAuth2Error(`無法在 ${callback.host}:${callback.port} 接收 Callback：${e.message}`)
    })
    const redirectUri = redirectUriOf(server, callback)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', auth.clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    if (auth.scope.trim() !== '') authUrl.searchParams.set('scope', auth.scope.trim())
    authUrl.searchParams.set('state', state)
    if (pkce) {
      authUrl.searchParams.set('code_challenge', pkce.challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
    }
    await deps.openBrowser(authUrl.toString())

    const { code } = await result
    const params: [string, string][] = [
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['redirect_uri', redirectUri]
    ]
    if (pkce) params.push(['code_verifier', pkce.verifier])
    // Public clients (PKCE, no secret) identify themselves in the body.
    if (auth.clientSecret === '') params.push(['client_id', auth.clientId])
    const request = buildTokenRequest(
      auth.clientSecret === '' ? { ...auth, clientId: '' } : auth,
      params
    )
    const response = await deps.postForm(request)
    return parseTokenResponse(response.status, response.body)
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) deps.signal.removeEventListener('abort', onAbort)
    const s = server as Server | null
    s?.close()
    s?.closeAllConnections()
  }
}

function redirectUriOf(
  server: Server | null,
  callback: { host: string; port: number; path: string }
): string {
  const port = (server?.address() as AddressInfo | null)?.port ?? callback.port
  const host = callback.host === '::1' ? '[::1]' : callback.host
  return `http://${host}:${port}${callback.path}`
}

export interface OAuth2Deps {
  postForm: PostForm
  openBrowser(url: string): Promise<void>
}

/** In-memory tokens (decision 128) and the flows that get them. */
export class OAuth2Service {
  private readonly tokens = new Map<string, OAuth2Token>()
  /** One fetch at a time per configuration (Runner workers share it). */
  private readonly pending = new Map<string, Promise<OAuth2Token>>()
  private readonly authorizing = new Map<string, AbortController>()

  constructor(private readonly deps: OAuth2Deps) {}

  status(auth: OAuth2Auth, now = Date.now()): OAuth2TokenStatus {
    const token = this.tokens.get(tokenKey(auth))
    if (!token) return { state: 'none', expiresAt: null, refreshable: false, scope: null }
    return {
      state: isExpired(token, now) ? 'expired' : 'valid',
      expiresAt: token.expiresAt,
      refreshable: token.refreshToken !== null,
      scope: token.scope
    }
  }

  cached(auth: OAuth2Auth): OAuth2Token | null {
    return this.tokens.get(tokenKey(auth)) ?? null
  }

  clear(auth: OAuth2Auth): void {
    this.tokens.delete(tokenKey(auth))
  }

  clearAll(): void {
    this.tokens.clear()
  }

  /**
   * The token to send: cached, refreshed, or fetched (client credentials / password).
   * Authorization code needs `authorize()` first.
   */
  async tokenFor(auth: OAuth2Auth): Promise<OAuth2Token> {
    const key = tokenKey(auth)
    const cached = this.tokens.get(key)
    if (cached && !isExpired(cached)) return cached
    return this.once(key, async () => {
      if (cached?.refreshToken) {
        try {
          return await this.refresh(auth, cached.refreshToken)
        } catch (error) {
          if (auth.grantType === 'authorization_code') throw error
        }
      }
      if (auth.grantType === 'authorization_code') {
        throw new OAuth2Error(
          cached
            ? 'OAuth 2.0 Token 已過期，請在 Auth 分頁按「取得 Token」重新授權'
            : '還沒有 OAuth 2.0 Token，請先在 Auth 分頁按「取得 Token」'
        )
      }
      return this.fetchToken(auth)
    })
  }

  /** "取得 Token": always gets a new one (the browser opens for authorization code). */
  async obtain(auth: OAuth2Auth): Promise<OAuth2Token> {
    const key = tokenKey(auth)
    if (auth.grantType !== 'authorization_code') return this.once(key, () => this.fetchToken(auth))
    this.authorizing.get(key)?.abort()
    const controller = new AbortController()
    this.authorizing.set(key, controller)
    try {
      const token = await authorizationCodeFlow(auth, {
        openBrowser: this.deps.openBrowser,
        postForm: this.deps.postForm,
        signal: controller.signal
      })
      this.tokens.set(key, token)
      return token
    } finally {
      if (this.authorizing.get(key) === controller) this.authorizing.delete(key)
    }
  }

  /** Stops waiting for the browser. */
  cancel(auth: OAuth2Auth): boolean {
    const controller = this.authorizing.get(tokenKey(auth))
    controller?.abort()
    return !!controller
  }

  private async once(key: string, fetch: () => Promise<OAuth2Token>): Promise<OAuth2Token> {
    const running = this.pending.get(key)
    if (running) return running
    const promise = fetch()
      .then((token) => {
        this.tokens.set(key, token)
        return token
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return promise
  }

  private async fetchToken(auth: OAuth2Auth): Promise<OAuth2Token> {
    const params: [string, string][] =
      auth.grantType === 'password'
        ? [
            ['grant_type', 'password'],
            ['username', auth.username],
            ['password', auth.password]
          ]
        : [['grant_type', 'client_credentials']]
    if (auth.scope.trim() !== '') params.push(['scope', auth.scope.trim()])
    const response = await this.deps.postForm(buildTokenRequest(auth, params))
    return parseTokenResponse(response.status, response.body)
  }

  private async refresh(auth: OAuth2Auth, refreshToken: string): Promise<OAuth2Token> {
    const params: [string, string][] = [
      ['grant_type', 'refresh_token'],
      ['refresh_token', refreshToken]
    ]
    const response = await this.deps.postForm(buildTokenRequest(auth, params))
    const token = parseTokenResponse(response.status, response.body)
    // Servers may keep the old refresh token valid without sending it again.
    return token.refreshToken ? token : { ...token, refreshToken }
  }
}
