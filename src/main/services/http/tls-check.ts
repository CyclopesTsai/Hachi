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
import { CCADB_PROGRAMS, type CcadbRoot, type CcadbSnapshot } from './ccadb'
import {
  aiaIssuerUrl,
  analyzeChain,
  bundledRoots,
  handshake,
  nameOf,
  parseCertificates,
  targetOf,
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
    if (errorText(error) === '逾時' || INCONCLUSIVE.has(errorCode(error))) return 'unknown'
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
  return { text: key.asymmetricKeyType ?? '未知', weak: false }
}

/** Only a self-signed one is a root: the last one sent may be a cross-signed intermediate. */
const ROLE = (i: number, cert: X509Certificate) =>
  i === 0 ? '網站憑證' : isSelfSigned(cert) ? '根憑證' : '中繼憑證'

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
  const parts = [
    yes.length > 0 ? `支援 ${yes.join('、')}` : '',
    named('no').length > 0 ? `不支援 ${named('no').join('、')}` : '',
    named('unknown').length > 0 ? `無法測試 ${named('unknown').join('、')}` : ''
  ].filter(Boolean)
  items.push({
    id: 'versions',
    label: 'TLS 版本',
    status:
      !yes.includes('TLS 1.2') && !yes.includes('TLS 1.3')
        ? 'fail'
        : old.length > 0
          ? 'warn'
          : 'pass',
    detail: `${parts.join('；')}${
      old.length > 0 ? `。${old.join('、')} 已淘汰，建議在伺服器關閉` : ''
    }${!yes.includes('TLS 1.2') && !yes.includes('TLS 1.3') ? '。現在的用戶端至少需要 TLS 1.2' : ''}`
  })

  items.push({
    id: 'ocsp-stapling',
    label: 'OCSP Stapling',
    status: main.ocsp ? 'pass' : 'info',
    detail: main.ocsp
      ? `伺服器在交握時附上了撤銷狀態（OCSP 回應 ${main.ocsp.length} bytes）`
      : '伺服器沒有附上 OCSP 回應。不影響連線，用戶端需要時會自己查詢撤銷狀態'
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
    label: 'Certificate Transparency（SCT）',
    status: enough ? 'pass' : appleAnchored === false ? 'info' : 'warn',
    detail: [
      scts === null ? '網站憑證裡沒有 SCT' : `網站憑證內嵌 ${scts} 個 SCT`,
      `Apple 平台要求至少 ${required} 個（有效期 ${lifetimeDays} 天）`,
      input.ctVerified !== null ? `macOS 的 CT 檢查${input.ctVerified ? '通過' : '未通過'}` : '',
      enough
        ? ''
        : appleAnchored === false
          ? '公司內部或測試用的 CA 不需要 SCT'
          : 'SCT 也可能在交握或 OCSP 回應中送出（這裡看不到）；都沒有時 Apple 平台會拒絕公開 CA 簽發的憑證'
    ]
      .filter(Boolean)
      .join('；')
  })

  const last = certs[certs.length - 1] as X509Certificate
  const rootSent = certs.length > 1 && isSelfSigned(last)
  items.push({
    id: 'root-sent',
    label: '多送根憑證',
    status: rootSent ? 'warn' : 'pass',
    detail: rootSent
      ? `伺服器連根憑證「${nameOf(last.subject)}」也送出了。用戶端只用自己信任清單裡的根憑證，多送沒有用，只會讓每次交握變大`
      : '沒有多送根憑證'
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
    label: '到期日',
    status: expired.length > 0 ? 'fail' : soon.length > 0 ? 'warn' : 'pass',
    detail:
      expired.length > 0
        ? expired
            .map((c) => `「${nameOf(c.subject)}」已在 ${date(Date.parse(c.validTo))} 過期`)
            .join('；')
        : soon.length > 0
          ? soon
              .map(
                (c) =>
                  `${ROLE(certs.indexOf(c), c)}「${nameOf(c.subject)}」剩 ${daysLeft(c)} 天到期（${date(Date.parse(c.validTo))}）`
              )
              .join('；')
          : `網站憑證到 ${date(to)}（剩 ${daysLeft(leaf)} 天）`
  })

  // Apple's rules for TLS server certificates.
  const tooLong = lifetimeDays > APPLE_MAX_DAYS && from >= APPLE_VALIDITY_FROM
  items.push({
    id: 'apple-validity',
    label: 'Apple 要求：有效期',
    status: !tooLong
      ? 'pass'
      : appleAnchored === true
        ? 'fail'
        : appleAnchored === false
          ? 'info'
          : 'warn',
    detail: !tooLong
      ? from < APPLE_VALIDITY_FROM
        ? `有效期 ${lifetimeDays} 天（2020-09-01 前簽發，不受 398 天的限制）`
        : `有效期 ${lifetimeDays} 天（上限 ${APPLE_MAX_DAYS} 天）`
      : `有效期 ${lifetimeDays} 天，超過 ${APPLE_MAX_DAYS} 天：公開 CA 簽發的這種憑證 Apple 平台會拒絕${
          appleAnchored === false ? '（公司內部或自行加入的 CA 不受此限）' : ''
        }`
  })

  const keys = certs.map((c, i) => ({ c, i, key: keyOf(c) }))
  const weakKeys = keys.filter((k) => k.key.weak)
  items.push({
    id: 'apple-key',
    label: 'Apple 要求：金鑰長度',
    status: weakKeys.length > 0 ? 'fail' : 'pass',
    detail:
      weakKeys.length > 0
        ? weakKeys
            .map(
              (k) =>
                `${ROLE(k.i, k.c)}「${nameOf(k.c.subject)}」是 ${k.key.text}，RSA 至少要 2048 位元`
            )
            .join('；')
        : keys.map((k) => `${ROLE(k.i, k.c)} ${k.key.text}`).join('、')
  })

  const signatures = certs
    .map((c, i) => ({ c, i, alg: signatureAlgorithm(c.raw) }))
    .filter((s) => !isSelfSigned(s.c)) // a root's own signature is not checked
  const weakSignatures = signatures.filter((s) => s.alg?.weak)
  items.push({
    id: 'apple-signature',
    label: 'Apple 要求：簽章演算法',
    status: weakSignatures.length > 0 ? 'fail' : 'pass',
    detail:
      weakSignatures.length > 0
        ? weakSignatures
            .map((s) => `「${nameOf(s.c.subject)}」用 ${s.alg?.name} 簽署，已不被接受`)
            .join('；')
        : signatures.map((s) => s.alg?.name ?? '未知').join('、') || '—'
  })

  const ekus = leaf.keyUsage
  const ekuOk = !!ekus && (ekus.includes(SERVER_AUTH) || ekus.includes(ANY_EKU))
  const ekuApplies = from >= APPLE_EKU_FROM
  items.push({
    id: 'apple-eku',
    label: 'Apple 要求：Extended Key Usage',
    status: ekuOk || !ekuApplies ? 'pass' : 'fail',
    detail: ekuOk
      ? '包含 serverAuth'
      : !ekuApplies
        ? '2019-07-01 前簽發，不受此限'
        : ekus
          ? `沒有 serverAuth（只有 ${ekus.join('、')}），不能用於網站`
          : '網站憑證沒有 Extended Key Usage，iOS 13 / macOS 10.15 起不接受'
  })

  const names = (leaf.subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:') || s.startsWith('IP Address:'))
  items.push({
    id: 'apple-san',
    label: 'Apple 要求：Subject Alternative Name',
    status: names.length > 0 || !ekuApplies ? 'pass' : 'fail',
    detail:
      names.length > 0
        ? `名稱寫在 Subject Alternative Name（${names.length} 個）`
        : !ekuApplies
          ? '2019-07-01 前簽發，不受此限'
          : '網域只寫在 CN、沒有 Subject Alternative Name，iOS 13 / macOS 10.15 起不接受'
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
  const name = `「${root.name}」`
  if (program === 'mozilla' && root.distrustAfter) {
    const after = root.distrustAfter
    if (issued >= Date.parse(after) + DAY_MS) {
      reasons.push(
        `Mozilla 不信任${name}在 ${after} 之後簽發的網站憑證（這張在 ${date(issued)} 簽發）`
      )
    } else {
      notes.push(
        `Mozilla 不信任${name}在 ${after} 之後簽發的網站憑證；這張在 ${date(issued)} 簽發，不受影響`
      )
    }
  }
  if (program === 'chrome' && root.sctNotAfter) {
    const limit = Date.parse(root.sctNotAfter)
    const times = embeddedSctTimes(leaf.raw)
    const earliest = times.length > 0 ? Math.min(...times) : issued
    const when = date(limit)
    if (earliest > limit) {
      reasons.push(
        `Chrome 不信任${name}在 ${when} 之後才記錄（SCT）的憑證（這張在 ${date(earliest)}）`
      )
    } else {
      notes.push(
        `Chrome 不信任${name}在 ${when} 之後才記錄（SCT）的憑證；這張在 ${date(earliest)}，不受影響`
      )
    }
  }
  if (program === 'microsoft') {
    const nb = root.notBefore
    if (nb && nb.ekus.some((e) => SERVER_AUTH_EKU.test(e))) {
      if (issued >= Date.parse(nb.date)) {
        reasons.push(
          `Microsoft 不信任${name}在 ${nb.date} 之後簽發的網站憑證（這張在 ${date(issued)} 簽發）`
        )
      } else {
        notes.push(`Microsoft 不信任${name}在 ${nb.date} 之後簽發的網站憑證；這張不受影響`)
      }
    }
    if (root.disabledAfter) {
      if (now >= Date.parse(root.disabledAfter)) {
        reasons.push(`Microsoft 已在 ${root.disabledAfter} 停用${name}`)
      } else {
        notes.push(`Microsoft 將在 ${root.disabledAfter} 停用${name}`)
      }
    }
    if (root.disallowedEkus?.some((e) => SERVER_AUTH_EKU.test(e))) {
      reasons.push(`Microsoft 不允許${name}用於網站`)
    }
  }
  if (root.constraints) {
    const text =
      root.constraints.length > 200 ? `${root.constraints.slice(0, 200)}…` : root.constraints
    notes.push(`限制條件：${text}`)
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
  const base = { program: program.id, label: program.label }
  if (!anchor) {
    return {
      ...base,
      status: 'not-included',
      root: null,
      reasons: [`「${expectedRoot}」不在 ${program.label.replace(/（.*）$/, '')} 的根憑證清單中`],
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
      ...(downloaded.length > 0
        ? [`伺服器少送的「${downloaded.join('」「')}」依 AIA 下載後才接到根憑證`]
        : [])
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
  const label = source === 'hachi' ? 'Hachi' : 'Node 內建根憑證（Mozilla）'
  const clients =
    source === 'hachi'
      ? 'Hachi 本身（內建根憑證＋這台電腦加入的憑證）'
      : 'Firefox、Linux、多數 Node / Python 工具'
  const ok = analysis.verdict === 'ok'
  return {
    source,
    label,
    clients,
    status: ok ? 'pass' : 'fail',
    reasons: ok ? [] : [analysis.summary]
  }
}

const ADVICE: Partial<Record<TlsCheckItem['id'], string>> = {
  'apple-validity': '請 CA 重新簽發有效期不超過 398 天的憑證。',
  'apple-key': '請改用 RSA 2048 位元以上或 ECDSA 的金鑰重新簽發。',
  'apple-signature': '請 CA 改用 SHA-256 以上的簽章重新簽發。',
  'apple-eku': '請 CA 重新簽發包含 Extended Key Usage「serverAuth」的憑證。',
  'apple-san': '請把網域放進 Subject Alternative Name（不能只寫在 CN）重新簽發。'
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
  if (!target) return empty(unavailable(host, port, '網址無效', '無法連線讀取憑證鏈'))
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
    return empty(unavailable(host, port, errorText(error), '無法連線讀取憑證鏈'))
  }
  const certs = main.certs
  // The OpenSSL error means nothing without a CA list.
  const hachi = analyzeChain(host, certs, null, now)
  // The diagnosis' "looks fine here" text is meant for a failed request.
  const diagnosis: TlsDiagnosis =
    hachi.verdict === 'ok'
      ? { host, port, ...hachi, summary: 'Hachi 信任這個憑證鏈', advice: '' }
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
      label: '作業系統',
      clients: '—',
      status: 'error',
      reasons: [`無法執行系統驗證：${system}`]
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
      label: '作業系統',
      clients: '—',
      status: 'unsupported',
      reasons: ['這個平台沒有統一的系統驗證（各程式使用自己的根憑證清單）']
    })
  }
  if (apple) {
    const a = apple.analysis
    const reasons =
      a.verdict === 'ok'
        ? []
        : a.verdict === 'untrusted-root'
          ? [`「${rootName(a)}」不在 Apple 內建的根憑證中`]
          : a.verdict === 'incomplete-chain'
            ? [`少了中繼憑證「${rootName(a)}」，也無法從憑證中的 AIA 網址下載`]
            : [a.summary]
    trust.push({
      source: 'apple',
      label: 'iOS（依 Apple 內建根憑證推測）',
      clients: 'iPhone / iPad App（URLSession）、iOS Safari',
      status: reasons.length === 0 && appleFails.length === 0 ? 'pass' : 'fail',
      reasons: [
        ...reasons,
        ...appleFails.map((c) => `${c.label.replace(/^Apple 要求：/, '')}：${c.detail}`),
        ...(reasons.length === 0 && appleFails.length === 0 && apple.downloaded.length > 0
          ? [`伺服器少送的「${apple.downloaded.join('」「')}」由系統自動下載（AIA）`]
          : [])
      ]
    })
  }

  // Advice for the platforms that fail.
  const advice: string[] = []
  const row = (s: TlsTrustResult['source']) => trust.find((t) => t.source === s)
  const passes = (s: TlsTrustResult['source']) => row(s)?.status === 'pass'
  const somePass =
    trust.some((t) => t.status === 'pass') || !!ccadb?.programs.some((p) => p.status === 'included')
  const macRootFails =
    system !== null &&
    typeof system === 'object' &&
    system.label.includes('Mac') &&
    !system.ok &&
    system.reasons.some((r) => r.startsWith('根憑證不受信任'))
  const appleRootFails =
    (!!apple && ROOT_VERDICTS.includes(apple.analysis.verdict)) ||
    program('apple')?.status === 'not-included'
  if (somePass && (appleRootFails || macRootFails)) {
    const name = apple && appleRootFails ? rootName(apple.analysis) : rootName(hachi)
    advice.push(
      `macOS / iOS 不信任「${name}」→ 請 CA 提供 Apple 信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。`
    )
  }
  const windows = typeof system === 'object' && system?.label.includes('Windows') ? system : null
  if (
    somePass &&
    windows &&
    !windows.ok &&
    windows.reasons.some((r) => r.startsWith('根憑證不受信任'))
  ) {
    advice.push(
      `Windows 不信任「${rootName(hachi)}」→ 請 CA 提供 Microsoft 信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。`
    )
  }
  if (hachi.verdict === 'incomplete-chain' && (passes('system') || passes('apple'))) {
    advice.push(
      '伺服器少送了中繼憑證：作業系統會自動下載補上所以通過，但 Hachi、Node、Python、Java、Android 等用戶端不會。請伺服器改用完整的憑證鏈（fullchain）。'
    )
  }
  if (hachi.verdict === 'ok' && ROOT_VERDICTS.includes(mozilla.verdict)) {
    advice.push(
      `「${rootName(mozilla)}」不在 Mozilla 的根憑證清單中，只在這台電腦的信任憑證裡（例如公司內部的 CA）：其他電腦、手機與伺服器上的程式不會信任它。`
    )
  }
  // Other root programs that leave the root out, or limit it (CCADB).
  const covered = advice.join('\n')
  const missingFrom = (ccadb?.programs ?? []).filter(
    (p) =>
      p.status === 'not-included' &&
      p.program !== 'apple' &&
      !(p.program === 'microsoft' && covered.includes('Windows 不信任')) &&
      !(p.program === 'mozilla' && covered.includes('不在 Mozilla 的根憑證清單'))
  )
  if (somePass && missingFrom.length > 0) {
    advice.push(
      `${missingFrom.map((p) => p.label).join('、')} 沒有收錄「${rootName(hachi)}」→ 請 CA 提供這些平台信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。`
    )
  }
  for (const p of ccadb?.programs ?? []) {
    if (p.status === 'restricted') {
      advice.push(`${p.reasons.join('；')} → 請 CA 改用其他根憑證重新簽發，或改用其他 CA。`)
    }
  }
  for (const item of appleFails) {
    const text = ADVICE[item.id]
    if (text && !advice.includes(text)) advice.push(text)
  }
  // Fails everywhere (or for a reason not covered above): the diagnosis' own advice.
  if (hachi.verdict !== 'ok' && (!somePass || advice.length === 0)) advice.unshift(hachi.advice)
  return { host, port, diagnosis, trust, checks, advice, ...(ccadb ? { ccadb } : {}) }
}
