import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { HachiError } from '@shared/errors'
import type { HttpErrorCode, HttpResult, InheritedSettings } from '@shared/http'
import type { ProxySettings } from '@shared/schemas/app-config'
import type { HttpRequest } from '@shared/schemas/http-request'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import { buildRequest, HttpBuildError, type ContainerLevel } from './build-request'
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
  /** Collections / folders above the request, outermost first. */
  getContainerChain(requestId: string): Promise<ContainerLevel[]>
  resolveInherited(chain: ContainerLevel[]): InheritedSettings
  getWorkspaceSettings(): Promise<WorkspaceSettings>
  getProxySettings(): ProxySettings
  resolveSystemProxy(url: string): Promise<string>
  userAgent: string
  readFile?: (absPath: string) => Promise<Uint8Array>
}

export interface SendInput {
  runId: string
  requestId: string
  request: HttpRequest
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
    const fail = (code: HttpErrorCode, message: string, url = input.request.url): HttpResult => ({
      kind: 'error',
      runId: input.runId,
      code,
      message,
      url,
      timings: { totalMs: performance.now() - started }
    })

    try {
      const chain = await this.deps.getContainerChain(input.requestId)
      let built
      try {
        built = await buildRequest({
          request: input.request,
          inherited: this.deps.resolveInherited(chain),
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
      if (result.kind === 'response' && body) {
        this.store.put(input.runId, { body, contentType: result.contentType, url: result.url })
      }
      return result
    } finally {
      this.running.delete(input.runId)
    }
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
