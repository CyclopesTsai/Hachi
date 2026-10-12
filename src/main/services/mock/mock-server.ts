/**
 * Running Mock Servers (decision 133): one HTTP server (+ WebSocket upgrades) per Mock
 * Server, listening on 127.0.0.1 (or every interface when "區網可連" is on). Started and
 * stopped by hand; everything stops when the Workspace changes or the app quits.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  findRoute,
  findWsEndpoint,
  wsRuleMatches,
  type MockEvent,
  type MockLogEntry,
  type MockStatus
} from '@shared/mock'
import type { MockFile, MockWsEndpoint } from '@shared/schemas/mock'

const LOG_TEXT_MAX = 500
const FLUSH_MS = 100
/** Request bodies are read (to finish the request) but not kept. */
const REQUEST_BODY_MAX = 10 * 1024 * 1024

interface Running {
  mock: MockFile
  server: Server
  wss: WebSocketServer
  url: string
  sockets: Set<Socket>
  timers: Set<NodeJS.Timeout>
}

const short = (text: string) =>
  text.length > LOG_TEXT_MAX ? `${text.slice(0, LOG_TEXT_MAX)}…` : text

function hasHeader(headers: readonly { key: string; enabled: boolean }[], name: string) {
  return headers.some((h) => h.enabled && h.key.trim().toLowerCase() === name)
}

/** application/json when the body looks like JSON, text/plain otherwise. */
function guessType(body: string): string {
  const t = body.trim()
  if ((t.startsWith('{') || t.startsWith('[')) && t.length > 1) {
    try {
      JSON.parse(t)
      return 'application/json; charset=utf-8'
    } catch {
      // not JSON
    }
  }
  return 'text/plain; charset=utf-8'
}

export class MockServers {
  private readonly running = new Map<string, Running>()
  private readonly errors = new Map<string, string>()
  private pending: MockLogEntry[] = []
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly emit: (event: MockEvent) => void) {}

  status(id: string): MockStatus {
    const r = this.running.get(id)
    return { id, running: !!r, url: r?.url ?? null, error: this.errors.get(id) ?? null }
  }

  statuses(): MockStatus[] {
    return [...this.running.keys()].map((id) => this.status(id))
  }

  /** Starts (or restarts with new settings). Errors such as a busy port are thrown. */
  async start(mock: MockFile): Promise<MockStatus> {
    await this.stop(mock.id, false)
    this.errors.delete(mock.id)
    const host = mock.lan ? '0.0.0.0' : '127.0.0.1'
    const sockets = new Set<Socket>()
    const timers = new Set<NodeJS.Timeout>()
    const wss = new WebSocketServer({ noServer: true })
    const server = createServer((req, res) => {
      void this.handle(mock, req, res)
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      const endpoint = findWsEndpoint(mock.websockets, path)
      if (!endpoint) {
        this.log(mock.id, req, { kind: 'ws-open', routeId: null, status: 404, path })
        socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.attach(mock, endpoint, ws, req, timers))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(mock.port, host, () => {
          server.off('error', reject)
          resolve()
        })
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const message =
        code === 'EADDRINUSE'
          ? `連接埠 ${mock.port} 已被使用，請換一個`
          : code === 'EACCES'
            ? `沒有權限使用連接埠 ${mock.port}（1024 以下的埠需要系統權限）`
            : `無法啟動：${error instanceof Error ? error.message : String(error)}`
      this.errors.set(mock.id, message)
      this.emit({ status: this.status(mock.id) })
      throw new Error(message, { cause: error })
    }
    const port = (server.address() as AddressInfo).port
    const url = `http://${mock.lan ? 'localhost' : '127.0.0.1'}:${port}`
    this.running.set(mock.id, { mock, server, wss, url, sockets, timers })
    const status = this.status(mock.id)
    this.emit({ status })
    return status
  }

  async stop(id: string, notify = true): Promise<MockStatus> {
    const r = this.running.get(id)
    if (r) {
      this.running.delete(id)
      for (const t of r.timers) clearInterval(t)
      for (const client of r.wss.clients) client.terminate()
      r.wss.close()
      for (const s of r.sockets) s.destroy()
      await new Promise<void>((resolve) => r.server.close(() => resolve()))
    }
    const status = this.status(id)
    if (notify) this.emit({ status })
    return status
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)))
  }

  private async handle(mock: MockFile, req: IncomingMessage, res: ServerResponse) {
    let received = 0
    for await (const chunk of req) {
      received += (chunk as Buffer).length
      if (received > REQUEST_BODY_MAX) break
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const method = (req.method ?? 'GET').toUpperCase()
    const cors = mock.cors
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Expose-Headers', '*')
    }
    // Preflight: answered for every path when CORS is on.
    if (cors && method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
        'Access-Control-Max-Age': '600'
      })
      res.end()
      this.log(mock.id, req, { kind: 'http', routeId: null, status: 204, path: url.pathname })
      return
    }
    const route = findRoute(mock.routes, method, url.pathname)
    if (!route) {
      const body = JSON.stringify({ error: '沒有符合的 Mock 路由', method, path: url.pathname })
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(method === 'HEAD' ? undefined : body)
      this.log(mock.id, req, { kind: 'http', routeId: null, status: 404, path: url.pathname })
      return
    }
    if (route.delayMs > 0) await new Promise((r) => setTimeout(r, route.delayMs))
    if (res.destroyed) return
    for (const h of route.headers) {
      if (h.enabled && h.key.trim() !== '') {
        try {
          res.appendHeader(h.key.trim(), h.value)
        } catch {
          // An invalid header name / value is skipped.
        }
      }
    }
    if (!hasHeader(route.headers, 'content-type') && route.body !== '') {
      res.setHeader('Content-Type', guessType(route.body))
    }
    res.statusCode = route.status
    res.end(method === 'HEAD' ? undefined : route.body)
    this.log(mock.id, req, {
      kind: 'http',
      routeId: route.id,
      status: route.status,
      path: url.pathname
    })
  }

  private attach(
    mock: MockFile,
    endpoint: MockWsEndpoint,
    ws: WebSocket,
    req: IncomingMessage,
    timers: Set<NodeJS.Timeout>
  ) {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const entry = (kind: MockLogEntry['kind'], text?: string) =>
      this.log(mock.id, req, { kind, routeId: endpoint.id, status: null, path, text })
    entry('ws-open')
    const send = (message: string) => {
      if (ws.readyState !== ws.OPEN) return
      ws.send(message)
      entry('ws-out', message)
    }
    for (const m of endpoint.onConnect) if (m.enabled) send(m.message)
    const own: NodeJS.Timeout[] = []
    for (const interval of endpoint.intervals) {
      if (!interval.enabled) continue
      const t = setInterval(() => send(interval.message), interval.everyMs)
      own.push(t)
      timers.add(t)
    }
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? `（二進位 ${(data as Buffer).length} bytes）` : data.toString()
      entry('ws-in', text)
      if (isBinary) return
      const rule = endpoint.rules.find((r) => r.enabled && wsRuleMatches(r.match, r.pattern, text))
      if (rule) send(rule.reply)
    })
    ws.on('close', () => {
      for (const t of own) {
        clearInterval(t)
        timers.delete(t)
      }
      entry('ws-close')
    })
    ws.on('error', () => undefined)
  }

  private log(
    mockId: string,
    req: IncomingMessage,
    entry: Pick<MockLogEntry, 'kind' | 'routeId' | 'status' | 'path'> & { text?: string }
  ) {
    this.pending.push({
      mockId,
      time: Date.now(),
      method: entry.kind === 'http' ? (req.method ?? 'GET').toUpperCase() : 'WS',
      remote: req.socket.remoteAddress ?? '',
      ...entry,
      ...(entry.text !== undefined ? { text: short(entry.text) } : {})
    })
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null
      const log = this.pending
      this.pending = []
      this.emit({ log })
    }, FLUSH_MS)
  }
}
