/**
 * Certificate check started by hand (decision 142), whether the request succeeds or not:
 * reads the chain the server sends (without verifying, through the same proxy, as the
 * failure diagnosis of decision 132 does) and asks who would trust it — Hachi, Node's
 * bundled (Mozilla) roots, the operating system's verifier and Apple's built-in roots
 * (iOS) — plus TLS versions, OCSP stapling, Certificate Transparency and Apple's rules
 * for TLS certificates. Only reads: nothing is trusted, changed or re-sent.
 */
import { X509Certificate } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import type tls from 'node:tls'
import type {
  CcadbProgram,
  TlsCcadbResult,
  TlsCheckItem,
  TlsCheckResult,
  TlsDiagnosis,
  TlsProgramResult,
  TlsTrustResult,
  TlsVerdict
} from '@shared/http'
import type { SystemTrustVerdict } from '../../platform/types'
import { msg } from '@shared/i18n'
import { CCADB_PROGRAMS, type CcadbRoot, type CcadbSnapshot } from './ccadb'
import {
  aiaIssuerUrl,
  analyzeChain,
  bundledRoots,
  handshake,
  nameOf,
  parseCertificates,
  targetOf,
  TimeoutError,
  trusted,
  unavailable,
  type Handshake,
  type Route
} from './tls-diagnosis'
import { embeddedSctCount, embeddedSctTimes, signatureAlgorithm } from './x509-der'

export interface TlsCheckDeps {
  /** The operating system's verifier; null where there is none. */
  verifySystem?(host: string, pems: string[]): Promise<SystemTrustVerdict | null>
  /** Apple's built-in roots (PEM); null off macOS. */
  appleRoots?(): Promise<string[] | null>
  /** Downloads a missing issuer from its AIA URL (tests replace it). */
  fetchIssuer?(url: string, route: Route): Promise<X509Certificate | null>
  /** The CCADB reports (issue #7); absent: no root program section. */
  ccadb?(): Promise<CcadbSnapshot>
  now?: number
}

type Analysis = Omit<TlsDiagnosis, 'host' | 'port'>

const DAY_MS = 86_400_000
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1'
const ANY_EKU = '2.5.29.37.0'
const EXPIRY_WARNING_DAYS = 30
/** Apple: TLS certificates issued from 2020-09-01 may be valid for at most 398 days. */
const APPLE_MAX_DAYS = 398
const APPLE_VALIDITY_FROM = Date.UTC(2020, 8, 1)
/** Apple: EKU with serverAuth and names in the SAN, for certificates from 2019-07-01. */
const APPLE_EKU_FROM = Date.UTC(2019, 6, 1)
const PROBE_TIMEOUT_MS = 8_000
const AIA_TIMEOUT_MS = 5_000
const AIA_MAX_BYTES = 64 * 1024
const AIA_MAX_DOWNLOADS = 3

const VERSIONS = [
  ['TLSv1.3', 'TLS 1.3'],
  ['TLSv1.2', 'TLS 1.2'],
  ['TLSv1.1', 'TLS 1.1'],
  ['TLSv1', 'TLS 1.0']
] as const satisfies [tls.SecureVersion, string][]

type Support = 'yes' | 'no' | 'unknown'

const errorCode = (error: unknown) =>
  typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : ''
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Errors that say nothing about the server's versions. */
const INCONCLUSIVE = new Set([
  'ERR_SSL_NO_PROTOCOLS_AVAILABLE',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT'
])

/**
 * A handshake that also accepts old protocol versions. OpenSSL 3 refuses TLS 1.0 / 1.1
 * at its default security level; BoringSSL (Electron) has no levels and rejects the
 * setting, so it is dropped there.
 */
async function lenientHandshake(
  host: string,
  port: number,
  route: Route,
  options: tls.ConnectionOptions,
  timeoutMs?: number
): Promise<Handshake> {
  try {
    return await handshake(
      host,
      port,
      route,
      { ...options, ciphers: 'DEFAULT@SECLEVEL=0' },
      timeoutMs
    )
  } catch (error) {
    if (errorCode(error) !== 'ERR_SSL_INVALID_COMMAND') throw error
    return handshake(host, port, route, options, timeoutMs)
  }
}

async function probeVersion(
  host: string,
  port: number,
  route: Route,
  version: tls.SecureVersion
): Promise<Support> {
  try {
    await lenientHandshake(
      host,
      port,
      route,
      { minVersion: version, maxVersion: version },
      PROBE_TIMEOUT_MS
    )
    return 'yes'
  } catch (error) {
    if (error instanceof TimeoutError || INCONCLUSIVE.has(errorCode(error))) return 'unknown'
    if (/Proxy/.test(errorText(error))) return 'unknown'
    return 'no'
  }
}

/** GETs an AIA "CA Issuers" certificate (DER or PEM), through the proxy if there is one. */
export function fetchIssuer(url: string, route: Route): Promise<X509Certificate | null> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return Promise.resolve(null)
  }
  if (target.protocol !== 'http:') return Promise.resolve(null)
  return new Promise((resolve) => {
    const proxy = route.proxyUrl ? new URL(route.proxyUrl) : null
    const headers: Record<string, string> = { host: target.host }
    if (proxy && route.proxyAuth) {
      const token = Buffer.from(`${route.proxyAuth.username}:${route.proxyAuth.password}`)
      headers['proxy-authorization'] = `Basic ${token.toString('base64')}`
    }
    const req = httpRequest(
      {
        host: proxy ? proxy.hostname : target.hostname,
        port: Number((proxy ? proxy.port : target.port) || 80),
        path: proxy ? target.href : `${target.pathname}${target.search}`,
        headers,
        timeout: AIA_TIMEOUT_MS
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          resolve(null)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > AIA_MAX_BYTES) {
            req.destroy()
            resolve(null)
          } else chunks.push(chunk)
        })
        res.on('end', () => {
          try {
            resolve(new X509Certificate(Buffer.concat(chunks)))
          } catch {
            resolve(null) // e.g. a PKCS#7 bundle
          }
        })
        res.on('error', () => resolve(null))
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}

const isSelfSigned = (c: X509Certificate) => c.checkIssued(c) && c.verify(c.publicKey)

/** The root in `store` that issued the last certificate sent (roots are normally not sent). */
function issuerIn(certs: X509Certificate[], store: X509Certificate[]): X509Certificate | null {
  const last = certs[certs.length - 1]
  if (!last || isSelfSigned(last)) return null
  return store.find((t) => last.checkIssued(t) && last.verify(t.publicKey)) ?? null
}

let appleStore: { pems: string[]; certs: X509Certificate[] } | null = null

/** Apple's roots, downloading intermediates the server left out (as iOS does). */
async function appleTrust(
  host: string,
  certs: X509Certificate[],
  route: Route,
  deps: TlsCheckDeps,
  now: number
): Promise<{ analysis: Analysis; downloaded: string[] } | null> {
  const pems = await deps.appleRoots?.().catch(() => null)
  if (!pems || pems.length === 0) return null
  if (appleStore?.pems !== pems) appleStore = { pems, certs: parseCertificates(pems) }
  const store = appleStore.certs
  let chain = certs
  let analysis = analyzeChain(host, chain, null, now, store)
  const downloaded: string[] = []
  for (let i = 0; i < AIA_MAX_DOWNLOADS; i++) {
    const url = analysis.missing?.aiaUrl
    if (!url || !['incomplete-chain', 'untrusted-root'].includes(analysis.verdict)) break
    const issuer = await (deps.fetchIssuer ?? fetchIssuer)(url, route).catch(() => null)
    if (!issuer || chain.some((c) => c.fingerprint256 === issuer.fingerprint256)) break
    chain = [...chain, issuer]
    downloaded.push(nameOf(issuer.subject))
    analysis = analyzeChain(host, chain, null, now, store)
  }
  return { analysis, downloaded }
}

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const CURVES: Record<string, string> = {
  prime256v1: 'P-256',
  secp384r1: 'P-384',
  secp521r1: 'P-521'
}

function keyOf(cert: X509Certificate): { text: string; weak: boolean } {
  const key = cert.publicKey
  const details = key.asymmetricKeyDetails ?? {}
  if (key.asymmetricKeyType === 'rsa' || key.asymmetricKeyType === 'rsa-pss') {
    const bits = details.modulusLength ?? 0
    return { text: `RSA ${bits}`, weak: bits < 2048 }
  }
  if (key.asymmetricKeyType === 'ec') {
    const curve = details.namedCurve ?? ''
    return { text: `ECDSA ${CURVES[curve] ?? curve}`, weak: false }
  }
  return { text: key.asymmetricKeyType ?? msg().tlsCheck.unknown, weak: false }
}

/** Only a self-signed one is a root: the last one sent may be a cross-signed intermediate. */
const ROLE = (i: number, cert: X509Certificate) =>
  i === 0
    ? msg().tlsCheck.roles.leaf
    : isSelfSigned(cert)
      ? msg().tlsCheck.roles.root
      : msg().tlsCheck.roles.intermediate

interface CheckInput {
  certs: X509Certificate[]
  main: Handshake
  versions: Support[]
  /** Whether the chain ends in one of Apple's roots; null when unknown (off macOS). */
  appleAnchored: boolean | null
  ctVerified: boolean | null
  now: number
}

/** Pure: the extra checks of the chain the server sent. */
export function extraChecks(input: CheckInput): TlsCheckItem[] {
  const { certs, main, versions, appleAnchored, now } = input
  const leaf = certs[0] as X509Certificate
  const items: TlsCheckItem[] = []

  // TLS versions
  const named = (want: Support) =>
    VERSIONS.filter((_, i) => versions[i] === want).map(([, name]) => name)
  const yes = named('yes')
  const old = yes.filter((n) => n === 'TLS 1.0' || n === 'TLS 1.1')
  const c = msg().tlsCheck.checks
  const list = msg().common.list
  const parts = [
    yes.length > 0 ? c.supported(list(yes)) : '',
    named('no').length > 0 ? c.unsupported(list(named('no'))) : '',
    named('unknown').length > 0 ? c.untested(list(named('unknown'))) : ''
  ].filter(Boolean)
  const sep = msg().tlsCheck.sep
  items.push({
    id: 'versions',
    label: c.versions,
    status:
      !yes.includes('TLS 1.2') && !yes.includes('TLS 1.3')
        ? 'fail'
        : old.length > 0
          ? 'warn'
          : 'pass',
    detail: `${parts.join(sep)}${old.length > 0 ? c.obsolete(list(old)) : ''}${
      !yes.includes('TLS 1.2') && !yes.includes('TLS 1.3') ? c.needs12 : ''
    }`
  })

  items.push({
    id: 'ocsp-stapling',
    label: c.ocsp,
    status: main.ocsp ? 'pass' : 'info',
    detail: main.ocsp ? c.ocspYes(main.ocsp.length) : c.ocspNo
  })

  // Certificate Transparency: Apple wants 2 SCTs for ≤ 180 days, 3 beyond.
  const from = Date.parse(leaf.validFrom)
  const to = Date.parse(leaf.validTo)
  const lifetimeDays = Math.round((to - from) / DAY_MS)
  const required = lifetimeDays <= 180 ? 2 : 3
  const scts = embeddedSctCount(leaf.raw)
  const enough = (scts ?? 0) >= required || input.ctVerified === true
  items.push({
    id: 'sct',
    label: c.sct,
    status: enough ? 'pass' : appleAnchored === false ? 'info' : 'warn',
    detail: [
      scts === null ? c.sctNone : c.sctCount(scts),
      c.sctRequired(required, lifetimeDays),
      input.ctVerified !== null ? c.sctMac(input.ctVerified) : '',
      enough ? '' : appleAnchored === false ? c.sctPrivate : c.sctMaybe
    ]
      .filter(Boolean)
      .join(sep)
  })

  const last = certs[certs.length - 1] as X509Certificate
  const rootSent = certs.length > 1 && isSelfSigned(last)
  items.push({
    id: 'root-sent',
    label: c.rootSent,
    status: rootSent ? 'warn' : 'pass',
    detail: rootSent ? c.rootSentYes(nameOf(last.subject)) : c.rootSentNo
  })

  // Expiry of everything sent.
  const expired = certs.filter((c) => Date.parse(c.validTo) < now)
  const soon = certs.filter(
    (c) =>
      Date.parse(c.validTo) >= now && Date.parse(c.validTo) - now <= EXPIRY_WARNING_DAYS * DAY_MS
  )
  const daysLeft = (c: X509Certificate) => Math.floor((Date.parse(c.validTo) - now) / DAY_MS)
  items.push({
    id: 'expiry',
    label: c.expiry,
    status: expired.length > 0 ? 'fail' : soon.length > 0 ? 'warn' : 'pass',
    detail:
      expired.length > 0
        ? expired.map((x) => c.expiredOn(nameOf(x.subject), date(Date.parse(x.validTo)))).join(sep)
        : soon.length > 0
          ? soon
              .map((x) =>
                c.expiresSoon(
                  ROLE(certs.indexOf(x), x),
                  nameOf(x.subject),
                  daysLeft(x),
                  date(Date.parse(x.validTo))
                )
              )
              .join(sep)
          : c.validUntil(date(to), daysLeft(leaf))
  })

  // Apple's rules for TLS server certificates.
  const tooLong = lifetimeDays > APPLE_MAX_DAYS && from >= APPLE_VALIDITY_FROM
  items.push({
    id: 'apple-validity',
    label: c.appleValidity,
    status: !tooLong
      ? 'pass'
      : appleAnchored === true
        ? 'fail'
        : appleAnchored === false
          ? 'info'
          : 'warn',
    detail: !tooLong
      ? from < APPLE_VALIDITY_FROM
        ? c.validityOld(lifetimeDays)
        : c.validityOk(lifetimeDays, APPLE_MAX_DAYS)
      : c.validityLong(lifetimeDays, APPLE_MAX_DAYS, appleAnchored === false)
  })

  const keys = certs.map((c, i) => ({ c, i, key: keyOf(c) }))
  const weakKeys = keys.filter((k) => k.key.weak)
  items.push({
    id: 'apple-key',
    label: c.appleKey,
    status: weakKeys.length > 0 ? 'fail' : 'pass',
    detail:
      weakKeys.length > 0
        ? weakKeys.map((k) => c.weakKey(ROLE(k.i, k.c), nameOf(k.c.subject), k.key.text)).join(sep)
        : list(keys.map((k) => `${ROLE(k.i, k.c)} ${k.key.text}`))
  })

  const signatures = certs
    .map((c, i) => ({ c, i, alg: signatureAlgorithm(c.raw) }))
    .filter((s) => !isSelfSigned(s.c)) // a root's own signature is not checked
  const weakSignatures = signatures.filter((s) => s.alg?.weak)
  items.push({
    id: 'apple-signature',
    label: c.appleSignature,
    status: weakSignatures.length > 0 ? 'fail' : 'pass',
    detail:
      weakSignatures.length > 0
        ? weakSignatures
            .map((s) => c.weakSignature(nameOf(s.c.subject), s.alg?.name ?? ''))
            .join(sep)
        : list(signatures.map((s) => s.alg?.name ?? msg().tlsCheck.unknown)) || '—'
  })

  const ekus = leaf.keyUsage
  const ekuOk = !!ekus && (ekus.includes(SERVER_AUTH) || ekus.includes(ANY_EKU))
  const ekuApplies = from >= APPLE_EKU_FROM
  items.push({
    id: 'apple-eku',
    label: c.appleEku,
    status: ekuOk || !ekuApplies ? 'pass' : 'fail',
    detail: ekuOk
      ? c.ekuOk
      : !ekuApplies
        ? c.beforeRule
        : ekus
          ? c.ekuMissingServerAuth(list(ekus))
          : c.ekuNone
  })

  const names = (leaf.subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:') || s.startsWith('IP Address:'))
  items.push({
    id: 'apple-san',
    label: c.appleSan,
    status: names.length > 0 || !ekuApplies ? 'pass' : 'fail',
    detail: names.length > 0 ? c.sanOk(names.length) : !ekuApplies ? c.beforeRule : c.sanNone
  })
  return items
}

const fingerprintHex = (c: X509Certificate) => c.fingerprint256.replace(/:/g, '')
const SERVER_AUTH_EKU = /server auth/i

const programStores = new WeakMap<
  CcadbRoot[],
  { certs: X509Certificate[]; byFingerprint: Map<string, CcadbRoot> }
>()

function programStore(roots: CcadbRoot[]) {
  let store = programStores.get(roots)
  if (!store) {
    store = {
      certs: parseCertificates(roots.map((r) => r.pem)),
      byFingerprint: new Map(roots.map((r) => [r.sha256, r]))
    }
    programStores.set(roots, store)
  }
  return store
}

/**
 * The root of `store` the chain ends at: a certificate sent that is in it (the shortest
 * path first), or a root that issued one.
 */
function anchorIn(certs: X509Certificate[], store: X509Certificate[]): X509Certificate | null {
  const fingerprints = new Set(store.map((c) => c.fingerprint256))
  for (const cert of certs) {
    if (fingerprints.has(cert.fingerprint256)) return cert
    const issuer = store.find((t) => cert.checkIssued(t) && cert.verify(t.publicKey))
    if (issuer) return issuer
  }
  return null
}

/** One program's limits that apply (`reasons`) or do not (yet) apply (`notes`). */
function programLimits(
  program: CcadbProgram,
  root: CcadbRoot,
  leaf: X509Certificate,
  now: number
): { reasons: string[]; notes: string[] } {
  const reasons: string[] = []
  const notes: string[] = []
  const issued = Date.parse(leaf.validFrom)
  const name = root.name
  const t = msg().tlsCheck.programs
  if (program === 'mozilla' && root.distrustAfter) {
    const after = root.distrustAfter
    if (issued >= Date.parse(after) + DAY_MS) {
      reasons.push(t.mozillaDistrust(name, after, date(issued)))
    } else {
      notes.push(t.mozillaDistrustNote(name, after, date(issued)))
    }
  }
  if (program === 'chrome' && root.sctNotAfter) {
    const limit = Date.parse(root.sctNotAfter)
    const times = embeddedSctTimes(leaf.raw)
    const earliest = times.length > 0 ? Math.min(...times) : issued
    const when = date(limit)
    if (earliest > limit) {
      reasons.push(t.chromeSct(name, when, date(earliest)))
    } else {
      notes.push(t.chromeSctNote(name, when, date(earliest)))
    }
  }
  if (program === 'microsoft') {
    const nb = root.notBefore
    if (nb && nb.ekus.some((e) => SERVER_AUTH_EKU.test(e))) {
      if (issued >= Date.parse(nb.date)) {
        reasons.push(t.msNotBefore(name, nb.date, date(issued)))
      } else {
        notes.push(t.msNotBeforeNote(name, nb.date))
      }
    }
    if (root.disabledAfter) {
      if (now >= Date.parse(root.disabledAfter)) {
        reasons.push(t.msDisabled(name, root.disabledAfter))
      } else {
        notes.push(t.msDisabledNote(name, root.disabledAfter))
      }
    }
    if (root.disallowedEkus?.some((e) => SERVER_AUTH_EKU.test(e))) {
      reasons.push(t.msDisallowed(name))
    }
  }
  if (root.constraints) {
    const text =
      root.constraints.length > 200 ? `${root.constraints.slice(0, 200)}…` : root.constraints
    notes.push(t.constraints(text))
  }
  return { reasons, notes }
}

/** Whether one root program includes the chain's root (missing intermediates via AIA). */
async function programResult(
  program: (typeof CCADB_PROGRAMS)[number],
  roots: CcadbRoot[],
  certs: X509Certificate[],
  expectedRoot: string,
  route: Route,
  deps: TlsCheckDeps,
  now: number
): Promise<TlsProgramResult> {
  const store = programStore(roots)
  let chain = certs
  let anchor = anchorIn(chain, store.certs)
  const downloaded: string[] = []
  for (let i = 0; !anchor && i < AIA_MAX_DOWNLOADS; i++) {
    const last = chain[chain.length - 1] as X509Certificate
    const url = isSelfSigned(last) ? null : aiaIssuerUrl(last)
    if (!url) break
    const issuer = await (deps.fetchIssuer ?? fetchIssuer)(url, route).catch(() => null)
    if (!issuer || chain.some((c) => c.fingerprint256 === issuer.fingerprint256)) break
    chain = [...chain, issuer]
    downloaded.push(nameOf(issuer.subject))
    anchor = anchorIn(chain, store.certs)
  }
  const base = { program: program.id, label: msg().tlsCheck.programs.labels[program.id] }
  if (!anchor) {
    return {
      ...base,
      status: 'not-included',
      root: null,
      reasons: [
        msg().tlsCheck.programs.notIncluded(expectedRoot, msg().tlsCheck.programs.names[program.id])
      ],
      notes: []
    }
  }
  const root = store.byFingerprint.get(fingerprintHex(anchor))
  const limits = root
    ? programLimits(program.id, root, certs[0] as X509Certificate, now)
    : { reasons: [], notes: [] }
  return {
    ...base,
    status: limits.reasons.length > 0 ? 'restricted' : 'included',
    root: root?.name || nameOf(anchor.subject),
    reasons: limits.reasons,
    notes: [
      ...limits.notes,
      ...(downloaded.length > 0 ? [msg().tlsCheck.programs.aia(downloaded)] : [])
    ]
  }
}

async function ccadbResult(
  certs: X509Certificate[],
  expectedRoot: string,
  route: Route,
  deps: TlsCheckDeps,
  now: number
): Promise<TlsCcadbResult | undefined> {
  if (!deps.ccadb) return undefined
  const snapshot = await deps
    .ccadb()
    .catch((error: unknown): CcadbSnapshot => ({ cache: null, error: errorText(error) }))
  const cache = snapshot.cache
  return {
    fetchedAt: cache?.fetchedAt ?? null,
    error: snapshot.error,
    programs: cache
      ? await Promise.all(
          CCADB_PROGRAMS.map((p) =>
            programResult(p, cache.programs[p.id], certs, expectedRoot, route, deps, now)
          )
        )
      : []
  }
}

const ROOT_VERDICTS: TlsVerdict[] = ['untrusted-root', 'incomplete-chain', 'self-signed']

/** The certificate a failed chain ends at (the root, or the missing issuer). */
const rootName = (a: Analysis) => a.missing?.name ?? a.chain[a.chain.length - 1]?.name ?? ''

function trustRow(source: 'hachi' | 'mozilla', analysis: Analysis): TlsTrustResult {
  const r = msg().tlsCheck.rows
  const label = source === 'hachi' ? 'Hachi' : r.mozilla
  const clients = source === 'hachi' ? r.hachiClients : r.mozillaClients
  const ok = analysis.verdict === 'ok'
  return {
    source,
    label,
    clients,
    status: ok ? 'pass' : 'fail',
    reasons: ok ? [] : [analysis.summary]
  }
}

/** Connects (never verifying) and runs every check. Never throws. */
export async function checkCertificates(
  url: string,
  route: Route,
  deps: TlsCheckDeps = {}
): Promise<Omit<TlsCheckResult, 'unresolvedVariables'>> {
  const target = targetOf(url)
  const host = target?.host ?? ''
  const port = target?.port ?? 0
  const empty = (diagnosis: TlsDiagnosis) => ({
    host,
    port,
    diagnosis,
    trust: [],
    checks: [],
    advice: []
  })
  if (!target) {
    return empty(unavailable(host, port, msg().tlsCheck.invalidUrl, msg().tlsCheck.cannotConnect))
  }
  const now = deps.now ?? Date.now()

  let main: Handshake
  try {
    // No CA list: Node would otherwise append a root from it to the chain "sent".
    main = await lenientHandshake(host, port, route, {
      requestOCSP: true,
      minVersion: 'TLSv1',
      ca: []
    })
  } catch (error) {
    return empty(unavailable(host, port, errorText(error), msg().tlsCheck.cannotConnect))
  }
  const certs = main.certs
  // The OpenSSL error means nothing without a CA list.
  const hachi = analyzeChain(host, certs, null, now)
  // The diagnosis' "looks fine here" text is meant for a failed request.
  const diagnosis: TlsDiagnosis =
    hachi.verdict === 'ok'
      ? { host, port, ...hachi, summary: msg().tlsCheck.verdicts.trusted, advice: '' }
      : { host, port, ...hachi }
  if (certs.length === 0) return empty(diagnosis)
  const mozilla = analyzeChain(host, certs, null, now, bundledRoots())

  // The OS gets Hachi's root too: a clear "root not trusted" instead of "missing issuer".
  const root = issuerIn(certs, trusted())
  const pems = [...certs, ...(root ? [root] : [])].map((c) => c.toString())
  const [versions, system, apple, ccadb] = await Promise.all([
    Promise.all(VERSIONS.map(([v]) => probeVersion(host, port, route, v))),
    deps.verifySystem
      ? deps.verifySystem(host, pems).catch((error: unknown) => errorText(error))
      : Promise.resolve(null),
    appleTrust(host, certs, route, deps, now),
    ccadbResult(certs, rootName(hachi), route, deps, now)
  ])
  const program = (id: CcadbProgram) => ccadb?.programs.find((p) => p.program === id)

  const checks = extraChecks({
    certs,
    main,
    versions,
    // Apple's own list on macOS, else CCADB's copy of it.
    appleAnchored: apple
      ? apple.analysis.verdict === 'ok' || !ROOT_VERDICTS.includes(apple.analysis.verdict) // failed for another reason
      : program('apple')
        ? program('apple')?.status !== 'not-included'
        : null,
    ctVerified: typeof system === 'object' && system ? system.ctVerified : null,
    now
  })
  const appleFails = checks.filter((c) => c.id.startsWith('apple-') && c.status === 'fail')

  const trust: TlsTrustResult[] = [trustRow('hachi', hachi), trustRow('mozilla', mozilla)]
  if (typeof system === 'string') {
    trust.push({
      source: 'system',
      label: msg().tlsCheck.rows.system,
      clients: '—',
      status: 'error',
      reasons: [msg().tlsCheck.rows.systemError(system)]
    })
  } else if (system) {
    trust.push({
      source: 'system',
      label: system.label,
      clients: system.clients,
      status: system.ok ? 'pass' : 'fail',
      reasons: system.reasons
    })
  } else {
    trust.push({
      source: 'system',
      label: msg().tlsCheck.rows.system,
      clients: '—',
      status: 'unsupported',
      reasons: [msg().tlsCheck.rows.systemNone]
    })
  }
  if (apple) {
    const a = apple.analysis
    const reasons =
      a.verdict === 'ok'
        ? []
        : a.verdict === 'untrusted-root'
          ? [msg().tlsCheck.rows.notInApple(rootName(a))]
          : a.verdict === 'incomplete-chain'
            ? [msg().tlsCheck.rows.appleMissing(rootName(a))]
            : [a.summary]
    trust.push({
      source: 'apple',
      label: msg().tlsCheck.rows.apple,
      clients: msg().tlsCheck.rows.appleClients,
      status: reasons.length === 0 && appleFails.length === 0 ? 'pass' : 'fail',
      reasons: [
        ...reasons,
        ...appleFails.map((c) =>
          msg().tlsCheck.rows.appleRule(msg().tlsCheck.checks.appleRules[c.id] ?? c.label, c.detail)
        ),
        ...(reasons.length === 0 && appleFails.length === 0 && apple.downloaded.length > 0
          ? [msg().tlsCheck.rows.appleAia(apple.downloaded)]
          : [])
      ]
    })
  }

  // Advice for the platforms that fail.
  const advice: string[] = []
  let windowsAdvised = false
  let mozillaAdvised = false
  const row = (s: TlsTrustResult['source']) => trust.find((t) => t.source === s)
  const passes = (s: TlsTrustResult['source']) => row(s)?.status === 'pass'
  const somePass =
    trust.some((t) => t.status === 'pass') || !!ccadb?.programs.some((p) => p.status === 'included')
  const macRootFails =
    system !== null &&
    typeof system === 'object' &&
    system.platform === 'darwin' &&
    !system.ok &&
    system.rootUntrusted
  const appleRootFails =
    (!!apple && ROOT_VERDICTS.includes(apple.analysis.verdict)) ||
    program('apple')?.status === 'not-included'
  if (somePass && (appleRootFails || macRootFails)) {
    const name = apple && appleRootFails ? rootName(apple.analysis) : rootName(hachi)
    advice.push(msg().tlsCheck.advice.apple(name))
  }
  const windows = typeof system === 'object' && system?.platform === 'win32' ? system : null
  if (somePass && windows && !windows.ok && windows.rootUntrusted) {
    advice.push(msg().tlsCheck.advice.windows(rootName(hachi)))
    windowsAdvised = true
  }
  if (hachi.verdict === 'incomplete-chain' && (passes('system') || passes('apple'))) {
    advice.push(msg().tlsCheck.advice.fullchain)
  }
  if (hachi.verdict === 'ok' && ROOT_VERDICTS.includes(mozilla.verdict)) {
    advice.push(msg().tlsCheck.advice.localOnly(rootName(mozilla)))
    mozillaAdvised = true
  }
  // Other root programs that leave the root out, or limit it (CCADB).
  const missingFrom = (ccadb?.programs ?? []).filter(
    (p) =>
      p.status === 'not-included' &&
      p.program !== 'apple' &&
      !(p.program === 'microsoft' && windowsAdvised) &&
      !(p.program === 'mozilla' && mozillaAdvised)
  )
  if (somePass && missingFrom.length > 0) {
    advice.push(
      msg().tlsCheck.advice.programs(
        missingFrom.map((p) => p.label),
        rootName(hachi)
      )
    )
  }
  for (const p of ccadb?.programs ?? []) {
    if (p.status === 'restricted') {
      advice.push(msg().tlsCheck.advice.restricted(p.reasons))
    }
  }
  for (const item of appleFails) {
    const text = msg().tlsCheck.advice.rules[item.id]
    if (text && !advice.includes(text)) advice.push(text)
  }
  // Fails everywhere (or for a reason not covered above): the diagnosis' own advice.
  if (hachi.verdict !== 'ok' && (!somePass || advice.length === 0)) advice.unshift(hachi.advice)
  return { host, port, diagnosis, trust, checks, advice, ...(ccadb ? { ccadb } : {}) }
}
