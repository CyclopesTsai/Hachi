/**
 * Local WebSocket servers for unit tests (plain and TLS with the self-signed
 * localhost certificate). Not used by the app.
 */
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { tlsOptions } from '../http/test-servers'

export interface SeenConnection {
  url: string
  headers: IncomingMessage['headers']
  protocol: string
  closeCode?: number
  closeReason?: string
  received: { data: string; binary: boolean }[]
}

export interface TestWsServer {
  /** ws://127.0.0.1:port or wss://localhost:port */
  url: string
  connections: SeenConnection[]
  /** Sends to every open client. */
  broadcast(data: string | Buffer): void
  close(): Promise<void>
}

/**
 * Echo server. Paths:
 * - `/reject` answers the upgrade with 401
 * - `/hang` accepts the TCP connection but never answers
 * - anything else: echoes every message back (same text / binary type)
 */
export function startWsServer(options: { tls?: boolean } = {}): Promise<TestWsServer> {
  const server = options.tls ? https.createServer(tlsOptions) : http.createServer()
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('chat.v2') ? 'chat.v2' : false)
  })
  const connections: SeenConnection[] = []
  const sockets = new Set<WebSocket>()
  const hanging = new Set<Duplex>()

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/reject')) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
      return
    }
    if (req.url?.startsWith('/hang')) {
      hanging.add(socket)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const seen: SeenConnection = {
        url: req.url ?? '',
        headers: req.headers,
        protocol: ws.protocol,
        received: []
      }
      connections.push(seen)
      sockets.add(ws)
      ws.on('message', (data, isBinary) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        seen.received.push({
          data: isBinary ? buffer.toString('hex') : buffer.toString(),
          binary: isBinary
        })
        ws.send(buffer, { binary: isBinary })
      })
      ws.on('close', (code, reason) => {
        seen.closeCode = code
        seen.closeReason = reason.toString()
        sockets.delete(ws)
      })
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: options.tls ? `wss://localhost:${port}` : `ws://127.0.0.1:${port}`,
        connections,
        broadcast: (data) => sockets.forEach((ws) => ws.send(data)),
        close: () =>
          new Promise((done) => {
            sockets.forEach((ws) => ws.terminate())
            hanging.forEach((s) => s.destroy())
            wss.close()
            server.close(() => done())
          })
      })
    })
  })
}
