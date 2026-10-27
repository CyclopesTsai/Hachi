/**
 * Which client certificate goes to a server (decision 147). Pure: main uses it when
 * connecting, the renderer to show what a request would use.
 */
import type { ClientCertificate } from './schemas/app-config'

const normalize = (host: string) => host.toLowerCase().replace(/^\[|\]$/g, '')

/**
 * The enabled entry for `hostname:port`, the most specific one when several match:
 * the exact host before `*.` patterns (the longer suffix first), then a set port
 * before "every port". `*.example.com` matches subdomains, not example.com itself.
 */
export function matchClientCertificate(
  list: readonly ClientCertificate[],
  hostname: string,
  port: number
): ClientCertificate | null {
  const host = normalize(hostname)
  let best: { entry: ClientCertificate; score: number } | null = null
  for (const entry of list) {
    if (!entry.enabled || (entry.port !== null && entry.port !== port)) continue
    const pattern = normalize(entry.host)
    let score: number
    if (pattern === host) score = 1_000_000
    else if (pattern.startsWith('*.') && host.endsWith(pattern.slice(1))) score = pattern.length
    else continue
    score = score * 2 + (entry.port !== null ? 1 : 0)
    if (!best || score > best.score) best = { entry, score }
  }
  return best?.entry ?? null
}

/** Port of an http(s) / ws(s) URL, the scheme's default when it has none. */
export function portOf(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80
}

/** "api.example.com:8443" / "*.example.com", as lists and messages show an entry. */
export function clientCertHostLabel(entry: Pick<ClientCertificate, 'host' | 'port'>): string {
  const host = entry.host.includes(':') ? `[${entry.host}]` : entry.host
  return entry.port === null ? host : `${host}:${entry.port}`
}

/** The file names of an entry ("client.pem + client-key.pem", "apns.p12"). */
export function clientCertFiles(entry: ClientCertificate): string {
  const name = (p: string) => p.split(/[\\/]/).pop() ?? p
  return entry.type === 'pfx'
    ? name(entry.pfxPath)
    : [entry.certPath, entry.keyPath].filter(Boolean).map(name).join(' + ')
}
