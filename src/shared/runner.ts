/**
 * Collection Runner (Phase 5c, decisions 74–77, 86–92): configuration, result rows and
 * statistics. Types + pure helpers, safe to import anywhere.
 */
import type { HttpErrorCode } from './http'
import type { ScriptReport } from './scripts'

export const RUNNER_MAX_ITERATIONS = 10_000
/** Longest run in duration mode (decision 130). */
export const RUNNER_MAX_DURATION_SEC = 86_400
export const RUNNER_MAX_CONCURRENCY = 20
export const RUNNER_MAX_DELAY_MS = 60_000
export const RUNNER_MAX_DATA_ROWS = 10_000
/** Kept bodies (decision 90). */
export const RUNNER_BODY_LIMIT_BYTES = 1024 * 1024
export const RUNNER_BODY_TOTAL_BYTES = 200 * 1024 * 1024
/** Rows that keep their details (headers, script report): the first N, plus failed ones. */
export const RUNNER_DETAIL_ROWS = 2000
/** Requests per round when setNextRequest jumps around (decision 127): stops endless loops. */
export const RUNNER_MAX_STEPS_PER_ROUND = 1000

export interface RunnerItem {
  /** Request id (saved file). */
  id: string
  name: string
  method: string
  /** Path in the tree, e.g. "Users / Admin / Get user". */
  path: string
}

export interface RunnerConfig {
  /** Collection or folder that was run. */
  targetId: string
  /** Request ids in run order (only the checked ones). */
  itemIds: string[]
  environmentId: string | null
  /** Rounds per worker (decision 88); ignored when `durationSec` is set. */
  iterations: number
  /**
   * Duration mode (decision 130): every worker starts new rounds until this many
   * seconds have passed; a started round runs to its end. null = `iterations` mode.
   */
  durationSec: number | null
  /** Number of workers running rounds at the same time (decision 75). */
  concurrency: number
  /** Pause between two requests of a round. */
  delayMs: number
  stopOnFailure: boolean
  keepBodies: boolean
  /** Data file rows (decision 89); null = none. */
  data: { fileName: string; rows: Record<string, string>[] } | null
  /** "這次不執行腳本" (decision 84). */
  skipScripts: boolean
}

export interface RunnerRow {
  index: number
  /** Round number over all workers, in start order (0-based). */
  round: number
  worker: number
  itemId: string
  name: string
  method: string
  url: string
  /** null = no HTTP response (network / script error). */
  status: number | null
  statusText: string
  errorCode: HttpErrorCode | null
  errorMessage: string | null
  timeMs: number
  sizeBytes: number
  testsPassed: number
  testsTotal: number
  /** Error, script error or a failed test / assertion. */
  failed: boolean
  /** ms since the run started. */
  startedAt: number
}

export interface RunnerRowDetail extends RunnerRow {
  requestHeaders: [string, string][]
  responseHeaders: [string, string][]
  /** Kept body text (decision 90); null when not kept or not text. */
  body: string | null
  bodyNote: string | null
  scriptReport: ScriptReport | null
  /** Data row used by this round. */
  data: Record<string, string> | null
}

export interface LatencyStats {
  count: number
  avg: number
  min: number
  max: number
  p50: number
  p90: number
  p95: number
  p99: number
  stdDev: number
}

export interface RunnerStatsRow {
  /** Request id, or "" for the total. */
  itemId: string
  name: string
  count: number
  succeeded: number
  failed: number
  /** failed / count. */
  errorRate: number
  testsPassed: number
  testsFailed: number
  /** Response times of requests that got a response. */
  latency: LatencyStats | null
}

export interface TimelinePoint {
  /** Seconds since the start. */
  second: number
  requests: number
  p50: number | null
  p95: number | null
}

export interface RunnerStats {
  items: RunnerStatsRow[]
  total: RunnerStatsRow
  statusCodes: Record<string, number>
  errorCodes: Record<string, number>
  timeline: TimelinePoint[]
}

export type RunnerStatus = 'running' | 'done' | 'cancelled' | 'stopped' | 'error'

export interface RunnerProgress {
  runId: string
  status: RunnerStatus
  /** Why it stopped / failed (stop on failure, script trust, …). */
  message: string | null
  /** 0 in duration mode (not known in advance). */
  totalRounds: number
  completedRounds: number
  completedRequests: number
  /** 0 in duration mode. */
  totalRequests: number
  /** Duration mode: the planned length; null = iterations mode. */
  durationMs: number | null
  elapsedMs: number
  stats: RunnerStats
  /** Requests skipped because they are WebSocket items. */
  skipped: string[]
}

/** Pushed on `runner:event` while a run is going (every ~500 ms) and when it ends. */
export interface RunnerEvent {
  progress: RunnerProgress
}

// ---------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------

/** Nearest-rank percentile of sorted values. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number
}

export function latencyStats(values: readonly number[]): LatencyStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((s, v) => s + v, 0)
  const avg = sum / sorted.length
  const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / sorted.length
  return {
    count: sorted.length,
    avg,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    stdDev: Math.sqrt(variance)
  }
}

/** Accumulates rows; `snapshot()` computes the statistics. */
export class RunnerStatsCollector {
  private readonly perItem = new Map<string, { name: string; rows: RunnerRow[] }>()
  private readonly all: RunnerRow[] = []

  constructor(items: readonly { id: string; name: string }[]) {
    for (const item of items) this.perItem.set(item.id, { name: item.name, rows: [] })
  }

  add(row: RunnerRow): void {
    this.all.push(row)
    let entry = this.perItem.get(row.itemId)
    if (!entry) {
      entry = { name: row.name, rows: [] }
      this.perItem.set(row.itemId, entry)
    }
    entry.rows.push(row)
  }

  snapshot(): RunnerStats {
    const statusCodes: Record<string, number> = {}
    const errorCodes: Record<string, number> = {}
    const buckets = new Map<number, number[]>()
    const counts = new Map<number, number>()
    for (const row of this.all) {
      if (row.status !== null) statusCodes[row.status] = (statusCodes[row.status] ?? 0) + 1
      if (row.errorCode) errorCodes[row.errorCode] = (errorCodes[row.errorCode] ?? 0) + 1
      const second = Math.floor((row.startedAt + row.timeMs) / 1000)
      counts.set(second, (counts.get(second) ?? 0) + 1)
      if (row.status !== null) {
        const list = buckets.get(second) ?? []
        list.push(row.timeMs)
        buckets.set(second, list)
      }
    }
    const last = Math.max(-1, ...counts.keys())
    const timeline: TimelinePoint[] = []
    for (let second = 0; second <= last; second++) {
      const times = (buckets.get(second) ?? []).sort((a, b) => a - b)
      timeline.push({
        second,
        requests: counts.get(second) ?? 0,
        p50: times.length > 0 ? percentile(times, 50) : null,
        p95: times.length > 0 ? percentile(times, 95) : null
      })
    }
    return {
      items: [...this.perItem].map(([id, e]) => statsRow(id, e.name, e.rows)),
      total: statsRow('', '總計', this.all),
      statusCodes,
      errorCodes,
      timeline
    }
  }
}

function statsRow(itemId: string, name: string, rows: readonly RunnerRow[]): RunnerStatsRow {
  const failed = rows.filter((r) => r.failed).length
  const testsPassed = rows.reduce((s, r) => s + r.testsPassed, 0)
  const testsTotal = rows.reduce((s, r) => s + r.testsTotal, 0)
  return {
    itemId,
    name,
    count: rows.length,
    succeeded: rows.length - failed,
    failed,
    errorRate: rows.length === 0 ? 0 : failed / rows.length,
    testsPassed,
    testsFailed: testsTotal - testsPassed,
    latency: latencyStats(rows.filter((r) => r.status !== null).map((r) => r.timeMs))
  }
}

// ---------------------------------------------------------------------------------
// Data files (decision 89)
// ---------------------------------------------------------------------------------

export class DataFileError extends Error {}

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF / LF; the first row holds the column names. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const c = input[i] as string
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') {
      quoted = true
    } else if (c === ',') {
      record.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += c
  }
  if (quoted) throw new DataFileError('CSV 的引號沒有結束')
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ''))
  const header = nonEmpty.shift()
  if (!header || header.every((h) => h.trim() === '')) throw new DataFileError('CSV 沒有欄位名稱')
  return nonEmpty.map((r) => {
    const row: Record<string, string> = {}
    header.forEach((name, i) => {
      if (name.trim() !== '') row[name.trim()] = r[i] ?? ''
    })
    return row
  })
}

/** JSON: an array of objects; values become strings (objects as JSON). */
export function parseJsonData(text: string): Record<string, string>[] {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new DataFileError('不是有效的 JSON')
  }
  if (!Array.isArray(value)) throw new DataFileError('JSON 資料檔必須是物件陣列')
  return value.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new DataFileError(`第 ${i + 1} 筆不是物件`)
    }
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      row[k] = typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v)
    }
    return row
  })
}

export function parseDataFile(fileName: string, text: string): Record<string, string>[] {
  const rows = /\.json$/i.test(fileName) ? parseJsonData(text) : parseCsv(text)
  if (rows.length === 0) throw new DataFileError('資料檔沒有任何資料列')
  if (rows.length > RUNNER_MAX_DATA_ROWS) {
    throw new DataFileError(`資料列超過 ${RUNNER_MAX_DATA_ROWS} 列`)
  }
  return rows
}
