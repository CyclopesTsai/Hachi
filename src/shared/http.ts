/**
 * Types exchanged between renderer and main for sending HTTP requests.
 * Types + pure helpers only, safe to import anywhere.
 */
import type { Auth, KeyValue, RequestScripts, ScriptFlow, Variable } from './schemas/collection'
import type { ScriptReport } from './scripts'

/** Bodies larger than this are not sent to the renderer unless the user asks. */
export const DISPLAY_LIMIT_BYTES = 10 * 1024 * 1024
/** Responses larger than this are aborted. */
export const MAX_RESPONSE_BYTES = 100 * 1024 * 1024

export interface ResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  maxAge?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: string
}

export type ResponseBody =
  /** Text body, delivered inline. */
  | { kind: 'text'; text: string }
  /** Non-text body (image, PDF, …): not displayed, can be downloaded. */
  | { kind: 'binary' }
  /** Text body over DISPLAY_LIMIT_BYTES: fetch it with http:getBody, or download. */
  | { kind: 'large' }
  | { kind: 'empty' }

export interface HttpResponseData {
  kind: 'response'
  runId: string
  status: number
  statusText: string
  /** Header names are lower-case; repeated headers appear once per value. */
  headers: [string, string][]
  cookies: ResponseCookie[]
  contentType: string
  body: ResponseBody
  /** Decoded (decompressed) body size in bytes. */
  bodyBytes: number
  /** Approximate size of the response headers in bytes. */
  headerBytes: number
  /** Time until the response headers arrived / until the body was fully read. */
  timings: { headersMs: number; totalMs: number }
  /** The URL that was actually requested (after params, before redirects). */
  url: string
  /** Headers Hachi sent (multipart Content-Type / Content-Length are added by the client). */
  requestHeaders: [string, string][]
  redirects: number
  /** `{{names}}` that had no value and were sent as-is. */
  unresolvedVariables: string[]
  /** Scripts / extractions / assertions; absent when the request has none. */
  scriptReport?: ScriptReport
}

export const HTTP_ERROR_CODES = [
  'INVALID_URL',
  'TIMEOUT',
  'CANCELLED',
  'TLS',
  'PROXY',
  'NETWORK',
  'TOO_LARGE',
  'FILE_NOT_FOUND',
  'TOO_MANY_REDIRECTS',
  /** The Pre-request script failed, or scripts of this Workspace are not trusted. */
  'SCRIPT',
  /** OAuth 2.0 token / AWS signing failed (decision 128). */
  'AUTH',
  /** {{$file:…}}: a file outside the Workspace not allowed yet, too large, bad format (decision 134). */
  'FILE_ACCESS',
  'UNKNOWN'
] as const
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number]

/** Network-level failure (no HTTP response). Not an IPC error: the call itself succeeded. */
export interface HttpErrorData {
  kind: 'error'
  runId: string
  code: HttpErrorCode
  message: string
  url: string
  timings: { totalMs: number }
  /** `{{names}}` that had no value and were sent as-is. */
  unresolvedVariables: string[]
  scriptReport?: ScriptReport
  /** Certificate chain check after a TLS failure (editor sends only). */
  tls?: TlsDiagnosis
  /** FILE_ACCESS: files outside the Workspace the request wants to read (decision 134). */
  untrustedFiles?: string[]
}

export type HttpResult = HttpResponseData | HttpErrorData

/** Headers / auth a request or folder inherits from the containers above it. */
export interface InheritedHeader extends KeyValue {
  sourceId: string
  sourceName: string
}

export interface InheritedSettings {
  headers: InheritedHeader[]
  /** Auth used when the item's own auth is "inherit"; null = nothing above sets one. */
  auth: { auth: Auth; sourceId: string; sourceName: string } | null
  /** Collections / folders above with scripts, outermost first (decision 126). */
  scripts: string[]
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

/** Shared headers / auth of a collection or folder, as shown in its settings editor. */
export interface ContainerSettingsData {
  kind: 'collection' | 'folder'
  headers: KeyValue[]
  auth: Auth
  /** Collection variables, secret values included (always empty for folders). */
  variables: Variable[]
  /** Run before / after every request inside (decision 126). */
  scripts: RequestScripts
  /** Order of the scripts; set on the collection (folders show their collection's). */
  scriptFlow: ScriptFlow
  /** What this container inherits from the ones above it (empty for collections). */
  inherited: InheritedSettings
}

/** An OAuth 2.0 token kept in memory (decision 128), as the Auth tab shows it. */
export interface OAuth2TokenStatus {
  state: 'none' | 'valid' | 'expired'
  /** ms since epoch; null = unknown (the server did not say). */
  expiresAt: number | null
  /** Has a refresh token: renewed automatically when it expires. */
  refreshable: boolean
  scope: string | null
}

/** One certificate of a server's chain, as the TLS diagnosis shows it. */
export interface TlsCertInfo {
  /** Common name (or the first subject field). */
  name: string
  subject: string
  issuerName: string
  validFrom: string // ISO
  validTo: string // ISO
  altNames: string[]
  fingerprint256: string
  selfSigned: boolean
  /** Where it came from: sent by the server, or found in the trusted list (a root). */
  source: 'server' | 'trust-store'
  /** A trusted root (in Hachi's list: the bundled roots plus the system's). */
  trusted: boolean
  expired: boolean
  notYetValid: boolean
  /** Its issuer's signature does not check out (wrong order / foreign certificate). */
  badSignature: boolean
}

export type TlsVerdict =
  | 'incomplete-chain' // the server did not send an intermediate certificate
  | 'self-signed' // the site's own certificate is self-signed
  | 'untrusted-root' // the chain ends in a root that is not trusted (e.g. a company CA)
  | 'expired'
  | 'not-yet-valid'
  | 'hostname-mismatch'
  | 'bad-signature'
  | 'ok' // the chain looks fine here (the failure came from somewhere else)
  | 'unavailable' // could not connect again to read the chain

/** Why a TLS connection failed, from a second connection that reads the chain (decision 132). */
export interface TlsDiagnosis {
  host: string
  port: number
  verdict: TlsVerdict
  /** One line for the heading. */
  summary: string
  /** What to do about it. */
  advice: string
  /** Leaf first; a root found in the trust store is appended with source "trust-store". */
  chain: TlsCertInfo[]
  /** incomplete-chain: the certificate that is missing after the last one sent. */
  missing: { name: string; aiaUrl: string | null } | null
  /** OpenSSL's verify error (e.g. UNABLE_TO_GET_ISSUER_CERT_LOCALLY), when there is one. */
  opensslError: string | null
}

/**
 * Who would trust the chain (decision 142): Hachi's own list, Node's bundled roots
 * (Mozilla's), the operating system's verifier, and Apple's built-in roots (iOS).
 */
export type TlsTrustSource = 'hachi' | 'mozilla' | 'system' | 'apple'

export interface TlsTrustResult {
  source: TlsTrustSource
  /** e.g. "這台 Mac（Safari、macOS App）". */
  label: string
  /** The clients this row stands for. */
  clients: string
  status: 'pass' | 'fail' | 'unsupported' | 'error'
  /** Why it failed (or why it could not be checked); notes on a pass. */
  reasons: string[]
}

export interface TlsCheckItem {
  id:
    | 'versions'
    | 'ocsp-stapling'
    | 'sct'
    | 'root-sent'
    | 'expiry'
    | 'apple-validity'
    | 'apple-key'
    | 'apple-signature'
    | 'apple-eku'
    | 'apple-san'
  label: string
  status: 'pass' | 'warn' | 'fail' | 'info'
  detail: string
}

export type CcadbProgram = 'apple' | 'chrome' | 'microsoft' | 'mozilla'

/** Whether one root program (as published in CCADB) includes the chain's root (issue #7). */
export interface TlsProgramResult {
  program: CcadbProgram
  /** e.g. "Apple（iOS、macOS）". */
  label: string
  /** restricted: included, but one of the program's limits applies to this certificate. */
  status: 'included' | 'not-included' | 'restricted'
  /** The root the chain ends at in this program's list. */
  root: string | null
  /** Why not included / restricted. */
  reasons: string[]
  /** Limits that do not apply (yet), intermediates downloaded… */
  notes: string[]
}

export interface TlsCcadbResult {
  /** When the CCADB reports were downloaded (ISO); null when there is no data. */
  fetchedAt: string | null
  /** Why they could not be downloaded (older data, if any, is still used). */
  error: string | null
  programs: TlsProgramResult[]
}

/** A certificate check started by hand, the request succeeding or not (decision 142). */
export interface TlsCheckResult {
  host: string
  port: number
  /** The chain as Hachi sees it (same as the failure diagnosis). */
  diagnosis: TlsDiagnosis
  trust: TlsTrustResult[]
  checks: TlsCheckItem[]
  /** What to do, when some platform fails. */
  advice: string[]
  unresolvedVariables: string[]
  /** http:// or ws://: nothing to check, the dialog explains why (the rest is empty). */
  insecure?: 'http' | 'ws'
  /** Root program inclusion from CCADB (issue #7). */
  ccadb?: TlsCcadbResult
}
