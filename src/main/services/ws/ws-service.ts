import { HttpsProxyAgent } from 'https-proxy-agent'
import WebSocket from 'ws'
import { HachiError } from '@shared/errors'
import { MAX_RESPONSE_BYTES, type InheritedSettings } from '@shared/http'
import type { ProxySettings } from '@shared/schemas/app-config'
import type { OAuth2Auth } from '@shared/schemas/collection'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import type { WsMessageFormat, WsRequest } from '@shared/schemas/ws-request'
import { VariableResolver, buildVariableMap, type VariableLayer } from '@shared/variables'
import {
  BinaryFormatError,
  base64ToBytes,
  hexToBytes,
  type WsConnState,
  type WsEventEntry,
  type WsEventPayload,
  type WsLogEntry,
  type WsMessageEntry
} from '@shared/ws'
import {
  HttpBuildError,
  buildHeaders,
  buildUrl,
  effectiveAuth,
  hasHeader,
  type ContainerLevel
} from '../http/build-request'
import { resolveProxyUrl } from '../http/proxy'

export interface WsServiceDeps {
  /** Collections / folders from the collection down to `parentId`, outermost first. */
  getContainerChain(parentId: string | null): Promise<ContainerLevel[]>
  resolveInherited(chain: ContainerLevel[]): InheritedSettings
  /** Variable layers, highest precedence first (environment, then collection). */
  getVariableLayers(parentId: string | null, environmentId: string | null): Promise<VariableLayer[]>
  getWorkspaceSettings(): Promise<WorkspaceSettings>
  getProxySettings(): ProxySettings
  resolveSystemProxy(url: string): Promise<string>
  userAgent: string
  /** Pushes state changes and log entries to the renderer (batched). */
  emit(payload: WsEventPayload): void
  /** Called once when a connection attempt ends (for the history). */
  onFinished?(summary: WsConnectionSummary): void
  now?: () => number
  /** Log entries are batched for this long before being emitted. */
  flushIntervalMs?: number
  /** Authorization header value for OAuth 2.0 auth (decision 128). */
  oauth2Header?: (auth: OAuth2Auth) => Promise<string>
}

export interface WsConnectInput {
  connectionId: string
  parentId: string | null
  environmentId: string | null
  /** As edited, before variable substitution. */
  request: WsRequest
}

export interface WsSendInput {
  connectionId: string
  parentId: string | null
  environmentId: string | null
  format: WsMessageFormat
  content: string
}

export interface WsConnectionSummary {
  connectionId: string
  request: WsRequest
  startedAt: number
  openedAt: number | null
  closedAt: number
  closeCode: number | null
  closeReason: string
  error: string | null
  sent: number
  received: number
}

interface Connection {
  id: string
  request: WsRequest
  socket: WebSocket | null
  state: WsConnState
  seq: number
  pending: WsLogEntry[]
  flushTimer: ReturnType<typeof setTimeout> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  /** Ping payload → time sent, to compute the latency when the pong arrives. */
  pings: Map<string, number>
  pingCounter: number
  resolver: VariableResolver
  startedAt: number
  userClosed: boolean
  sent: number
  received: number
}

/** ws:// stays ws://; proxies and Chromium's proxy lookup think in http(s). */
const asHttpUrl = (url: string) => url.replace(/^ws(s?):/i, 'http$1:')

/**
 * WebSocket connections opened from the editor. Each connection belongs to one
 * tab (`connectionId`, chosen by the renderer). Messages are not stored here:
 * they are pushed to the renderer, which keeps the log (decision 56).
 */
export class WsService {
  private readonly connections = new Map<string, Connection>()

  constructor(private readonly deps: WsServiceDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  async connect(input: WsConnectInput): Promise<{ unresolvedVariables: string[] }> {
    const existing = this.connections.get(input.connectionId)
    if (existing?.socket) {
      throw new HachiError('INVALID_OPERATION', 'This connection is already open')
    }
    const layers = await this.deps.getVariableLayers(input.parentId, input.environmentId)
    const resolver = new VariableResolver(buildVariableMap(layers))
    const conn: Connection = {
      id: input.connectionId,
      request: input.request,
      socket: null,
      state: { status: 'connecting', url: input.request.url },
      seq: 0,
      pending: [],
      flushTimer: null,
      heartbeatTimer: null,
      pings: new Map(),
      pingCounter: 0,
      resolver,
      startedAt: this.now(),
      userClosed: false,
      sent: 0,
      received: 0
    }
    this.connections.set(conn.id, conn)

    try {
      const { url, headers, protocols, options } = await this.prepare(input, resolver)
      conn.state = { status: 'connecting', url }
      this.log(conn, { kind: 'event', event: 'connecting', url })
      this.emitState(conn)
      const socket = new WebSocket(url, protocols, { ...options, headers })
      conn.socket = socket
      this.attach(conn, socket)
    } catch (error) {
      const message =
        error instanceof HttpBuildError || error instanceof Error ? error.message : String(error)
      conn.state = { ...conn.state, status: 'error', error: message }
      this.log(conn, { kind: 'event', event: 'error', message })
      this.finish(conn, null, '')
    }
    return { unresolvedVariables: [...resolver.unresolved].sort() }
  }

  /** Sends a message; `{{variables}}` are replaced now (decision 52). */
  async send(input: WsSendInput): Promise<{ unresolvedVariables: string[] }> {
    const conn = this.requireOpen(input.connectionId)
    const layers = await this.deps.getVariableLayers(input.parentId, input.environmentId)
    const resolver = new VariableResolver(buildVariableMap(layers))
    const text = resolver.resolve(input.content)
    let data: string | Uint8Array = text
    try {
      if (input.format === 'binary-hex') data = hexToBytes(text)
      else if (input.format === 'binary-base64') data = base64ToBytes(text)
    } catch (error) {
      if (error instanceof BinaryFormatError) {
        throw new HachiError('VALIDATION_ERROR', error.message)
      }
      throw error
    }
    await this.write(conn, data, false)
    return { unresolvedVariables: [...resolver.unresolved].sort() }
  }

  /** Sends a ping frame; the pong shows the round trip time. */
  ping(connectionId: string): void {
    this.sendPing(this.requireOpen(connectionId), false)
  }

  /**
   * Closes with the request's close code / reason (decision 63). A connection still
   * being established is aborted.
   */
  disconnect(connectionId: string, code = 1000, reason = ''): boolean {
    const conn = this.connections.get(connectionId)
    if (!conn?.socket) return false
    conn.userClosed = true
    const socket = conn.socket
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate()
    } else if (socket.readyState === WebSocket.OPEN) {
      conn.state = { ...conn.state, status: 'closing' }
      this.emitState(conn)
      socket.close(code, reason)
      // Servers that never answer the close frame: give up after a while.
      setTimeout(() => {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
      }, 5000).unref?.()
    }
    return true
  }

  /** Closes everything (Workspace switch, window closed, renderer reloaded). */
  disconnectAll(): void {
    for (const conn of this.connections.values()) this.disconnect(conn.id, 1001, '')
  }

  /** Ids of connections that are connecting or open. */
  activeIds(): string[] {
    return [...this.connections.values()].filter((c) => c.socket).map((c) => c.id)
  }

  private async prepare(input: WsConnectInput, resolver: VariableResolver) {
    const request = input.request
    const inherited = resolver.inherited(
      this.deps.resolveInherited(await this.deps.getContainerChain(input.parentId))
    )
    const auth = effectiveAuth(resolver.auth(request.auth), inherited)
    const { headers, authQuery } = buildHeaders(resolver.rows(request.headers), inherited, auth)
    const url = buildUrl(resolver.resolve(request.url), resolver.rows(request.params), authQuery, {
      default: 'ws',
      allowed: ['ws:', 'wss:']
    })
    // OAuth 2.0: the token goes in the handshake (Digest / AWS are HTTP only).
    if (auth.type === 'oauth2' && this.deps.oauth2Header && !hasHeader(headers, 'authorization')) {
      headers.push(['Authorization', await this.deps.oauth2Header(auth)])
    }
    if (!hasHeader(headers, 'user-agent')) headers.push(['User-Agent', this.deps.userAgent])
    const headerObject: Record<string, string> = {}
    for (const [key, value] of headers) {
      const existing = Object.keys(headerObject).find((k) => k.toLowerCase() === key.toLowerCase())
      if (existing) headerObject[existing] = `${headerObject[existing]}, ${value}`
      else headerObject[key] = value
    }
    const protocols = request.subprotocols.map((p) => resolver.resolve(p).trim()).filter(Boolean)

    const workspace = await this.deps.getWorkspaceSettings()
    const s = request.settings
    const timeout = s.connectTimeoutMs ?? workspace.timeoutMs
    const proxySettings = this.deps.getProxySettings()
    const proxyUrl = await resolveProxyUrl(
      asHttpUrl(url),
      proxySettings,
      s.useProxy,
      this.deps.resolveSystemProxy
    )
    let agent: HttpsProxyAgent<string> | undefined
    if (proxyUrl) {
      const withAuth = new URL(proxyUrl)
      if (proxySettings.username) {
        withAuth.username = encodeURIComponent(proxySettings.username)
        withAuth.password = encodeURIComponent(proxySettings.password)
      }
      agent = new HttpsProxyAgent(withAuth.toString())
    }
    return {
      url,
      headers: headerObject,
      protocols,
      options: {
        handshakeTimeout: timeout > 0 ? timeout : undefined,
        rejectUnauthorized: s.validateSSL ?? workspace.validateSSL,
        maxPayload: MAX_RESPONSE_BYTES,
        followRedirects: false,
        ...(agent ? { agent } : {})
      } satisfies WebSocket.ClientOptions
    }
  }

  private attach(conn: Connection, socket: WebSocket): void {
    socket.on('open', () => {
      conn.state = {
        status: 'open',
        url: conn.state.url,
        protocol: socket.protocol || undefined,
        openedAt: this.now()
      }
      this.log(conn, { kind: 'event', event: 'open', protocol: socket.protocol || undefined })
      this.emitState(conn)
      this.startHeartbeat(conn)
    })
    socket.on('message', (data, isBinary) => {
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data)
      conn.received++
      this.log(conn, {
        kind: 'message',
        direction: 'received',
        binary: isBinary,
        data: isBinary ? buffer.toString('base64') : buffer.toString('utf8'),
        size: buffer.length
      })
    })
    socket.on('ping', () => {
      this.log(conn, { kind: 'event', event: 'ping', direction: 'received' })
    })
    socket.on('pong', (data) => {
      const sentAt = conn.pings.get(data.toString())
      conn.pings.delete(data.toString())
      this.log(conn, {
        kind: 'event',
        event: 'pong',
        direction: 'received',
        ...(sentAt !== undefined ? { latencyMs: this.now() - sentAt } : {})
      })
    })
    socket.on('error', (error) => {
      conn.state = { ...conn.state, error: error.message }
      this.log(conn, { kind: 'event', event: 'error', message: error.message })
    })
    socket.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer.toString('utf8')
      this.finish(conn, code, reason)
    })
  }

  private finish(conn: Connection, code: number | null, reason: string): void {
    if (conn.heartbeatTimer) clearInterval(conn.heartbeatTimer)
    conn.heartbeatTimer = null
    const error = conn.userClosed ? undefined : conn.state.error
    conn.state = {
      status: error ? 'error' : 'closed',
      url: conn.state.url,
      ...(conn.state.protocol ? { protocol: conn.state.protocol } : {}),
      ...(conn.state.openedAt ? { openedAt: conn.state.openedAt } : {}),
      ...(code !== null ? { closeCode: code, closeReason: reason } : {}),
      ...(error ? { error } : {})
    }
    if (code !== null) {
      this.log(conn, {
        kind: 'event',
        event: 'closed',
        code,
        reason,
        ...(conn.userClosed ? { message: 'user' } : {})
      })
    }
    this.emitState(conn)
    conn.socket = null
    this.connections.delete(conn.id)
    this.deps.onFinished?.({
      connectionId: conn.id,
      request: conn.request,
      startedAt: conn.startedAt,
      openedAt: conn.state.openedAt ?? null,
      closedAt: this.now(),
      closeCode: code,
      closeReason: reason,
      error: error ?? null,
      sent: conn.sent,
      received: conn.received
    })
  }

  private startHeartbeat(conn: Connection): void {
    const hb = conn.request.settings.heartbeat
    if (!hb.enabled) return
    conn.heartbeatTimer = setInterval(() => {
      if (conn.socket?.readyState !== WebSocket.OPEN) return
      if (hb.mode === 'ping') this.sendPing(conn, true)
      else void this.write(conn, conn.resolver.resolve(hb.payload), true).catch(() => undefined)
    }, hb.intervalMs)
    conn.heartbeatTimer.unref?.()
  }

  private sendPing(conn: Connection, heartbeat: boolean): void {
    const payload = `hachi-${++conn.pingCounter}`
    conn.pings.set(payload, this.now())
    // Forget pings that never got a pong.
    if (conn.pings.size > 100) conn.pings.delete(conn.pings.keys().next().value as string)
    conn.socket?.ping(payload)
    this.log(conn, {
      kind: 'event',
      event: 'ping',
      direction: 'sent',
      ...(heartbeat ? { heartbeat: true } : {})
    })
  }

  private write(conn: Connection, data: string | Uint8Array, heartbeat: boolean): Promise<void> {
    const socket = conn.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new HachiError('INVALID_OPERATION', 'Not connected'))
    }
    const binary = typeof data !== 'string'
    return new Promise((resolve, reject) => {
      socket.send(data, { binary }, (error) => {
        if (error) {
          reject(new HachiError('IO_ERROR', `Send failed: ${error.message}`))
          return
        }
        conn.sent++
        const buffer = binary ? Buffer.from(data) : Buffer.from(data, 'utf8')
        this.log(conn, {
          kind: 'message',
          direction: 'sent',
          binary,
          data: binary ? buffer.toString('base64') : (data as string),
          size: buffer.length,
          ...(heartbeat ? { heartbeat: true } : {})
        })
        resolve()
      })
    })
  }

  private requireOpen(connectionId: string): Connection {
    const conn = this.connections.get(connectionId)
    if (!conn?.socket || conn.socket.readyState !== WebSocket.OPEN) {
      throw new HachiError('INVALID_OPERATION', 'Not connected')
    }
    return conn
  }

  private log(
    conn: Connection,
    entry: Omit<WsMessageEntry, 'seq' | 'time'> | Omit<WsEventEntry, 'seq' | 'time'>
  ): void {
    conn.pending.push({ ...entry, seq: ++conn.seq, time: this.now() } as WsLogEntry)
    if (!conn.flushTimer) {
      conn.flushTimer = setTimeout(() => this.flush(conn), this.deps.flushIntervalMs ?? 50)
    }
  }

  /** State changes go out right away, together with the entries collected so far. */
  private emitState(conn: Connection): void {
    this.flush(conn, true)
  }

  private flush(conn: Connection, withState = false): void {
    if (conn.flushTimer) clearTimeout(conn.flushTimer)
    conn.flushTimer = null
    if (conn.pending.length === 0 && !withState) return
    const entries = conn.pending
    conn.pending = []
    this.deps.emit({
      connectionId: conn.id,
      entries,
      ...(withState ? { state: { ...conn.state } } : {})
    })
  }
}
