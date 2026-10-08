/**
 * Sends a request with its scripts, extractions and assertions (decisions 70–73, 126):
 *
 *   Pre-request scripts (collection → folders → request) → variable substitution + send
 *   → extractions → Post-response scripts (order: the collection's script flow) → assertions
 *
 * Scripts run in the sandbox (`runScript`); their variable changes are applied here.
 * Used by `http:send` and, from Phase 5c, by the Collection Runner.
 */
import { randomUUID } from 'node:crypto'
import { evaluateAssertions, runExtractions, type ResponseFacts } from '@shared/assertions'
import type { HttpErrorData, HttpResponseData, HttpResult } from '@shared/http'
import { HTTP_METHODS, type HttpMethod, type Variable } from '@shared/schemas/collection'
import { httpRequestSchema, type HttpRequest } from '@shared/schemas/http-request'
import {
  SCRIPT_BODY_LIMIT_BYTES,
  SCRIPT_MAX_RUN_DEPTH,
  hasScripts,
  type HostCall,
  type HostReply,
  type HostRequest,
  type ScriptPhase,
  type ScriptReport,
  type ScriptRequest,
  type ScriptResponse,
  type ScriptRunInput,
  type ScriptRunOutput,
  type VariableChange
} from '@shared/scripts'
import { VariableResolver, buildVariableMap, type VariableLayer } from '@shared/variables'
import type { RuntimeVariables } from '../runtime-variables'
import type { ContainerLevel } from './build-request'
import type { CookieJar } from './cookie-jar'
import type { HttpService, SendInput } from './http-service'

export interface ExecutorDeps {
  http: HttpService
  runtime: RuntimeVariables
  runScript(
    input: ScriptRunInput,
    host?: (call: HostCall) => Promise<HostReply>
  ): Promise<ScriptRunOutput>
  /** Folder of the current Workspace (runtime variables and trust are per Workspace). */
  workspacePath(): string | null
  isTrusted(workspacePath: string): boolean
  getEnvironment(id: string | null): Promise<{ name: string; variables: Variable[] } | null>
  getCollection(
    parentId: string | null
  ): Promise<{ id: string; name: string; variables: Variable[] } | null>
  /** Same layers as sending uses: runtime, environment, collection. */
  getVariableLayers(parentId: string | null, environmentId: string | null): Promise<VariableLayer[]>
  applyEnvironmentChanges(id: string, changes: VariableChange[]): Promise<void>
  applyCollectionChanges(id: string, changes: VariableChange[]): Promise<void>
  /** Tells the renderer that stored variables changed (to refresh highlighting / editors). */
  variablesChanged(change: { environmentId: string | null; collectionId: string | null }): void
  /** Collection and folders above a request, outermost first ([] outside a collection). */
  getScriptChain(parentId: string | null): Promise<ContainerLevel[]>
  /** Total time a script may take, waiting included (Workspace setting, decision 127). */
  scriptTimeoutMs(): Promise<number>
  /**
   * A saved HTTP request for runRequest: by id, or by its name path inside the collection
   * that contains `parentId` ("Folder/Request").
   */
  findRequest(
    parentId: string | null,
    path: string
  ): Promise<{ id: string; parentId: string; request: HttpRequest } | null>
}

/** One script to run: a collection's, a folder's, or the request's own (label null). */
interface ScriptStep {
  label: string | null
  code: string
}

const levelLabel = (level: ContainerLevel) =>
  `${level.kind === 'collection' ? 'Collection' : '資料夾'}「${level.name}」`

/**
 * Pre-request steps run outside in (collection → folders → request). Post-response steps
 * follow the collection's flow: the same order (sequential), or inside out (sandwich).
 */
export function scriptSteps(
  chain: readonly ContainerLevel[],
  own: { preRequest: string; postResponse: string }
): { pre: ScriptStep[]; post: ScriptStep[] } {
  const levels = chain.filter((l) => hasScripts(l.scripts))
  const pre = [
    ...levels.map((l) => ({ label: levelLabel(l), code: l.scripts.preRequest })),
    { label: null, code: own.preRequest }
  ]
  const outerFirst = [
    ...levels.map((l) => ({ label: levelLabel(l), code: l.scripts.postResponse })),
    { label: null, code: own.postResponse }
  ]
  const post = chain[0]?.scriptFlow === 'sandwich' ? [...outerFirst].reverse() : outerFirst
  const present = (step: ScriptStep) => step.code.trim() !== ''
  return { pre: pre.filter(present), post: post.filter(present) }
}

export interface ExecuteInput extends SendInput {
  /** The user chose "這次不執行腳本" (or the request is run where scripts are off). */
  skipScripts?: boolean
  /** runRequest nesting (decision 127): 0 for a request sent from the editor / Runner. */
  depth?: number
}

/** A response (or failure) as scripts see it from sendRequest / runRequest. */
function hostReplyOf(result: HttpResult): HostReply {
  if (result.kind !== 'response') return { ok: false, error: result.message }
  const body =
    result.body.kind === 'text' ? result.body.text : result.body.kind === 'empty' ? '' : null
  return {
    ok: true,
    response: {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.bodyBytes > SCRIPT_BODY_LIMIT_BYTES ? null : body,
      timeMs: Math.round(result.timings.totalMs),
      sizeBytes: result.bodyBytes
    }
  }
}

/** Stored variables as a script sees them. */
async function scriptVariables(scope: ExecutionScope): Promise<ScriptRunInput['variables']> {
  const [environment, collection] = await Promise.all([scope.environment(), scope.collection()])
  return {
    runtime: scope.runtimeValues(),
    environment: environment ? enabledRecord(environment.variables) : null,
    collection: collection ? enabledRecord(collection.variables) : null
  }
}

const enabledRecord = (variables: readonly Variable[]): Record<string, string> => {
  const record: Record<string, string> = {}
  for (const v of variables) {
    const name = v.key.trim()
    if (v.enabled && name !== '' && !Object.hasOwn(record, name)) record[name] = v.value
  }
  return record
}

function emptyReport(scriptsSkipped: boolean): ScriptReport {
  return {
    preRequest: null,
    postResponse: null,
    extractions: [],
    assertions: [],
    changes: [],
    changeErrors: [],
    scriptsSkipped
  }
}

/** The editable view of a request given to a Pre-request script. */
function scriptRequestOf(request: HttpRequest): ScriptRequest {
  const body = request.body
  return {
    method: request.method,
    url: request.url,
    headers: request.headers
      .filter((h) => h.enabled && h.key.trim() !== '')
      .map((h): [string, string] => [h.key, h.value]),
    body: body.mode === 'json' ? body.json : body.mode === 'raw' ? body.raw : null
  }
}

/** Puts a Pre-request script's changes back into the request (still unresolved). */
export function applyScriptRequest(request: HttpRequest, changed: ScriptRequest): HttpRequest {
  const method = changed.method.toUpperCase()
  const own = request.headers.filter((h) => h.enabled && h.key.trim() !== '')
  const headers = changed.headers.map(([key, value], i) => {
    // Keep the row (id, description) when the script left the header in place.
    const same = own[i]
    return same && same.key === key
      ? { ...same, value }
      : { id: randomUUID(), key, value, enabled: true }
  })
  const body = request.body
  return {
    ...request,
    method: (HTTP_METHODS as readonly string[]).includes(method)
      ? (method as HttpMethod)
      : request.method,
    url: changed.url,
    headers: [...headers, ...request.headers.filter((h) => !h.enabled || h.key.trim() === '')],
    body:
      changed.body === null
        ? body
        : body.mode === 'json'
          ? { ...body, json: changed.body }
          : body.mode === 'raw'
            ? { ...body, raw: changed.body }
            : body
  }
}

/**
 * Where a send reads and writes variables. The default scope is the app itself (runtime
 * variables of the Workspace, environment / Collection files). The Collection Runner uses
 * in-memory copies per worker (decision 91) and adds data-file rows (decision 89).
 */
export interface ExecutionScope {
  runtimeValues(): Record<string, string>
  applyRuntime(changes: VariableChange[]): void
  environment(): Promise<{ name: string; variables: Variable[] } | null>
  collection(): Promise<{ id: string; name: string; variables: Variable[] } | null>
  /** Throws when it cannot store them; only called when environment() is not null. */
  applyEnvironment(changes: VariableChange[]): Promise<void>
  applyCollection(changes: VariableChange[]): Promise<void>
  /** Layers for substitution and assertions, highest precedence first. */
  layers(): Promise<VariableLayer[]>
  iterationData: Record<string, string> | null
  iteration: { index: number; count: number }
  /** Runner workers with concurrency > 1 use their own jar; absent = the Workspace's. */
  cookies?: CookieJar | null
}

/** Data-file row as a variable layer (between runtime and environment, decision 89). */
export function dataLayer(row: Record<string, string> | null): VariableLayer | null {
  if (!row) return null
  return {
    source: 'data',
    sourceName: '資料檔',
    variables: Object.entries(row).map(([key, value]) => ({
      id: `data:${key}`,
      key,
      value,
      enabled: true,
      secret: false
    }))
  }
}

export class RequestExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  /** The app's own variables, as for a send from the editor (decision 91: concurrency 1 too). */
  appScope(
    input: { parentId: string | null; environmentId: string | null },
    data: Record<string, string> | null = null,
    iteration = { index: 0, count: 1 }
  ): ExecutionScope {
    const deps = this.deps
    let collectionId: string | null = null
    return {
      runtimeValues: () => {
        const ws = deps.workspacePath()
        return ws ? deps.runtime.values(ws) : {}
      },
      applyRuntime: (changes) => {
        const ws = deps.workspacePath()
        if (ws) deps.runtime.apply(ws, changes)
      },
      environment: () => deps.getEnvironment(input.environmentId),
      collection: async () => {
        const c = await deps.getCollection(input.parentId)
        collectionId = c?.id ?? null
        return c
      },
      applyEnvironment: async (changes) => {
        if (!input.environmentId) throw new Error('目前沒有選擇環境')
        await deps.applyEnvironmentChanges(input.environmentId, changes)
        deps.variablesChanged({ environmentId: input.environmentId, collectionId: null })
      },
      applyCollection: async (changes) => {
        const id = collectionId ?? (await deps.getCollection(input.parentId))?.id
        if (!id) throw new Error('這個請求不在 Collection 中')
        await deps.applyCollectionChanges(id, changes)
        deps.variablesChanged({ environmentId: null, collectionId: id })
      },
      layers: async () => {
        const layers = await deps.getVariableLayers(input.parentId, input.environmentId)
        const row = dataLayer(data)
        if (!row) return layers
        // Runtime first, then the data row, then environment / collection.
        const runtime = layers.filter((l) => l.source === 'runtime')
        return [...runtime, row, ...layers.filter((l) => l.source !== 'runtime')]
      },
      iterationData: data,
      iteration
    }
  }

  async execute(
    input: ExecuteInput,
    scope: ExecutionScope = this.appScope(input)
  ): Promise<HttpResult> {
    const request = input.request
    const chain = input.parentId ? await this.deps.getScriptChain(input.parentId) : []
    const steps = scriptSteps(chain, request.scripts)
    const scriptsPresent = steps.pre.length > 0 || steps.post.length > 0
    const runScripts = scriptsPresent && !input.skipScripts
    const extractions = request.extractions.filter((e) => e.enabled && e.variable.trim() !== '')
    const assertions = request.assertions.filter((a) => a.enabled)
    if (!scriptsPresent && extractions.length === 0 && assertions.length === 0) {
      return this.deps.http.send({
        ...input,
        layers: await scope.layers(),
        cookies: scope.cookies
      })
    }

    const workspace = this.deps.workspacePath()
    const report = emptyReport(scriptsPresent && !runScripts)
    if (runScripts && (!workspace || !this.deps.isTrusted(workspace))) {
      return this.fail(input, '這個 Workspace 的腳本尚未信任，沒有發送', report)
    }

    let sending = request
    for (const step of runScripts ? steps.pre : []) {
      // Each script sees the request as the scripts before it left it.
      const out = await this.runPhase(
        'preRequest',
        step,
        input,
        scope,
        scriptRequestOf(sending),
        null,
        report
      )
      if (out.request) sending = applyScriptRequest(sending, out.request)
      if (out.error) {
        const where = step.label ? `${step.label}的 ` : ''
        return this.fail(input, `${where}Pre-request 腳本錯誤：${out.error}`, report)
      }
    }

    const result = await this.deps.http.send({
      ...input,
      request: sending,
      layers: await scope.layers(),
      cookies: scope.cookies
    })
    if (result.kind !== 'response') return { ...result, scriptReport: report }

    const facts = this.facts(result)
    if (extractions.length > 0) {
      report.extractions = runExtractions(extractions, facts)
      const changes = report.extractions.flatMap((e): VariableChange[] =>
        e.value === null ? [] : [{ scope: e.scope, name: e.variable, value: e.value }]
      )
      await this.applyChanges(changes, 'extraction', scope, report)
    }

    if (runScripts && steps.post.length > 0) {
      const sent: ScriptRequest = {
        method: sending.method,
        url: result.url,
        headers: result.requestHeaders,
        body: scriptRequestOf(sending).body
      }
      const response = this.scriptResponse(result, facts)
      // A failing script does not stop the others (the first error is reported).
      for (const step of steps.post) {
        await this.runPhase('postResponse', step, input, scope, sent, response, report)
      }
    }

    if (assertions.length > 0) {
      // Expected values see variables set by the extractions and the script above.
      const resolver = new VariableResolver(buildVariableMap(await scope.layers()))
      report.assertions = evaluateAssertions(assertions, facts, (t) => resolver.resolve(t))
    }
    return { ...result, scriptReport: report }
  }

  /** sendRequest / runRequest from a script (decision 127): not recorded in history. */
  private async hostCall(
    call: HostCall,
    input: ExecuteInput,
    scope: ExecutionScope
  ): Promise<HostReply> {
    if (call.op === 'sendRequest') return this.sendFromScript(call.request, scope)
    const depth = (input.depth ?? 0) + 1
    if (depth > SCRIPT_MAX_RUN_DEPTH) {
      return { ok: false, error: `runRequest 最多巢狀 ${SCRIPT_MAX_RUN_DEPTH} 層` }
    }
    const found = await this.deps.findRequest(input.parentId, call.path)
    if (!found) return { ok: false, error: `找不到請求「${call.path}」` }
    const result = await this.execute(
      {
        runId: randomUUID(),
        parentId: found.parentId,
        environmentId: input.environmentId,
        request: found.request,
        skipScripts: input.skipScripts,
        depth
      },
      scope
    )
    const reply = hostReplyOf(result)
    return reply.ok ? { ...reply, variables: await scriptVariables(scope) } : reply
  }

  /** A plain request: no inherited settings, no {{variable}} substitution (as Postman). */
  private async sendFromScript(spec: HostRequest, scope: ExecutionScope): Promise<HostReply> {
    const method = spec.method.toUpperCase()
    if (!(HTTP_METHODS as readonly string[]).includes(method)) {
      return { ok: false, error: `sendRequest 不支援的 HTTP 方法：${spec.method}` }
    }
    if (!/^https?:\/\//i.test(spec.url)) {
      return { ok: false, error: `sendRequest 的網址需要 http:// 或 https://：${spec.url}` }
    }
    const contentType = spec.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
    const request = httpRequestSchema.parse({
      version: 1,
      id: 'script-request',
      type: 'http',
      name: 'sendRequest',
      method,
      url: spec.url,
      headers: spec.headers.map(([key, value], i) => ({ id: `h${i}`, key, value, enabled: true })),
      body:
        spec.body === null
          ? { mode: 'none' }
          : { mode: 'raw', raw: spec.body, rawContentType: contentType ?? 'text/plain' },
      auth: { type: 'none' }
    })
    const result = await this.deps.http.send({
      runId: randomUUID(),
      parentId: null,
      environmentId: null,
      request,
      layers: [],
      storeBody: false,
      cookies: scope.cookies
    })
    return hostReplyOf(result)
  }

  private fail(input: ExecuteInput, message: string, report: ScriptReport): HttpErrorData {
    return {
      kind: 'error',
      runId: input.runId,
      code: 'SCRIPT',
      message,
      url: input.request.url,
      timings: { totalMs: 0 },
      unresolvedVariables: [],
      scriptReport: report
    }
  }

  private facts(result: HttpResponseData): ResponseFacts {
    let body: string | null = null
    if (result.body.kind === 'text') body = result.body.text
    else if (result.body.kind === 'empty') body = ''
    return { status: result.status, timeMs: result.timings.totalMs, headers: result.headers, body }
  }

  private scriptResponse(result: HttpResponseData, facts: ResponseFacts): ScriptResponse {
    const unavailable =
      result.body.kind === 'binary'
        ? '回應不是文字（二進位內容），腳本無法讀取'
        : result.body.kind === 'large' || result.bodyBytes > SCRIPT_BODY_LIMIT_BYTES
          ? `回應超過 ${SCRIPT_BODY_LIMIT_BYTES / 1024 / 1024} MB，腳本無法讀取`
          : null
    return {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      timeMs: Math.round(result.timings.totalMs),
      sizeBytes: result.bodyBytes,
      body: unavailable ? null : facts.body,
      bodyUnavailable: unavailable
    }
  }

  private async runPhase(
    phase: ScriptPhase,
    step: ScriptStep,
    input: ExecuteInput,
    scope: ExecutionScope,
    request: ScriptRequest,
    response: ScriptResponse | null,
    report: ScriptReport
  ): Promise<ScriptRunOutput> {
    const [environment, collection] = await Promise.all([scope.environment(), scope.collection()])
    let out: ScriptRunOutput
    try {
      const timeoutMs = await this.deps.scriptTimeoutMs()
      const host = (call: HostCall) => this.hostCall(call, input, scope)
      out = await this.deps.runScript(
        {
          phase,
          code: step.code,
          variables: await scriptVariables(scope),
          iterationData: scope.iterationData,
          info: {
            requestName: input.request.name,
            environmentName: environment?.name ?? null,
            collectionName: collection?.name ?? null,
            iteration: scope.iteration.index,
            iterationCount: scope.iteration.count
          },
          request,
          response,
          timeoutMs
        },
        host
      )
    } catch (error) {
      out = {
        error: `無法執行腳本：${error instanceof Error ? error.message : String(error)}`,
        logs: [],
        tests: [],
        changes: [],
        request: null,
        durationMs: 0
      }
    }
    // Several scripts per phase: one report, their parts labelled in the console.
    if (out.nextRequest !== undefined) report.nextRequest = out.nextRequest
    const before = report[phase]
    const logs = step.label
      ? [{ level: 'info' as const, text: `── ${step.label}的腳本 ──` }, ...out.logs]
      : out.logs
    const error = out.error && step.label ? `${step.label}：${out.error}` : out.error
    report[phase] = before
      ? {
          error: before.error ?? error,
          logs: [...before.logs, ...logs],
          tests: [...before.tests, ...out.tests],
          durationMs: before.durationMs + out.durationMs
        }
      : { error, logs, tests: out.tests, durationMs: out.durationMs }
    await this.applyChanges(out.changes, phase, scope, report)
    return out
  }

  private async applyChanges(
    changes: VariableChange[],
    by: ScriptPhase | 'extraction',
    scope: ExecutionScope,
    report: ScriptReport
  ): Promise<void> {
    if (changes.length === 0) return
    report.changes.push(...changes.map((c) => ({ ...c, by })))
    const of = (s: VariableChange['scope']) => changes.filter((c) => c.scope === s)

    scope.applyRuntime(of('runtime'))
    const env = of('environment')
    if (env.length > 0) {
      if (!(await scope.environment())) {
        report.changeErrors.push('目前沒有選擇環境，擷取的值沒有存到環境')
      } else {
        try {
          await scope.applyEnvironment(env)
        } catch (error) {
          report.changeErrors.push(`無法寫入環境變數：${String(error)}`)
        }
      }
    }
    const col = of('collection')
    if (col.length > 0) {
      try {
        await scope.applyCollection(col)
      } catch (error) {
        report.changeErrors.push(`無法寫入 Collection 變數：${String(error)}`)
      }
    }
  }
}
