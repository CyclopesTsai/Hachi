/**
 * Types of the script sandbox (decision 70 / 85) and of the results shown in the
 * response viewer. Types + constants only — safe to import anywhere.
 */

export const SCRIPT_TIMEOUT_MS = 5000
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
  info: { requestName: string; environmentName: string | null; collectionName: string | null }
  request: ScriptRequest
  response: ScriptResponse | null
  timeoutMs: number
}

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
