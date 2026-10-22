import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { HachiError } from '@shared/errors'
import type {
  HttpErrorCode,
  HttpResult,
  InheritedSettings,
  OAuth2TokenStatus,
  TlsCheckResult
} from '@shared/http'
import type { ProxySettings } from '@shared/schemas/app-config'
import type { Auth, OAuth2Auth } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import {
  VariableResolver,
  buildVariableMap,
  findFileVariables,
  type VariableLayer
} from '@shared/variables'
import { signAwsSigV4 } from './auth/aws-sigv4'
import { digestAuthorization, parseDigestChallenge } from './auth/digest'
import { loadFileVariables, type FileAccess } from './file-variables'
import { CCADB_MAX_REPORT_BYTES, CcadbStore } from './ccadb'
import { checkCertificates, type TlsCheckDeps } from './tls-check'
import { diagnoseTls, unavailable } from './tls-diagnosis'
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
import {
  SavedResultError,
  exampleFromExchange,
  secretValues,
  sentBodyOf,
  type Exchange
} from './saved-result'
import type { PortableExample } from '@shared/transfer/portable'
import { msg } from '@shared/i18n'

interface StoredResponse {
  body: Buffer
  contentType: string
  url: string
  /** What was sent, for "儲存結果" (decision 140). */
  exchange?: Exchange
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
  /** Where {{$file:…}} may read (decision 134). */
  fileAccess?: () => FileAccess
  /** The system verifiers for the certificate check (decision 142). */
  tlsCheck?: TlsCheckDeps
  /** Where the CCADB reports are kept (issue #7); absent: no root program section. */
  ccadbDir?: string
}

export interface TlsCheckInput {
  parentId: string | null
  environmentId: string | null
  /** As typed (https:// or wss://), before variable substitution. */
  url: string
  useProxy: boolean
  /** Download the CCADB reports again even if the copy is recent. */
  refreshCcadb?: boolean
}

export interface SendInput {
  runId: string
  /** Container the request lives in (or would be saved in); provides inherited settings. */
  parentId: string | null
  environmentId: string | null
  /** As edited, saved or not, before variable substitution. */
  request: HttpRequest
  /** The request as written when `request` was changed by Pre-request scripts. */
  source?: HttpRequest
  /** Variable layers to use instead of the current ones (Collection Runner workers). */
  layers?: VariableLayer[]
  /** false: don't keep the body for "顯示 / 下載" (the Runner keeps its own). */
  storeBody?: boolean
  /** Jar to use instead of the Workspace's (Runner workers); null = no cookies. */
  cookies?: CookieJar | null
  /** On a certificate failure, read and diagnose the server's chain (decision 132). */
  diagnoseTls?: boolean
}

/** Every string inside a value (objects and arrays included). */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out)
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) stringsIn(v, out)
  }
  return out
}

/** Sends requests from the editor, tracks running ones (for cancel) and keeps bodies. */
export class HttpService {
  private readonly running = new Map<string, AbortController>()
  readonly store = new ResponseStore()
  readonly oauth2: OAuth2Service
  private readonly ccadb: CcadbStore | null

  constructor(private readonly deps: HttpServiceDeps) {
    this.ccadb = deps.ccadbDir
      ? new CcadbStore({ dir: deps.ccadbDir, fetchText: (url) => this.fetchPublicText(url) })
      : null
    this.oauth2 = new OAuth2Service({
      postForm: (request) => this.postForm(request),
      openBrowser:
        deps.openBrowser ??
        (() => Promise.reject(new OAuth2Error(msg().httpMain.oauth2.openBrowser)))
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
      // {{$file:…}} contents are read first (the resolver itself is synchronous).
      // The strings themselves (JSON text would double the backslashes of Windows paths).
      const fileNames = findFileVariables([
        ...stringsIn(input.request),
        ...stringsIn(chain),
        ...layers.flatMap((l) => l.variables.map((v) => v.value))
      ])
      let files: Map<string, string> | undefined
      if (fileNames.length > 0) {
        const loaded = await loadFileVariables(
          fileNames,
          this.deps.fileAccess?.() ?? { root: null, trustedOutside: false }
        )
        if (!loaded.ok) {
          const result = fail(loaded.code, loaded.message)
          return loaded.untrusted.length > 0 && result.kind === 'error'
            ? { ...result, untrustedFiles: loaded.untrusted }
            : result
        }
        files = loaded.files
      }
      const variables = buildVariableMap(layers)
      const resolver = new VariableResolver(variables, undefined, { files })
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
      if (result.kind === 'error' && result.code === 'TLS' && input.diagnoseTls) {
        result = {
          ...result,
          tls: await diagnoseTls(built.url, { proxyUrl, proxyAuth: this.proxyAuth(proxyUrl) })
        }
      }
      if (result.kind === 'response' && body && input.storeBody !== false) {
        const exchange: Exchange = {
          source: input.source ?? input.request,
          method: built.method,
          url: result.url,
          headers: result.requestHeaders,
          body: sentBodyOf(built.body),
          response: {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
            contentType: result.contentType,
            timeMs: result.timings.totalMs
          },
          secrets: secretValues(variables, (text) => resolver.resolve(text))
        }
        this.store.put(input.runId, {
          body,
          contentType: result.contentType,
          url: result.url,
          exchange
        })
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
          throw new HttpBuildError('AUTH', msg().httpMain.aws.empty(label))
        }
      }
      const s3 = auth.service.trim().toLowerCase() === 's3'
      if (built.body !== null && typeof built.body !== 'string' && !s3) {
        throw new HttpBuildError('AUTH', msg().httpMain.aws.formData)
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
      throw new OAuth2Error(msg().httpMain.oauth2.tokenUrl(result.message))
    }
    return { status: result.status, body: body ? body.toString('utf8') : '' }
  }

  /**
   * GETs a public HTTPS document (the CCADB reports, issue #7) through the App's proxy,
   * always verifying the certificate. Rejects on any failure or non-200 status.
   */
  private async fetchPublicText(url: string): Promise<string> {
    const built: BuiltRequest = {
      method: 'GET',
      url,
      headers: [['User-Agent', this.deps.userAgent]],
      body: null,
      options: {
        timeoutMs: 60_000,
        validateSSL: true,
        followRedirects: true,
        maxRedirects: 3,
        useProxy: true
      }
    }
    const proxyUrl = await this.proxyFor(built)
    const { result, body } = await sendHttp(built, {
      runId: 'ccadb',
      proxyUrl,
      proxyAuth: this.proxyAuth(proxyUrl),
      signal: new AbortController().signal,
      maxResponseBytes: CCADB_MAX_REPORT_BYTES
    })
    if (result.kind === 'error')
      throw new Error(msg().tlsCheck.programs.downloadFailed(result.message))
    if (result.status !== 200)
      throw new Error(msg().tlsCheck.programs.downloadFailed(`HTTP ${result.status}`))
    return body ? body.toString('utf8') : ''
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
          authNote = msg().httpMain.code.oauth2
        }
      } else if (auth.type === 'digest') {
        authNote = msg().httpMain.code.digest
      } else if (auth.type === 'awsSigV4') {
        authNote = msg().httpMain.code.aws
      }
    }
    return { ...built, unresolvedVariables: [...resolver.unresolved].sort(), authNote }
  }

  /**
   * Certificate check by hand (decision 142): the URL's variables are replaced and the
   * proxy chosen as for sending; then the server's chain is read and checked.
   */
  async checkTls(input: TlsCheckInput): Promise<TlsCheckResult> {
    const layers = await this.deps.getVariableLayers(input.parentId, input.environmentId)
    const resolver = new VariableResolver(buildVariableMap(layers))
    let text = resolver.resolve(input.url).trim()
    if (text === '') throw new HachiError('VALIDATION_ERROR', msg().httpMain.tls.needUrl)
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) text = `https://${text}`
    let url: URL
    try {
      url = new URL(text)
    } catch {
      throw new HachiError('VALIDATION_ERROR', msg().httpMain.tls.invalidUrl(text))
    }
    if (url.protocol === 'http:' || url.protocol === 'ws:') {
      // Unencrypted: no certificate; the dialog explains what that means.
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const port = Number(url.port || 80)
      return {
        host,
        port,
        diagnosis: unavailable(host, port, '', msg().httpMain.tls.unencrypted),
        trust: [],
        checks: [],
        advice: [],
        unresolvedVariables: [...resolver.unresolved].sort(),
        insecure: url.protocol === 'http:' ? 'http' : 'ws'
      }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
      throw new HachiError('VALIDATION_ERROR', msg().httpMain.tls.httpsOnly)
    }
    const target = url.toString().replace(/^wss:/i, 'https:')
    let proxyUrl: string | null
    try {
      proxyUrl = await resolveProxyUrl(
        target,
        this.deps.getProxySettings(),
        input.useProxy,
        this.deps.resolveSystemProxy
      )
    } catch (error) {
      throw new HachiError('INVALID_OPERATION', `Cannot resolve proxy: ${String(error)}`)
    }
    const ccadb = this.ccadb
    const result = await checkCertificates(
      target,
      { proxyUrl, proxyAuth: this.proxyAuth(proxyUrl) },
      {
        ...this.deps.tlsCheck,
        ...(ccadb ? { ccadb: () => ccadb.get(input.refreshCcadb ?? false) } : {})
      }
    )
    return { ...result, unresolvedVariables: [...resolver.unresolved].sort() }
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

  /** The example file content for a response still in the store (decision 140). */
  savedResult(runId: string, name: string, savedAt: string): PortableExample {
    const stored = this.requireStored(runId)
    if (!stored.exchange) {
      throw new HachiError('NOT_FOUND', msg().httpMain.saveResult.gone)
    }
    try {
      return exampleFromExchange(stored.exchange, stored.body, name, savedAt)
    } catch (error) {
      if (error instanceof SavedResultError)
        throw new HachiError('INVALID_OPERATION', error.message)
      throw error
    }
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
