/**
 * Types of the script sandbox (decision 70 / 85) and of the results shown in the
 * response viewer. Types + constants only — safe to import anywhere.
 */

/** Computing time of one script (the sandbox interrupts it after this). */
export const SCRIPT_TIMEOUT_MS = 5000
/** Total time of one script including waiting for sendRequest / sleep (decision 127). */
export const SCRIPT_TOTAL_TIMEOUT_DEFAULT_MS = 30_000
export const SCRIPT_TOTAL_TIMEOUT_MAX_MS = 300_000
/** sendRequest / runRequest calls per script run, and how deep runRequest may nest. */
export const SCRIPT_MAX_HOST_REQUESTS = 20
export const SCRIPT_MAX_RUN_DEPTH = 3
export const SCRIPT_MEMORY_BYTES = 64 * 1024 * 1024
/** Response bodies larger than this are not given to Post-response scripts. */
export const SCRIPT_BODY_LIMIT_BYTES = 10 * 1024 * 1024
export const SCRIPT_LOG_LIMIT = 1000
export const SCRIPT_LOG_TEXT_LIMIT = 10 * 1024
export const SCRIPT_CHANGE_LIMIT = 1000
export const SCRIPT_VALUE_LIMIT = 1024 * 1024

export type ScriptPhase = 'preRequest' | 'postResponse'
/** Where a script (or an extraction row) stored a variable. */
export type VariableScope = 'runtime' | 'environment' | 'collection'

export interface ScriptRequest {
  method: string
  url: string
  /** Pre-request: the request's own enabled headers, unresolved. Post-response: as sent. */
  headers: [string, string][]
  /** Text of a JSON / Raw body; null for other body modes (read-only then). */
  body: string | null
}

export interface ScriptResponse {
  status: number
  statusText: string
  headers: [string, string][]
  timeMs: number
  sizeBytes: number
  /** null when the body is binary or over SCRIPT_BODY_LIMIT_BYTES. */
  body: string | null
  bodyUnavailable: string | null
}

export interface ScriptRunInput {
  phase: ScriptPhase
  code: string
  /** Raw (unresolved) values of enabled variables, by name. */
  variables: {
    runtime: Record<string, string>
    environment: Record<string, string> | null
    collection: Record<string, string> | null
  }
  /** Data-file row of this round (Collection Runner, decision 89); null otherwise. */
  iterationData: Record<string, string> | null
  info: {
    requestName: string
    environmentName: string | null
    collectionName: string | null
    /** Round number (0-based) and number of rounds; 0 / 1 outside the Runner. */
    iteration: number
    iterationCount: number
  }
  request: ScriptRequest
  response: ScriptResponse | null
  /** Total time, waiting included (computing is limited to SCRIPT_TIMEOUT_MS). */
  timeoutMs: number
}

/** A request a script sends itself (sendRequest), as plain text (decision 127). */
export interface HostRequest {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
}

/** What sendRequest / runRequest give back to the script. */
export interface HostResponse {
  status: number
  statusText: string
  headers: [string, string][]
  /** null when the body is binary or too large for scripts. */
  body: string | null
  timeMs: number
  sizeBytes: number
}

/** Work a script asks the app to do (the sandbox itself has no network). */
export type HostCall =
  { op: 'sendRequest'; request: HostRequest } | { op: 'runRequest'; path: string }

export type HostReply =
  | {
      ok: true
      response: HostResponse
      /** After runRequest: stored variables now (the nested request may have changed them). */
      variables?: ScriptRunInput['variables']
    }
  | { ok: false; error: string }

export interface ScriptLog {
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
}

export interface ScriptTestResult {
  name: string
  passed: boolean
  error?: string
}

export interface VariableChange {
  scope: VariableScope
  name: string
  /** null = unset. */
  value: string | null
}

export interface ScriptRunOutput {
  /** Uncaught error, timeout, memory limit… (message, with the line when known). */
  error: string | null
  logs: ScriptLog[]
  tests: ScriptTestResult[]
  changes: VariableChange[]
  /** Pre-request only: the request after the script (null if it did not change it). */
  request: ScriptRequest | null
  /**
   * setNextRequest: the request the Runner runs next, null to end the round; absent when
   * the script did not call it (decision 127).
   */
  nextRequest?: string | null
  durationMs: number
}

export interface AssertionResult {
  id: string
  /** Human-readable description, e.g. "狀態碼 等於 200". */
  label: string
  passed: boolean
  /** Actual value, shortened for display. */
  actual: string
  error?: string
}

export interface ExtractionResult {
  id: string
  variable: string
  scope: 'runtime' | 'environment'
  /** Extracted value (null when nothing matched). */
  value: string | null
  error?: string
}

export interface ScriptPhaseReport {
  error: string | null
  logs: ScriptLog[]
  tests: ScriptTestResult[]
  durationMs: number
}

/** Everything scripts, extractions and assertions did for one send. */
export interface ScriptReport {
  preRequest: ScriptPhaseReport | null
  postResponse: ScriptPhaseReport | null
  extractions: ExtractionResult[]
  assertions: AssertionResult[]
  /** Variables changed by scripts and extractions, in order. */
  changes: (VariableChange & { by: ScriptPhase | 'extraction' })[]
  /** Errors applying changes (e.g. environment.set without an active environment). */
  changeErrors: string[]
  /** Scripts exist but were not run (the user chose "這次不執行腳本"). */
  scriptsSkipped: boolean
  /** The last setNextRequest of the scripts (Runner only, decision 127). */
  nextRequest?: string | null
}

export function hasScripts(scripts: { preRequest: string; postResponse: string }): boolean {
  return scripts.preRequest.trim() !== '' || scripts.postResponse.trim() !== ''
}

/** Counts passed / total of script tests and assertions. */
export function testSummary(report: ScriptReport | null | undefined): {
  passed: number
  total: number
} {
  if (!report) return { passed: 0, total: 0 }
  const results = [
    ...(report.preRequest?.tests ?? []),
    ...(report.postResponse?.tests ?? []),
    ...report.assertions
  ]
  return { passed: results.filter((r) => r.passed).length, total: results.length }
}
