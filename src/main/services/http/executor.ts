/**
 * Sends a request with its scripts, extractions and assertions (decisions 70–73):
 *
 *   Pre-request script → variable substitution + send → extractions
 *   → Post-response script → assertions
 *
 * Scripts run in the sandbox (`runScript`); their variable changes are applied here.
 * Used by `http:send` and, from Phase 5c, by the Collection Runner.
 */
import { randomUUID } from 'node:crypto'
import { evaluateAssertions, runExtractions, type ResponseFacts } from '@shared/assertions'
import type { HttpErrorData, HttpResponseData, HttpResult } from '@shared/http'
import { HTTP_METHODS, type HttpMethod, type Variable } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import {
  SCRIPT_BODY_LIMIT_BYTES,
  SCRIPT_TIMEOUT_MS,
  hasScripts,
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
import type { HttpService, SendInput } from './http-service'

export interface ExecutorDeps {
  http: HttpService
  runtime: RuntimeVariables
  runScript(input: ScriptRunInput): Promise<ScriptRunOutput>
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
}

export interface ExecuteInput extends SendInput {
  /** The user chose "這次不執行腳本" (or the request is run where scripts are off). */
  skipScripts?: boolean
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

export class RequestExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(input: ExecuteInput): Promise<HttpResult> {
    const request = input.request
    const scriptsPresent = hasScripts(request.scripts)
    const runScripts = scriptsPresent && !input.skipScripts
    const extractions = request.extractions.filter((e) => e.enabled && e.variable.trim() !== '')
    const assertions = request.assertions.filter((a) => a.enabled)
    if (!scriptsPresent && extractions.length === 0 && assertions.length === 0) {
      return this.deps.http.send(input)
    }

    const workspace = this.deps.workspacePath()
    const report = emptyReport(scriptsPresent && !runScripts)
    if (runScripts && (!workspace || !this.deps.isTrusted(workspace))) {
      return this.fail(input, '這個 Workspace 的腳本尚未信任，沒有發送', report)
    }

    let sending = request
    const pre = request.scripts.preRequest
    if (runScripts && pre.trim() !== '') {
      const out = await this.runPhase(
        'preRequest',
        pre,
        input,
        scriptRequestOf(request),
        null,
        report
      )
      if (out.request) sending = applyScriptRequest(request, out.request)
      if (out.error) return this.fail(input, `Pre-request 腳本錯誤：${out.error}`, report)
    }

    const result = await this.deps.http.send({ ...input, request: sending })
    if (result.kind !== 'response') return { ...result, scriptReport: report }

    const facts = this.facts(result)
    if (extractions.length > 0) {
      report.extractions = runExtractions(extractions, facts)
      const changes = report.extractions.flatMap((e): VariableChange[] =>
        e.value === null ? [] : [{ scope: e.scope, name: e.variable, value: e.value }]
      )
      await this.applyChanges(changes, 'extraction', input, report)
    }

    const post = request.scripts.postResponse
    if (runScripts && post.trim() !== '') {
      const sent: ScriptRequest = {
        method: sending.method,
        url: result.url,
        headers: result.requestHeaders,
        body: scriptRequestOf(sending).body
      }
      await this.runPhase(
        'postResponse',
        post,
        input,
        sent,
        this.scriptResponse(result, facts),
        report
      )
    }

    if (assertions.length > 0) {
      // Expected values see variables set by the extractions and the script above.
      const layers = await this.deps.getVariableLayers(input.parentId, input.environmentId)
      const resolver = new VariableResolver(buildVariableMap(layers))
      report.assertions = evaluateAssertions(assertions, facts, (t) => resolver.resolve(t))
    }
    return { ...result, scriptReport: report }
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
    code: string,
    input: ExecuteInput,
    request: ScriptRequest,
    response: ScriptResponse | null,
    report: ScriptReport
  ): Promise<ScriptRunOutput> {
    const workspace = this.deps.workspacePath()
    const [environment, collection] = await Promise.all([
      this.deps.getEnvironment(input.environmentId),
      this.deps.getCollection(input.parentId)
    ])
    let out: ScriptRunOutput
    try {
      out = await this.deps.runScript({
        phase,
        code,
        variables: {
          runtime: workspace ? this.deps.runtime.values(workspace) : {},
          environment: environment ? enabledRecord(environment.variables) : null,
          collection: collection ? enabledRecord(collection.variables) : null
        },
        info: {
          requestName: input.request.name,
          environmentName: environment?.name ?? null,
          collectionName: collection?.name ?? null
        },
        request,
        response,
        timeoutMs: SCRIPT_TIMEOUT_MS
      })
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
    report[phase] = {
      error: out.error,
      logs: out.logs,
      tests: out.tests,
      durationMs: out.durationMs
    }
    await this.applyChanges(out.changes, phase, input, report, collection?.id ?? null)
    return out
  }

  private async applyChanges(
    changes: VariableChange[],
    by: ScriptPhase | 'extraction',
    input: ExecuteInput,
    report: ScriptReport,
    collectionId: string | null = null
  ): Promise<void> {
    if (changes.length === 0) return
    report.changes.push(...changes.map((c) => ({ ...c, by })))
    const workspace = this.deps.workspacePath()
    const of = (scope: VariableChange['scope']) => changes.filter((c) => c.scope === scope)

    if (workspace) this.deps.runtime.apply(workspace, of('runtime'))
    let environmentId: string | null = null
    const env = of('environment')
    if (env.length > 0) {
      if (input.environmentId === null) {
        report.changeErrors.push('目前沒有選擇環境，擷取的值沒有存到環境')
      } else {
        try {
          await this.deps.applyEnvironmentChanges(input.environmentId, env)
          environmentId = input.environmentId
        } catch (error) {
          report.changeErrors.push(`無法寫入環境變數：${String(error)}`)
        }
      }
    }
    let changedCollection: string | null = null
    const col = of('collection')
    if (col.length > 0 && collectionId) {
      try {
        await this.deps.applyCollectionChanges(collectionId, col)
        changedCollection = collectionId
      } catch (error) {
        report.changeErrors.push(`無法寫入 Collection 變數：${String(error)}`)
      }
    }
    if (environmentId || changedCollection) {
      this.deps.variablesChanged({ environmentId, collectionId: changedCollection })
    }
  }
}
