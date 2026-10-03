import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { HachiError } from '@shared/errors'
import type { HttpErrorCode, HttpResult, InheritedSettings } from '@shared/http'
import type { ProxySettings } from '@shared/schemas/app-config'
import type { HttpRequest } from '@shared/schemas/http-request'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import { VariableResolver, buildVariableMap, type VariableLayer } from '@shared/variables'
import {
  buildCodegenRequest,
  buildRequest,
  HttpBuildError,
  type CodegenBuild,
  type ContainerLevel
} from './build-request'
import { sendHttp } from './http-client'
import { resolveProxyUrl } from './proxy'
import { decodeText, suggestFileName } from './response-utils'

interface StoredResponse {
  body: Buffer
  contentType: string
  url: string
}

/** Keeps recent response bodies in memory so they can be shown in full or downloaded. */
export class ResponseStore {
  private readonly entries = new Map<string, StoredResponse>()
  private totalBytes = 0

  constructor(
    private readonly maxEntries = 20,
    private readonly maxTotalBytes = 300 * 1024 * 1024
  ) {}

  put(runId: string, entry: StoredResponse): void {
    this.delete(runId)
    this.entries.set(runId, entry)
    this.totalBytes += entry.body.length
    // Evict oldest first (Map keeps insertion order), but always keep the newest entry.
    for (const [id, old] of this.entries) {
      if (this.entries.size <= 1) break
      if (this.entries.size <= this.maxEntries && this.totalBytes <= this.maxTotalBytes) break
      this.entries.delete(id)
      this.totalBytes -= old.body.length
    }
  }

  get(runId: string): StoredResponse | undefined {
    return this.entries.get(runId)
  }

  delete(runId: string): void {
    const old = this.entries.get(runId)
    if (!old) return
    this.entries.delete(runId)
    this.totalBytes -= old.body.length
  }
}

export interface HttpServiceDeps {
  /** Collections / folders from the collection down to `parentId`, outermost first. */
  getContainerChain(parentId: string | null): Promise<ContainerLevel[]>
  resolveInherited(chain: ContainerLevel[]): InheritedSettings
  /** Variable layers, highest precedence first (environment, then collection). */
  getVariableLayers(parentId: string | null, environmentId: string | null): Promise<VariableLayer[]>
  getWorkspaceSettings(): Promise<WorkspaceSettings>
  getProxySettings(): ProxySettings
  resolveSystemProxy(url: string): Promise<string>
  userAgent: string
  readFile?: (absPath: string) => Promise<Uint8Array>
}

export interface SendInput {
  runId: string
  /** Container the request lives in (or would be saved in); provides inherited settings. */
  parentId: string | null
  environmentId: string | null
  /** As edited, saved or not, before variable substitution. */
  request: HttpRequest
  /** Variable layers to use instead of the current ones (Collection Runner workers). */
  layers?: VariableLayer[]
  /** false: don't keep the body for "顯示 / 下載" (the Runner keeps its own). */
  storeBody?: boolean
}

/** Sends requests from the editor, tracks running ones (for cancel) and keeps bodies. */
export class HttpService {
  private readonly running = new Map<string, AbortController>()
  readonly store = new ResponseStore()

  constructor(private readonly deps: HttpServiceDeps) {}

  async send(input: SendInput): Promise<HttpResult> {
    if (this.running.has(input.runId)) {
      throw new HachiError('INVALID_OPERATION', 'This request is already running')
    }
    const controller = new AbortController()
    this.running.set(input.runId, controller)
    const started = performance.now()
    let unresolved: string[] = []
    const fail = (code: HttpErrorCode, message: string, url = input.request.url): HttpResult => ({
      kind: 'error',
      runId: input.runId,
      code,
      message,
      url,
      timings: { totalMs: performance.now() - started },
      unresolvedVariables: unresolved
    })

    try {
      const chain = await this.deps.getContainerChain(input.parentId)
      const layers =
        input.layers ?? (await this.deps.getVariableLayers(input.parentId, input.environmentId))
      const resolver = new VariableResolver(buildVariableMap(layers))
      const request = resolver.request(input.request)
      const inherited = resolver.inherited(this.deps.resolveInherited(chain))
      unresolved = [...resolver.unresolved].sort()
      let built
      try {
        built = await buildRequest({
          request,
          inherited,
          workspace: await this.deps.getWorkspaceSettings(),
          userAgent: this.deps.userAgent,
          readFile: this.deps.readFile ?? ((p) => readFile(p))
        })
      } catch (error) {
        if (error instanceof HttpBuildError) return fail(error.code, error.message)
        throw error
      }

      let proxyUrl: string | null
      try {
        proxyUrl = await resolveProxyUrl(
          built.url,
          this.deps.getProxySettings(),
          built.options.useProxy,
          this.deps.resolveSystemProxy
        )
      } catch (error) {
        return fail('PROXY', `Cannot resolve proxy: ${String(error)}`, built.url)
      }
      if (controller.signal.aborted) return fail('CANCELLED', 'Request cancelled', built.url)

      const proxy = this.deps.getProxySettings()
      const { result, body } = await sendHttp(built, {
        runId: input.runId,
        proxyUrl,
        proxyAuth:
          proxyUrl && proxy.username
            ? { username: proxy.username, password: proxy.password }
            : null,
        signal: controller.signal
      })
      if (result.kind === 'response' && body && input.storeBody !== false) {
        this.store.put(input.runId, { body, contentType: result.contentType, url: result.url })
      }
      return { ...result, unresolvedVariables: unresolved }
    } finally {
      this.running.delete(input.runId)
    }
  }

  /**
   * Resolves a request for code generation, without sending it. Secret variables stay
   * as `{{name}}` unless `revealSecrets` (decision 69).
   */
  async resolveForCode(input: {
    parentId: string | null
    environmentId: string | null
    request: HttpRequest
    revealSecrets: boolean
  }): Promise<CodegenBuild & { unresolvedVariables: string[] }> {
    const chain = await this.deps.getContainerChain(input.parentId)
    const layers = await this.deps.getVariableLayers(input.parentId, input.environmentId)
    const resolver = new VariableResolver(buildVariableMap(layers), undefined, {
      keepSecrets: !input.revealSecrets
    })
    const request = resolver.request(input.request)
    const inherited = resolver.inherited(this.deps.resolveInherited(chain))
    const built = buildCodegenRequest({
      request,
      inherited,
      workspace: await this.deps.getWorkspaceSettings()
    })
    return { ...built, unresolvedVariables: [...resolver.unresolved].sort() }
  }

  /** Cancels a running request. Returns false if it already finished. */
  cancel(runId: string): boolean {
    const controller = this.running.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /** Full text of a stored (e.g. larger than the display limit) response body. */
  getBodyText(runId: string): string {
    const stored = this.requireStored(runId)
    return decodeText(stored.body, stored.contentType)
  }

  requireStored(runId: string): StoredResponse & { suggestedName: string } {
    const stored = this.store.get(runId)
    if (!stored) {
      throw new HachiError(
        'NOT_FOUND',
        'This response is no longer available; send the request again'
      )
    }
    return { ...stored, suggestedName: suggestFileName(stored.url, stored.contentType) }
  }
}
