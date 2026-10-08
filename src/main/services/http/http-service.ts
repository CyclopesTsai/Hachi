import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { HachiError } from '@shared/errors'
import type { HttpErrorCode, HttpResult, InheritedSettings, OAuth2TokenStatus } from '@shared/http'
import type { ProxySettings } from '@shared/schemas/app-config'
import type { Auth, OAuth2Auth } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import { VariableResolver, buildVariableMap, type VariableLayer } from '@shared/variables'
import { signAwsSigV4 } from './auth/aws-sigv4'
import { digestAuthorization, parseDigestChallenge } from './auth/digest'
import { OAuth2Error, OAuth2Service, type TokenRequest } from './auth/oauth2'
import {
  buildCodegenRequest,
  buildRequest,
  effectiveAuth,
  hasHeader,
  HttpBuildError,
  type BuiltRequest,
  type CodegenBuild,
  type ContainerLevel
} from './build-request'
import type { CookieJar } from './cookie-jar'
import { sendHttp, type CookieHooks, type SendOutcome } from './http-client'
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
  /** OAuth 2.0 authorization code: opens the system browser. */
  openBrowser?: (url: string) => Promise<void>
  /** The current Workspace's cookie jar (decision 129); null = none open. */
  cookieJar?: () => CookieJar | null
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
  /** Jar to use instead of the Workspace's (Runner workers); null = no cookies. */
  cookies?: CookieJar | null
}

/** Sends requests from the editor, tracks running ones (for cancel) and keeps bodies. */
export class HttpService {
  private readonly running = new Map<string, AbortController>()
  readonly store = new ResponseStore()
  readonly oauth2: OAuth2Service

  constructor(private readonly deps: HttpServiceDeps) {
    this.oauth2 = new OAuth2Service({
      postForm: (request) => this.postForm(request),
      openBrowser: deps.openBrowser ?? (() => Promise.reject(new OAuth2Error('無法開啟瀏覽器')))
    })
  }

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
      let built: BuiltRequest
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

      // Auth that needs more than a header (decision 128). An explicit Authorization
      // header wins, as for Bearer / Basic.
      const auth = effectiveAuth(request.auth, inherited)
      const explicit = hasHeader(built.headers, 'authorization')
      if (!explicit) {
        try {
          built = await this.applyAuth(built, auth)
        } catch (error) {
          if (error instanceof OAuth2Error || error instanceof HttpBuildError) {
            return fail('AUTH', error.message, built.url)
          }
          throw error
        }
      }

      let proxyUrl: string | null
      try {
        proxyUrl = await this.proxyFor(built)
      } catch (error) {
        return fail('PROXY', `Cannot resolve proxy: ${String(error)}`, built.url)
      }
      if (controller.signal.aborted) return fail('CANCELLED', 'Request cancelled', built.url)

      const jar = request.settings.useCookieJar
        ? input.cookies === undefined
          ? (this.deps.cookieJar?.() ?? null)
          : input.cookies
        : null
      const cookies: CookieHooks | undefined = jar
        ? { header: (url) => jar.header(url), store: (url, list) => jar.store(url, list) }
        : undefined
      const transport = (b: BuiltRequest): Promise<SendOutcome> =>
        sendHttp(b, {
          runId: input.runId,
          proxyUrl,
          proxyAuth: this.proxyAuth(proxyUrl),
          signal: controller.signal,
          cookies
        })
      let { result, body } = await transport(built)
      // Digest: answer the server's challenge once.
      if (
        auth.type === 'digest' &&
        !explicit &&
        result.kind === 'response' &&
        result.status === 401
      ) {
        const challenge = parseDigestChallenge(
          result.headers.filter(([k]) => k === 'www-authenticate').map(([, v]) => v)
        )
        if (challenge) {
          const url = new URL(built.url)
          const authorization = digestAuthorization({
            username: auth.username,
            password: auth.password,
            method: built.method,
            uri: `${url.pathname}${url.search}`,
            challenge
          })
          ;({ result, body } = await transport({
            ...built,
            headers: [...built.headers, ['Authorization', authorization]]
          }))
        }
      }
      if (result.kind === 'response' && body && input.storeBody !== false) {
        this.store.put(input.runId, { body, contentType: result.contentType, url: result.url })
      }
      return { ...result, unresolvedVariables: unresolved }
    } finally {
      this.running.delete(input.runId)
    }
  }

  /** OAuth 2.0 bearer header / AWS signature added to a built request. */
  private async applyAuth(built: BuiltRequest, auth: Auth): Promise<BuiltRequest> {
    if (auth.type === 'oauth2') {
      const token = await this.oauth2.tokenFor(auth)
      const value = `${auth.headerPrefix.trim()} ${token.accessToken}`.trim()
      return { ...built, headers: [...built.headers, ['Authorization', value]] }
    }
    if (auth.type === 'awsSigV4') {
      for (const [field, label] of [
        ['accessKeyId', 'Access Key'],
        ['secretAccessKey', 'Secret Key'],
        ['region', 'Region'],
        ['service', 'Service']
      ] as const) {
        if (auth[field].trim() === '') {
          throw new HttpBuildError('AUTH', `AWS Signature 的 ${label} 是空的`)
        }
      }
      const s3 = auth.service.trim().toLowerCase() === 's3'
      if (built.body !== null && typeof built.body !== 'string' && !s3) {
        throw new HttpBuildError('AUTH', 'AWS Signature 無法簽署 form-data Body（S3 除外）')
      }
      const signed = signAwsSigV4({
        method: built.method,
        url: built.url,
        headers: built.headers,
        body: typeof built.body === 'string' || built.body === null ? built.body : 'UNSIGNED',
        credentials: {
          accessKeyId: auth.accessKeyId.trim(),
          secretAccessKey: auth.secretAccessKey.trim(),
          sessionToken: auth.sessionToken.trim(),
          region: auth.region.trim(),
          service: auth.service.trim()
        }
      })
      // Our x-amz-* values replace typed ones with the same name.
      const names = new Set(signed.map(([k]) => k.toLowerCase()))
      return {
        ...built,
        headers: [...built.headers.filter(([k]) => !names.has(k.toLowerCase())), ...signed]
      }
    }
    return built
  }

  private proxyFor(built: BuiltRequest): Promise<string | null> {
    return resolveProxyUrl(
      built.url,
      this.deps.getProxySettings(),
      built.options.useProxy,
      this.deps.resolveSystemProxy
    )
  }

  private proxyAuth(proxyUrl: string | null) {
    const proxy = this.deps.getProxySettings()
    return proxyUrl && proxy.username
      ? { username: proxy.username, password: proxy.password }
      : null
  }

  /** OAuth 2.0 token endpoint call, with the Workspace's timeout / SSL / proxy settings. */
  private async postForm(request: TokenRequest): Promise<{ status: number; body: string }> {
    const workspace = await this.deps.getWorkspaceSettings()
    const built: BuiltRequest = {
      method: 'POST',
      url: request.url,
      headers: [...request.headers, ['User-Agent', this.deps.userAgent]],
      body: request.body,
      options: {
        timeoutMs: workspace.timeoutMs,
        validateSSL: workspace.validateSSL,
        followRedirects: false,
        maxRedirects: 0,
        useProxy: true
      }
    }
    const proxyUrl = await this.proxyFor(built)
    const { result, body } = await sendHttp(built, {
      runId: 'oauth2',
      proxyUrl,
      proxyAuth: this.proxyAuth(proxyUrl),
      signal: new AbortController().signal
    })
    if (result.kind === 'error') {
      throw new OAuth2Error(`無法連到 Access Token URL：${result.message}`)
    }
    return { status: result.status, body: body ? body.toString('utf8') : '' }
  }

  /** The OAuth 2.0 settings with variables substituted, as they are when sending. */
  async resolveOAuth2(input: {
    parentId: string | null
    environmentId: string | null
    auth: OAuth2Auth
  }): Promise<OAuth2Auth> {
    const layers = await this.deps.getVariableLayers(input.parentId, input.environmentId)
    return new VariableResolver(buildVariableMap(layers)).auth(input.auth) as OAuth2Auth
  }

  async oauth2Status(input: {
    parentId: string | null
    environmentId: string | null
    auth: OAuth2Auth
  }): Promise<OAuth2TokenStatus> {
    return this.oauth2.status(await this.resolveOAuth2(input))
  }

  /** "取得 Token". Failures are thrown as readable errors. */
  async oauth2Obtain(input: {
    parentId: string | null
    environmentId: string | null
    auth: OAuth2Auth
  }): Promise<OAuth2TokenStatus> {
    const auth = await this.resolveOAuth2(input)
    try {
      await this.oauth2.obtain(auth)
    } catch (error) {
      if (error instanceof OAuth2Error) throw new HachiError('INVALID_OPERATION', error.message)
      throw error
    }
    return this.oauth2.status(auth)
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
  }): Promise<CodegenBuild & { unresolvedVariables: string[]; authNote: string | null }> {
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
    let authNote: string | null = null
    const auth = effectiveAuth(request.auth, inherited)
    if (!hasHeader(built.request.headers, 'authorization')) {
      if (auth.type === 'oauth2') {
        const status = this.oauth2.status(auth)
        const token = this.oauth2.cached(auth)
        if (token && status.state === 'valid') {
          const value = `${auth.headerPrefix.trim()} ${token.accessToken}`.trim()
          built.request.headers.push(['Authorization', value])
        } else {
          authNote =
            '還沒有有效的 OAuth 2.0 Token，程式碼中沒有 Authorization（可先送出一次或按「取得 Token」）'
        }
      } else if (auth.type === 'digest') {
        authNote = 'Digest 驗證要先收到伺服器的 401 才能計算，程式碼中沒有 Authorization'
      } else if (auth.type === 'awsSigV4') {
        authNote = 'AWS Signature 每次送出時才簽署（有時效），程式碼中沒有簽章'
      }
    }
    return { ...built, unresolvedVariables: [...resolver.unresolved].sort(), authNote }
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
