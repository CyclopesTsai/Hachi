import type { ProxySettings } from '@shared/schemas/app-config'

/**
 * Whether `hostname` matches the bypass list. Entries:
 * "*" (everything), "example.com" (exact), "*.example.com" / ".example.com"
 * (the domain and all its subdomains). Case-insensitive; ports are ignored.
 */
export function shouldBypassProxy(hostname: string, bypass: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return bypass.some((raw) => {
    const entry = raw.trim().toLowerCase()
    if (entry === '') return false
    if (entry === '*') return true
    const domain = entry.replace(/^\*?\./, '')
    if (entry.startsWith('.') || entry.startsWith('*.')) {
      return host === domain || host.endsWith(`.${domain}`)
    }
    return host === entry
  })
}

/**
 * Converts the system proxy lookup result (PAC syntax, e.g. "PROXY host:3128; DIRECT")
 * into a proxy URL. Returns null for DIRECT or unsupported entries (SOCKS).
 */
export function parsePacResult(result: string): string | null {
  for (const part of result.split(';')) {
    const [kind, hostPort] = part.trim().split(/\s+/)
    if (!kind || !hostPort) continue
    if (kind.toUpperCase() === 'PROXY') return `http://${hostPort}`
    if (kind.toUpperCase() === 'HTTPS') return `https://${hostPort}`
  }
  return null
}

/** The proxy to use for `targetUrl`, or null to connect directly. */
export async function resolveProxyUrl(
  targetUrl: string,
  settings: ProxySettings,
  useProxy: boolean,
  resolveSystemProxy: (url: string) => Promise<string>
): Promise<string | null> {
  if (!useProxy || settings.mode === 'none') return null
  const { hostname } = new URL(targetUrl)
  if (shouldBypassProxy(hostname, settings.bypass)) return null
  if (settings.mode === 'custom') {
    const url = settings.url.trim()
    if (url === '') return null
    return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`
  }
  return parsePacResult(await resolveSystemProxy(targetUrl))
}
