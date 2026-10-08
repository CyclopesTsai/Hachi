/**
 * HTTP Digest authentication (RFC 7616, decision 128): the request is sent once, and
 * again with an `Authorization: Digest …` header when the server answers 401 with a
 * Digest challenge. MD5 / SHA-256 (and their -sess variants), qop "auth" or none.
 */
import { createHash, randomBytes } from 'node:crypto'

export interface DigestChallenge {
  realm: string
  nonce: string
  opaque: string | null
  algorithm: string
  qop: string[]
}

/** Parses `key=value, key="quoted value"` pairs after the scheme name. */
function parseParams(text: string): Map<string, string> {
  const params = new Map<string, string>()
  const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/gi
  for (const m of text.matchAll(re)) {
    const key = (m[1] as string).toLowerCase()
    const value = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : (m[3] ?? '')
    if (!params.has(key)) params.set(key, value)
  }
  return params
}

/**
 * The Digest challenge among `WWW-Authenticate` values (a server may offer several
 * schemes, in one header or several). Null when there is none we can answer.
 */
export function parseDigestChallenge(headers: readonly string[]): DigestChallenge | null {
  for (const header of headers) {
    const at = header.search(/\bDigest\s/i)
    if (at < 0) continue
    // Stop at the next scheme ("…, Basic realm=…") when several share one header.
    const rest = header.slice(at + 'Digest'.length)
    const next = rest.search(/,\s*(?:Basic|Bearer|Negotiate|NTLM)\b/i)
    const params = parseParams(next < 0 ? rest : rest.slice(0, next))
    const nonce = params.get('nonce')
    if (nonce === undefined) continue
    // Echoed back as the server wrote it.
    const algorithm = params.get('algorithm') ?? 'MD5'
    if (!['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS'].includes(algorithm.toUpperCase())) continue
    const qop = (params.get('qop') ?? '')
      .split(',')
      .map((q) => q.trim().toLowerCase())
      .filter((q) => q !== '')
    // Only "auth-int" offered: we would have to hash the body; not supported.
    if (qop.length > 0 && !qop.includes('auth')) continue
    return {
      realm: params.get('realm') ?? '',
      nonce,
      opaque: params.get('opaque') ?? null,
      algorithm,
      qop
    }
  }
  return null
}

export interface DigestInput {
  username: string
  password: string
  method: string
  /** Request target: path + query. */
  uri: string
  challenge: DigestChallenge
  /** Fixed in tests. */
  cnonce?: string
  nc?: number
}

const quote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`

export function digestAuthorization(input: DigestInput): string {
  const { challenge } = input
  const algorithm = challenge.algorithm.toUpperCase()
  const hashName = algorithm.startsWith('SHA-256') ? 'sha256' : 'md5'
  const h = (s: string) => createHash(hashName).update(s, 'utf8').digest('hex')
  const cnonce = input.cnonce ?? randomBytes(8).toString('hex')
  const nc = (input.nc ?? 1).toString(16).padStart(8, '0')
  const useQop = challenge.qop.includes('auth')

  let ha1 = h(`${input.username}:${challenge.realm}:${input.password}`)
  if (algorithm.endsWith('-SESS')) ha1 = h(`${ha1}:${challenge.nonce}:${cnonce}`)
  const ha2 = h(`${input.method}:${input.uri}`)
  const response = useQop
    ? h(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : h(`${ha1}:${challenge.nonce}:${ha2}`)

  const parts = [
    `username=${quote(input.username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(input.uri)}`,
    `algorithm=${challenge.algorithm}`,
    `response=${quote(response)}`
  ]
  if (useQop) parts.push('qop=auth', `nc=${nc}`, `cnonce=${quote(cnonce)}`)
  if (challenge.opaque !== null) parts.push(`opaque=${quote(challenge.opaque)}`)
  return `Digest ${parts.join(', ')}`
}
