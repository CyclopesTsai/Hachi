/**
 * Cookie jar (RFC 6265, decision 129): keeps Set-Cookie from responses and adds the
 * matching cookies to later requests. No public-suffix list: a Domain attribute must
 * match the host and contain a dot. SameSite is kept for display only.
 */
import { isIP } from 'node:net'
import {
  COOKIE_MAX_BYTES,
  COOKIES_MAX,
  COOKIES_MAX_PER_DOMAIN,
  type StoredCookie
} from '@shared/schemas/cookies'
import { parseSetCookie } from './response-utils'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Where cookies are sent from / to, as the jar sees a URL. */
function target(url: string): { host: string; path: string; secure: boolean } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  // Like browsers: http://localhost counts as secure.
  const secure = u.protocol === 'https:' || u.protocol === 'wss:' || LOOPBACK.has(host)
  return { host, path: u.pathname || '/', secure }
}

export function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true
  return isIP(host) === 0 && host.endsWith(`.${domain}`)
}

export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'
}

/** RFC 6265 §5.1.4 default-path. */
function defaultPath(requestPath: string): string {
  if (!requestPath.startsWith('/')) return '/'
  const slash = requestPath.lastIndexOf('/')
  return slash <= 0 ? '/' : requestPath.slice(0, slash)
}

const sameCookie = (a: StoredCookie, b: Pick<StoredCookie, 'name' | 'domain' | 'path'>) =>
  a.name === b.name && a.domain === b.domain && a.path === b.path

export class CookieJar {
  private cookies: StoredCookie[]
  private listeners = new Set<() => void>()

  constructor(cookies: readonly StoredCookie[] = []) {
    this.cookies = [...cookies]
  }

  /** A separate copy (Runner workers with concurrency > 1, decision 129). */
  clone(): CookieJar {
    return new CookieJar(this.cookies)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** Stores the Set-Cookie headers of a response from `url`. */
  store(url: string, setCookies: readonly string[], now = Date.now()): void {
    const from = target(url)
    if (!from || setCookies.length === 0) return
    let changed = false
    for (const header of setCookies) {
      const parsed = parseSetCookie(header)
      if (!parsed || parsed.name === '') continue
      if (parsed.name.length + parsed.value.length > COOKIE_MAX_BYTES) continue
      // A Secure cookie can only be set from a secure origin.
      if (parsed.secure && !from.secure) continue

      let domain = from.host
      let hostOnly = true
      if (parsed.domain !== undefined && parsed.domain !== '') {
        const d = parsed.domain.toLowerCase().replace(/^\./, '')
        if (!domainMatches(from.host, d)) continue
        if (d !== from.host && !d.includes('.')) continue // e.g. Domain=com
        domain = d
        hostOnly = false
      }
      const path = parsed.path?.startsWith('/') ? parsed.path : defaultPath(from.path)

      let expires: number | null = null
      if (parsed.maxAge !== undefined) {
        expires = parsed.maxAge <= 0 ? 0 : now + parsed.maxAge * 1000
      } else if (parsed.expires !== undefined) {
        const t = Date.parse(parsed.expires)
        if (!Number.isNaN(t)) expires = t
      }

      const index = this.cookies.findIndex((c) =>
        sameCookie(c, { name: parsed.name, domain, path })
      )
      const existing = index >= 0 ? this.cookies[index] : undefined
      if (index >= 0) this.cookies.splice(index, 1)
      changed = true
      if (expires !== null && expires <= now) continue // deleted
      this.cookies.push({
        name: parsed.name,
        value: parsed.value,
        domain,
        hostOnly,
        path,
        expires,
        secure: parsed.secure,
        httpOnly: parsed.httpOnly,
        sameSite: parsed.sameSite ?? null,
        createdAt: existing?.createdAt ?? now
      })
    }
    if (changed) {
      this.prune(now)
      this.changed()
    }
  }

  /** `Cookie` header value for a request to `url`, or null when nothing matches. */
  header(url: string, now = Date.now()): string | null {
    const to = target(url)
    if (!to) return null
    const matching = this.cookies
      .filter(
        (c) =>
          (c.expires === null || c.expires > now) &&
          (c.hostOnly ? to.host === c.domain : domainMatches(to.host, c.domain)) &&
          pathMatches(to.path, c.path) &&
          (!c.secure || to.secure)
      )
      // Longer paths first, then older cookies (RFC 6265 §5.4).
      .sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt)
    if (matching.length === 0) return null
    return matching.map((c) => `${c.name}=${c.value}`).join('; ')
  }

  list(now = Date.now()): StoredCookie[] {
    return this.cookies
      .filter((c) => c.expires === null || c.expires > now)
      .sort(
        (a, b) =>
          a.domain.localeCompare(b.domain) ||
          a.path.localeCompare(b.path) ||
          a.name.localeCompare(b.name)
      )
  }

  delete(cookie: Pick<StoredCookie, 'name' | 'domain' | 'path'>): void {
    const before = this.cookies.length
    this.cookies = this.cookies.filter((c) => !sameCookie(c, cookie))
    if (this.cookies.length !== before) this.changed()
  }

  /** Every cookie, or those of one domain. */
  clear(domain?: string): void {
    const before = this.cookies.length
    this.cookies = domain === undefined ? [] : this.cookies.filter((c) => c.domain !== domain)
    if (this.cookies.length !== before) this.changed()
  }

  /** What is saved: expired cookies are dropped. */
  toJSON(now = Date.now()): StoredCookie[] {
    return this.cookies.filter((c) => c.expires === null || c.expires > now)
  }

  private prune(now: number): void {
    this.cookies = this.cookies.filter((c) => c.expires === null || c.expires > now)
    const byDomain = new Map<string, number>()
    // Newest first: the oldest ones go beyond the limits.
    const kept = [...this.cookies]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((c) => {
        const n = (byDomain.get(c.domain) ?? 0) + 1
        byDomain.set(c.domain, n)
        return n <= COOKIES_MAX_PER_DOMAIN
      })
      .slice(0, COOKIES_MAX)
    if (kept.length !== this.cookies.length) {
      const keep = new Set(kept)
      this.cookies = this.cookies.filter((c) => keep.has(c))
    }
  }
}
