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
