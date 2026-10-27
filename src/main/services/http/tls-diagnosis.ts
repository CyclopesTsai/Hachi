/**
 * TLS diagnosis (decision 132): after a certificate failure, connect once more without
 * verifying, read the chain the server sends, and tell what is wrong with it — a
 * missing intermediate (the "broken chain"), a self-signed or untrusted root, expiry,
 * or a host name mismatch. Only reads; nothing is trusted or re-sent.
 */
import { X509Certificate } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import net from 'node:net'
import tls, { type DetailedPeerCertificate, type TLSSocket } from 'node:tls'
import type { TlsCertInfo, TlsDiagnosis, TlsVerdict } from '@shared/http'
import { msg } from '@shared/i18n'
import type { ClientCertTls } from './client-certs'

export const DIAGNOSIS_TIMEOUT_MS = 10_000
const MAX_CHAIN = 10

let trustStore: X509Certificate[] | null = null
let bundledStore: X509Certificate[] | null = null

/** Certificates from PEM strings; ones that do not parse are skipped. */
export function parseCertificates(pems: readonly string[]): X509Certificate[] {
  return pems.flatMap((pem) => {
    try {
      return [new X509Certificate(pem)]
    } catch {
      return []
    }
  })
}

/** The roots TLS connections here trust (Electron: bundled + the system's). */
export function trusted(): X509Certificate[] {
  if (!trustStore) {
    trustStore = parseCertificates(
      typeof tls.getCACertificates === 'function'
        ? tls.getCACertificates('default')
        : tls.rootCertificates
    )
  }
  return trustStore
}

/** Node's bundled roots: Mozilla's list (decision 142). */
export function bundledRoots(): X509Certificate[] {
  bundledStore ??= parseCertificates(tls.rootCertificates)
  return bundledStore
}

/** For tests: use these roots instead of the real ones. */
export function setTrustStoreForTests(pems: string[] | null): void {
  trustStore = pems ? pems.map((p) => new X509Certificate(p)) : null
}

function field(dn: string, key: string): string | null {
  for (const line of dn.split('\n')) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1)
  }
  return null
}

/** A connection that took too long (a class, so callers need not compare messages). */
export class TimeoutError extends Error {
  constructor() {
    super(msg().tlsCheck.timeout)
    this.name = 'TimeoutError'
  }
}

export const nameOf = (dn: string) =>
  field(dn, 'CN') ?? field(dn, 'O') ?? dn.split('\n')[0] ?? msg().tlsCheck.noName

export function aiaIssuerUrl(cert: X509Certificate): string | null {
  const m = /CA Issuers - URI:(\S+)/.exec(cert.infoAccess ?? '')
  return m ? (m[1] as string) : null
}

const isSelfSigned = (c: X509Certificate) => c.checkIssued(c) && c.verify(c.publicKey)

function info(
  cert: X509Certificate,
  source: TlsCertInfo['source'],
  issuer: X509Certificate | null,
  now: number,
  store: X509Certificate[]
): TlsCertInfo {
  const fingerprint = cert.fingerprint256
  return {
    name: nameOf(cert.subject),
    subject: cert.subject.replace(/\n/g, ', '),
    issuerName: nameOf(cert.issuer),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: new Date(cert.validTo).toISOString(),
    altNames: (cert.subjectAltName ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^(DNS|IP Address):/, ''))
      .filter((s) => s !== ''),
    fingerprint256: fingerprint,
    selfSigned: isSelfSigned(cert),
    source,
    trusted: store.some((t) => t.fingerprint256 === fingerprint),
    expired: Date.parse(cert.validTo) < now,
    notYetValid: Date.parse(cert.validFrom) > now,
    badSignature: issuer !== null && !(cert.checkIssued(issuer) && cert.verify(issuer.publicKey))
  }
}

/** Certificates as the server sent them, leaf first. */
export function sentChain(peer: DetailedPeerCertificate): X509Certificate[] {
  const out: X509Certificate[] = []
  const seen = new Set<string>()
  for (let c: DetailedPeerCertificate | undefined = peer; c && out.length < MAX_CHAIN;) {
    if (!c.raw || seen.has(c.fingerprint256)) break
    seen.add(c.fingerprint256)
    out.push(new X509Certificate(c.raw))
    c = c.issuerCertificate === c ? undefined : c.issuerCertificate
  }
  return out
}

/**
 * Judges a chain (leaf first, as sent) against a list of trusted roots (Hachi's by
 * default). Pure, so tests can feed it certificates directly.
 */
export function analyzeChain(
  host: string,
  certs: X509Certificate[],
  opensslError: string | null,
  now = Date.now(),
  store: X509Certificate[] = trusted()
): Omit<TlsDiagnosis, 'host' | 'port'> {
  if (certs.length === 0) {
    return {
      verdict: 'unavailable',
      summary: msg().tlsCheck.verdicts.noCert,
      advice: msg().tlsCheck.verdicts.noCertAdvice,
      chain: [],
      missing: null,
      opensslError
    }
  }
  const chain = certs.map((c, i) => info(c, 'server', certs[i + 1] ?? null, now, store))
  const last = certs[certs.length - 1] as X509Certificate
  let missing: TlsDiagnosis['missing'] = null
  let anchored = chain[chain.length - 1]?.trusted ?? false
  if (!isSelfSigned(last)) {
    // The root is normally not sent: look for the issuer in the trusted list.
    const root = store.find((t) => last.checkIssued(t) && last.verify(t.publicKey))
    if (root) {
      chain.push(info(root, 'trust-store', null, now, store))
      anchored = true
    } else {
      missing = { name: nameOf(last.issuer), aiaUrl: aiaIssuerUrl(last) }
    }
  }

  const leaf = certs[0] as X509Certificate
  const mismatch = net.isIP(host) ? !leaf.checkIP(host) : !leaf.checkHost(host)
  const verdict: TlsVerdict = mismatch
    ? 'hostname-mismatch'
    : chain.some((c) => c.expired)
      ? 'expired'
      : chain.some((c) => c.notYetValid)
        ? 'not-yet-valid'
        : chain.some((c) => c.badSignature)
          ? 'bad-signature'
          : certs.length === 1 && chain[0]?.selfSigned && !anchored
            ? 'self-signed'
            : missing && !last.ca
              ? 'incomplete-chain' // the last one sent is not a CA: an intermediate is missing
              : missing || !anchored
                ? 'untrusted-root'
                : 'ok'

  const leafInfo = chain[0] as TlsCertInfo
  const v = msg().tlsCheck.verdicts
  const expiredCert = chain.find((c) => c.expired)
  const text: Record<TlsVerdict, [string, string]> = {
    'hostname-mismatch': [
      v.hostname(host),
      v.hostnameAdvice(msg().common.list(leafInfo.altNames) || leafInfo.name)
    ],
    expired: [
      v.expired,
      v.expiredAdvice(expiredCert?.name ?? '', expiredCert?.validTo.slice(0, 10) ?? '')
    ],
    'not-yet-valid': [v.notYetValid, v.notYetValidAdvice],
    'bad-signature': [v.badSignature, v.badSignatureAdvice],
    'self-signed': [v.selfSigned, v.selfSignedAdvice],
    'incomplete-chain': [
      v.incomplete,
      v.incompleteAdvice(chain[chain.length - 1]?.name ?? '', missing?.name ?? '')
    ],
    'untrusted-root': [
      missing
        ? v.issuerUntrusted(missing.name)
        : v.rootUntrusted(chain[chain.length - 1]?.name ?? ''),
      v.untrustedAdvice(!!missing)
    ],
    ok: [v.ok, opensslError ? v.okError(opensslError) : v.okRetry],
    unavailable: ['', '']
  }
  const [summary, advice] = text[verdict]
  return { verdict, summary, advice, chain, missing, opensslError }
}

/** `authorizationError` is a string in some Node versions, an Error in others. */
function opensslCode(error: unknown): string | null {
  if (!error) return null
  if (typeof error === 'string') return error
  const e = error as { code?: unknown; message?: unknown }
  return typeof e.code === 'string'
    ? e.code
    : typeof e.message === 'string'
      ? e.message
      : String(error)
}

export interface Route {
  /** http://host:port of an HTTP proxy, or null to connect directly. */
  proxyUrl: string | null
  proxyAuth: { username: string; password: string } | null
  /** The client certificate a request to this host presents (decision 147). */
  clientCert?: ClientCertTls | null
}

/** A TCP socket to the target, through the proxy's CONNECT when there is one. */
export function tunnel(
  host: string,
  port: number,
  route: Route,
  signal: AbortSignal
): Promise<net.Socket> {
  if (!route.proxyUrl) {
    // Wait for the TCP connection: wrapping a socket still connecting crashes some Node versions.
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port })
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
      signal.addEventListener('abort', () => {
        socket.destroy()
        reject(new TimeoutError())
      })
    })
  }
  return new Promise((resolve, reject) => {
    const proxy = new URL(route.proxyUrl as string)
    const headers: Record<string, string> = { host: `${host}:${port}` }
    if (route.proxyAuth) {
      const token = Buffer.from(`${route.proxyAuth.username}:${route.proxyAuth.password}`)
      headers['proxy-authorization'] = `Basic ${token.toString('base64')}`
    }
    const req = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      signal
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket)
      else {
        socket.destroy()
        reject(new Error(msg().tlsCheck.proxyStatus(res.statusCode)))
      }
    })
    req.on('error', reject)
    req.end()
  })
}

export const DIRECT: Route = { proxyUrl: null, proxyAuth: null }

/** Host and port of an https: / wss: URL; null when it does not parse. */
export function targetOf(url: string): { host: string; port: number } | null {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  return { host: target.hostname.replace(/^\[|\]$/g, ''), port: Number(target.port || 443) }
}

export interface Handshake {
  /** As the server sent them, leaf first. */
  certs: X509Certificate[]
  opensslError: string | null
  /** e.g. TLSv1.3. */
  protocol: string | null
  /** The stapled OCSP response (only asked for with `requestOCSP`); null when none. */
  ocsp: Buffer | null
}

/** One TLS handshake without verifying. Throws on failure, including the timeout. */
export async function handshake(
  host: string,
  port: number,
  route: Route,
  options: tls.ConnectionOptions = {},
  timeoutMs = DIAGNOSIS_TIMEOUT_MS
): Promise<Handshake> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let socket: TLSSocket | null = null
  try {
    const raw = await tunnel(host, port, route, controller.signal)
    let ocsp: Buffer | null = null
    socket = await new Promise<TLSSocket>((resolve, reject) => {
      let s: TLSSocket
      try {
        s = tls.connect({
          ...route.clientCert,
          ...options,
          socket: raw,
          servername: net.isIP(host) ? undefined : host,
          rejectUnauthorized: false
        })
      } catch (error) {
        raw.destroy()
        reject(error)
        return
      }
      s.on('OCSPResponse', (response) => {
        ocsp = response && response.length > 0 ? response : null
      })
      s.once('secureConnect', () => resolve(s))
      s.once('error', reject)
      const abort = () => {
        s.destroy()
        reject(new TimeoutError())
      }
      if (controller.signal.aborted) abort()
      else controller.signal.addEventListener('abort', abort)
    })
    return {
      certs: sentChain(socket.getPeerCertificate(true)),
      opensslError: opensslCode(socket.authorizationError),
      protocol: socket.getProtocol(),
      ocsp
    }
  } finally {
    clearTimeout(timer)
    socket?.destroy()
  }
}

/** Connects without verifying and diagnoses the chain. Never throws. */
export async function diagnoseTls(url: string, route: Route = DIRECT): Promise<TlsDiagnosis> {
  const target = targetOf(url)
  if (!target) return unavailable('', 0, msg().tlsCheck.invalidUrl)
  const { host, port } = target
  try {
    const { certs, opensslError } = await handshake(host, port, route)
    return { host, port, ...analyzeChain(host, certs, opensslError) }
  } catch (error) {
    return unavailable(host, port, error instanceof Error ? error.message : String(error))
  }
}

export function unavailable(
  host: string,
  port: number,
  reason: string,
  summary = msg().tlsCheck.cannotReconnect
): TlsDiagnosis {
  return {
    host,
    port,
    verdict: 'unavailable',
    summary,
    advice: reason,
    chain: [],
    missing: null,
    opensslError: null
  }
}
