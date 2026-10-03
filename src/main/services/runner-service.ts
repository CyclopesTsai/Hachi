/**
 * Collection Runner (Phase 5c, decisions 74–77, 86–92). Runs the saved requests of a
 * Collection / folder in order, `iterations` rounds per worker with `concurrency` workers,
 * through the same pipeline as sending from the editor (scripts, extractions, assertions).
 * Results stay in memory (rows + statistics); the renderer pages through them over IPC.
 */
import { performance } from 'node:perf_hooks'
import { HachiError } from '@shared/errors'
import type { HttpResult } from '@shared/http'
import {
  RUNNER_BODY_LIMIT_BYTES,
  RUNNER_BODY_TOTAL_BYTES,
  RUNNER_DETAIL_ROWS,
  RunnerStatsCollector,
  type RunnerConfig,
  type RunnerEvent,
  type RunnerItem,
  type RunnerProgress,
  type RunnerRow,
  type RunnerRowDetail,
  type RunnerStatus
} from '@shared/runner'
import type { Variable } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import { hasScripts, testSummary, type VariableChange } from '@shared/scripts'
import { findNode, isContainer, type TreeNode, type WorkspaceTree } from '@shared/tree'
import { applyVariableChanges, type VariableLayer } from '@shared/variables'
import { dataLayer, type ExecutionScope, type RequestExecutor } from './http/executor'

export interface RunnerDeps {
  executor: RequestExecutor
  cancelHttp(runId: string): void
  getTree(): Promise<WorkspaceTree>
  getRequest(id: string): Promise<HttpRequest | null>
  runtimeValues(): Record<string, string>
  getEnvironment(id: string | null): Promise<{ name: string; variables: Variable[] } | null>
  getCollection(
    parentId: string | null
  ): Promise<{ id: string; name: string; variables: Variable[] } | null>
  scriptsTrusted(): boolean
  emit(event: RunnerEvent): void
  /** How often progress is pushed while running. */
  progressIntervalMs?: number
}

interface PlannedItem extends RunnerItem {
  parentId: string
  request: HttpRequest
}

/** In-memory variables of one worker when running in parallel (decision 91). */
interface WorkerState {
  runtime: Map<string, string>
  environment: { name: string; variables: Variable[] } | null
  collection: { id: string; name: string; variables: Variable[] } | null
}

interface Run {
  id: string
  config: RunnerConfig
  targetName: string
  environmentName: string | null
  items: PlannedItem[]
  skipped: string[]
  status: RunnerStatus
  message: string | null
  startedAt: number
  startedAtIso: string
  finishedAt: number | null
  totalRounds: number
  nextRound: number
  completedRounds: number
  rows: RunnerRow[]
  details: Map<number, RunnerRowDetail>
  failedDetails: number
  bodyBytes: number
  stats: RunnerStatsCollector
  inFlight: Set<string>
  timer: ReturnType<typeof setInterval> | null
  done: Promise<void>
}

const MAX_RUNS_IN_MEMORY = 5

function pathOf(tree: WorkspaceTree, id: string): string {
  const names: string[] = []
  for (let current = findNode(tree, id); current;) {
    names.unshift(current.node.name)
    current = current.parent ? findNode(tree, current.parent.id) : null
  }
  return names.join(' / ')
}

function memoryScope(
  state: WorkerState,
  data: Record<string, string> | null,
  iteration: { index: number; count: number }
): ExecutionScope {
  return {
    runtimeValues: () => Object.fromEntries(state.runtime),
    applyRuntime: (changes) => {
      for (const c of changes) {
        if (c.value === null) state.runtime.delete(c.name)
        else state.runtime.set(c.name, c.value)
      }
    },
    environment: async () => state.environment,
    collection: async () => state.collection,
    applyEnvironment: async (changes: VariableChange[]) => {
      if (!state.environment) throw new Error('目前沒有選擇環境')
      state.environment = {
        ...state.environment,
        variables: applyVariableChanges(state.environment.variables, changes)
      }
    },
    applyCollection: async (changes: VariableChange[]) => {
      if (!state.collection) throw new Error('這個請求不在 Collection 中')
      state.collection = {
        ...state.collection,
        variables: applyVariableChanges(state.collection.variables, changes)
      }
    },
    layers: async () => {
      const layers: (VariableLayer | null)[] = [
        state.runtime.size > 0
          ? {
              source: 'runtime',
              sourceName: '暫存變數',
              variables: [...state.runtime].map(([key, value]) => ({
                id: `runtime:${key}`,
                key,
                value,
                enabled: true,
                secret: false
              }))
            }
          : null,
        dataLayer(data),
        state.environment
          ? {
              source: 'environment',
              sourceName: state.environment.name,
              variables: state.environment.variables
            }
          : null,
        state.collection
          ? {
              source: 'collection',
              sourceName: state.collection.name,
              variables: state.collection.variables
            }
          : null
      ]
      return layers.filter((l): l is VariableLayer => l !== null)
    },
    iterationData: data,
    iteration
  }
}

export class RunnerService {
  private readonly runs = new Map<string, Run>()

  constructor(private readonly deps: RunnerDeps) {}

  /** Plans the run and starts it in the background. */
  async start(
    runId: string,
    config: RunnerConfig
  ): Promise<{ totalRounds: number; items: RunnerItem[]; skipped: string[] }> {
    if (this.runs.has(runId)) throw new HachiError('INVALID_OPERATION', 'This run already exists')
    const tree = await this.deps.getTree()
    const target = findNode(tree, config.targetId)?.node
    if (!target || !isContainer(target)) {
      throw new HachiError('NOT_FOUND', '找不到要執行的 Collection / 資料夾')
    }

    // Requests below the target, in tree order, restricted to the checked ones.
    const wanted = new Set(config.itemIds)
    const items: PlannedItem[] = []
    const skipped: string[] = []
    const walk = async (node: TreeNode, parentId: string): Promise<void> => {
      if (isContainer(node)) {
        for (const child of node.children) await walk(child, node.id)
        return
      }
      if (!wanted.has(node.id)) return
      const path = pathOf(tree, node.id)
      if (node.requestType !== 'http' || node.error) {
        skipped.push(path)
        return
      }
      const request = await this.deps.getRequest(node.id)
      if (!request) {
        skipped.push(path)
        return
      }
      items.push({ id: node.id, name: node.name, method: request.method, path, parentId, request })
    }
    for (const child of target.children) await walk(child, target.id)
    if (items.length === 0) throw new HachiError('INVALID_OPERATION', '沒有可以執行的 HTTP 請求')
    if (
      !config.skipScripts &&
      items.some((i) => hasScripts(i.request.scripts)) &&
      !this.deps.scriptsTrusted()
    ) {
      throw new HachiError('INVALID_OPERATION', '這個 Workspace 的腳本尚未信任')
    }

    const environment = await this.deps.getEnvironment(config.environmentId)
    const totalRounds = config.iterations * config.concurrency
    const run: Run = {
      id: runId,
      config,
      targetName: target.name,
      environmentName: environment?.name ?? null,
      items,
      skipped,
      status: 'running',
      message: null,
      startedAt: performance.now(),
      startedAtIso: new Date().toISOString(),
      finishedAt: null,
      totalRounds,
      nextRound: 0,
      completedRounds: 0,
      rows: [],
      details: new Map(),
      failedDetails: 0,
      bodyBytes: 0,
      stats: new RunnerStatsCollector(items),
      inFlight: new Set(),
      timer: null,
      done: Promise.resolve()
    }
    this.runs.set(runId, run)
    this.evictOldRuns()
    run.timer = setInterval(() => this.emit(run), this.deps.progressIntervalMs ?? 500)
    run.done = this.execute(run)
      .catch((error: unknown) => {
        run.status = 'error'
        run.message = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        run.finishedAt = performance.now()
        if (run.timer) clearInterval(run.timer)
        run.timer = null
        this.emit(run)
      })
    return {
      totalRounds,
      items: items.map(({ id, name, method, path }) => ({ id, name, method, path })),
      skipped
    }
  }

  /** Resolves when the run has finished (tests). */
  wait(runId: string): Promise<void> {
    return this.runs.get(runId)?.done ?? Promise.resolve()
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run || run.status !== 'running') return false
    this.halt(run, 'cancelled', '已取消')
    return true
  }

  rows(
    runId: string,
    query: { offset: number; limit: number; failedOnly: boolean }
  ): { total: number; rows: RunnerRow[] } {
    const run = this.require(runId)
    const source = query.failedOnly ? run.rows.filter((r) => r.failed) : run.rows
    return { total: source.length, rows: source.slice(query.offset, query.offset + query.limit) }
  }

  /** One row with its details (null if they were not kept). */
  row(runId: string, index: number): RunnerRowDetail | null {
    return this.require(runId).details.get(index) ?? null
  }

  progress(runId: string): RunnerProgress {
    return this.progressOf(this.require(runId))
  }

  /** Everything as JSON (decision 74): settings, statistics and rows (with kept details). */
  exportJson(runId: string): { fileName: string; content: string } {
    const run = this.require(runId)
    const progress = this.progressOf(run)
    const data = {
      hachi: 'runner-result',
      version: 1,
      target: run.targetName,
      environment: run.environmentName,
      startedAt: run.startedAtIso,
      durationMs: progress.elapsedMs,
      status: run.status,
      message: run.message,
      settings: {
        iterations: run.config.iterations,
        concurrency: run.config.concurrency,
        delayMs: run.config.delayMs,
        stopOnFailure: run.config.stopOnFailure,
        keepBodies: run.config.keepBodies,
        dataFile: run.config.data?.fileName ?? null,
        skipScripts: run.config.skipScripts
      },
      requests: run.items.map(({ id, name, method, path }) => ({ id, name, method, path })),
      skipped: run.skipped,
      stats: progress.stats,
      rows: run.rows.map((r) => run.details.get(r.index) ?? r)
    }
    const stamp = run.startedAtIso.replace(/[:.]/g, '-')
    return {
      fileName: `runner-${stamp}.json`,
      content: `${JSON.stringify(data, null, 2)}\n`
    }
  }

  discard(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    if (run.status === 'running') this.halt(run, 'cancelled', '已取消')
    this.runs.delete(runId)
  }

  /** Workspace switched / window closed: stop everything. */
  cancelAll(): void {
    for (const run of this.runs.values()) {
      if (run.status === 'running') this.halt(run, 'cancelled', '已取消')
    }
  }

  private require(runId: string): Run {
    const run = this.runs.get(runId)
    if (!run) throw new HachiError('NOT_FOUND', '這次執行的結果已不在記憶體中')
    return run
  }

  private evictOldRuns(): void {
    for (const [id, run] of this.runs) {
      if (this.runs.size <= MAX_RUNS_IN_MEMORY) break
      if (run.status !== 'running') this.runs.delete(id)
    }
  }

  private halt(run: Run, status: RunnerStatus, message: string): void {
    if (run.status !== 'running') return
    run.status = status
    run.message = message
    for (const id of run.inFlight) this.deps.cancelHttp(id)
  }

  private async execute(run: Run): Promise<void> {
    const { config } = run
    const shared = config.concurrency === 1
    const base: WorkerState | null = shared
      ? null
      : {
          runtime: new Map(Object.entries(this.deps.runtimeValues())),
          environment: await this.deps.getEnvironment(config.environmentId),
          collection: await this.deps.getCollection(config.targetId)
        }
    const workers = Array.from({ length: config.concurrency }, (_, w) =>
      this.worker(
        run,
        w,
        base && {
          runtime: new Map(base.runtime),
          environment: base.environment && { ...base.environment },
          collection: base.collection && { ...base.collection }
        }
      )
    )
    await Promise.all(workers)
    if (run.status === 'running') run.status = 'done'
  }

  private async worker(run: Run, worker: number, state: WorkerState | null): Promise<void> {
    const { config } = run
    const rows = config.data?.rows ?? null
    for (let k = 0; k < config.iterations && run.status === 'running'; k++) {
      const round = run.nextRound++
      const data = rows ? (rows[round % rows.length] ?? null) : null
      const iteration = { index: round, count: run.totalRounds }
      for (let i = 0; i < run.items.length && run.status === 'running'; i++) {
        const item = run.items[i] as PlannedItem
        const scope = state
          ? memoryScope(state, data, iteration)
          : this.deps.executor.appScope(
              { parentId: item.parentId, environmentId: config.environmentId },
              data,
              iteration
            )
        const httpRunId = `${run.id}:${round}:${i}`
        run.inFlight.add(httpRunId)
        const startedAt = performance.now() - run.startedAt
        let result: HttpResult
        try {
          result = await this.deps.executor.execute(
            {
              runId: httpRunId,
              parentId: item.parentId,
              environmentId: config.environmentId,
              request: item.request,
              skipScripts: config.skipScripts,
              storeBody: false
            },
            scope
          )
        } finally {
          run.inFlight.delete(httpRunId)
        }
        // A request aborted by cancel / stop is not a result.
        if (run.status !== 'running' && result.kind === 'error' && result.code === 'CANCELLED') {
          return
        }
        const row = this.record(run, item, round, worker, startedAt, result, data)
        if (row.failed && config.stopOnFailure) {
          this.halt(run, 'stopped', `「${item.name}」失敗（第 ${round + 1} 輪），已停止`)
          return
        }
        const last = k === config.iterations - 1 && i === run.items.length - 1
        if (config.delayMs > 0 && !last && run.status === 'running') {
          await new Promise((r) => setTimeout(r, config.delayMs))
        }
      }
      if (run.status === 'running') run.completedRounds++
    }
  }

  private record(
    run: Run,
    item: PlannedItem,
    round: number,
    worker: number,
    startedAt: number,
    result: HttpResult,
    data: Record<string, string> | null
  ): RunnerRow {
    const report = result.scriptReport ?? null
    const tests = testSummary(report)
    const scriptFailed = !!(report?.preRequest?.error || report?.postResponse?.error)
    const isResponse = result.kind === 'response'
    const row: RunnerRow = {
      index: run.rows.length,
      round,
      worker,
      itemId: item.id,
      name: item.name,
      method: item.request.method,
      url: result.url,
      status: isResponse ? result.status : null,
      statusText: isResponse ? result.statusText : '',
      errorCode: isResponse ? null : result.code,
      errorMessage: isResponse ? null : result.message,
      timeMs: result.timings.totalMs,
      sizeBytes: isResponse ? result.bodyBytes : 0,
      testsPassed: tests.passed,
      testsTotal: tests.total,
      failed: !isResponse || scriptFailed || tests.passed < tests.total,
      startedAt
    }
    run.rows.push(row)
    run.stats.add(row)

    const keepDetail =
      run.details.size - run.failedDetails < RUNNER_DETAIL_ROWS ||
      (row.failed && run.failedDetails < RUNNER_DETAIL_ROWS)
    if (keepDetail) {
      if (row.failed && run.details.size >= RUNNER_DETAIL_ROWS) run.failedDetails++
      let body: string | null = null
      let bodyNote: string | null = run.config.keepBodies ? null : '沒有保留回應內容'
      if (run.config.keepBodies && isResponse) {
        if (result.body.kind !== 'text') {
          bodyNote =
            result.body.kind === 'empty' ? '（回應沒有內容）' : '回應不是文字或太大，沒有保留'
        } else if (result.bodyBytes > RUNNER_BODY_LIMIT_BYTES) {
          bodyNote = '回應超過 1 MB，沒有保留'
        } else if (run.bodyBytes + result.bodyBytes > RUNNER_BODY_TOTAL_BYTES) {
          bodyNote = '保留的回應已達 200 MB 上限，之後的不再保留'
        } else {
          body = result.body.text
          run.bodyBytes += result.bodyBytes
        }
      }
      run.details.set(row.index, {
        ...row,
        requestHeaders: isResponse ? result.requestHeaders : [],
        responseHeaders: isResponse ? result.headers : [],
        body,
        bodyNote,
        scriptReport: report,
        data
      })
    }
    return row
  }

  private progressOf(run: Run): RunnerProgress {
    const end = run.finishedAt ?? performance.now()
    return {
      runId: run.id,
      status: run.status,
      message: run.message,
      totalRounds: run.totalRounds,
      completedRounds: run.completedRounds,
      completedRequests: run.rows.length,
      totalRequests: run.totalRounds * run.items.length,
      elapsedMs: end - run.startedAt,
      stats: run.stats.snapshot(),
      skipped: run.skipped
    }
  }

  private emit(run: Run): void {
    if (!this.runs.has(run.id)) return
    this.deps.emit({ progress: this.progressOf(run) })
  }
}
