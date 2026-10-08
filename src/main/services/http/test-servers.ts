/**
 * Local servers for HTTP client tests (imported by *.test.ts only).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import net, { type AddressInfo } from 'node:net'
import path from 'node:path'
import zlib from 'node:zlib'

const fixtures = path.join(import.meta.dirname, '__fixtures__')
export const tlsOptions = {
  key: readFileSync(path.join(fixtures, 'localhost-key.pem')),
  cert: readFileSync(path.join(fixtures, 'localhost-cert.pem'))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

let tokenCount = 0

/** Routes shared by the HTTP and HTTPS test servers. */
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const body = await readBody(req)
  switch (url.pathname) {
    case '/json':
      res.setHeader('set-cookie', ['session=abc; Path=/; HttpOnly', 'theme=dark; Max-Age=60'])
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: true, items: [1, 2, 3] }))
      return
    case '/echo':
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body.toString('utf8')
        })
      )
      return
    case '/gzip':
      res.setHeader('content-type', 'text/plain')
      res.setHeader('content-encoding', 'gzip')
      res.end(zlib.gzipSync('compressed hello'))
      return
    case '/redirect': {
      const n = Number(url.searchParams.get('n') ?? '1')
      res.writeHead(302, { location: n > 1 ? `/redirect?n=${n - 1}` : '/json' })
      res.end()
      return
    }
    case '/slow':
      setTimeout(() => res.end('late'), Number(url.searchParams.get('ms') ?? '2000'))
      return
    case '/bytes': {
      const size = Number(url.searchParams.get('size') ?? '0')
      res.setHeader('content-type', url.searchParams.get('type') ?? 'text/plain')
      res.end(Buffer.alloc(size, url.searchParams.get('type')?.startsWith('image') ? 0 : 97))
      return
    }
    case '/digest': {
      // user / pass, realm "test", MD5, qop auth (decision 128).
      const auth = req.headers.authorization ?? ''
      const params = new Map(
        [...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]*))/g)].map((m) => [m[1], m[2] ?? m[3]])
      )
      const md5 = (t: string) => createHash('md5').update(t).digest('hex')
      const ha1 = md5('user:test:pass')
      const ha2 = md5(`${req.method}:${params.get('uri')}`)
      const expected = md5(`${ha1}:abc:${params.get('nc')}:${params.get('cnonce')}:auth:${ha2}`)
      if (auth.startsWith('Digest ') && params.get('response') === expected) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, uri: params.get('uri') }))
        return
      }
      res.writeHead(401, {
        'www-authenticate':
          'Basic realm="x", Digest realm="test", qop="auth", nonce="abc", opaque="op"'
      })
      res.end('unauthorized')
      return
    }
    case '/oauth/token': {
      // Client "cid" / "secret" (Basic header or body); answers with a counter token.
      const form = new URLSearchParams(body.toString('utf8'))
      const basic = Buffer.from('cid:secret').toString('base64')
      const client =
        req.headers.authorization === `Basic ${basic}` ||
        (form.get('client_id') === 'cid' && form.get('client_secret') === 'secret')
      res.setHeader('content-type', 'application/json')
      if (!client) {
        res.statusCode = 401
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'bad client' }))
        return
      }
      tokenCount++
      res.end(
        JSON.stringify({
          access_token: `tok-${tokenCount}-${form.get('grant_type')}`,
          token_type: 'Bearer',
          expires_in: 3600
        })
      )
      return
    }
    case '/html':
      res.setHeader('content-type', 'text/html')
      res.end('<h1>Hello</h1><script>alert(1)</script>')
      return
    default:
      res.statusCode = 404
      res.end('not found')
  }
}

export interface TestServer {
  url: string
  close(): Promise<void>
}

function listen(server: http.Server | https.Server, scheme: string): Promise<TestServer> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `${scheme}://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          })
      })
    })
  })
}

export function startHttpServer(): Promise<TestServer> {
  return listen(
    http.createServer((req, res) => void handle(req, res)),
    'http'
  )
}

export function startHttpsServer(): Promise<TestServer> {
  return listen(
    https.createServer(tlsOptions, (req, res) => void handle(req, res)),
    'https'
  )
}

export interface TestProxy extends TestServer {
  /** Requests seen by the proxy: absolute-form URLs for HTTP, "CONNECT host:port" for HTTPS. */
  seen: string[]
  /** Proxy-Authorization header values received. */
  auth: string[]
}

/** Minimal forward proxy: absolute-form HTTP requests and CONNECT tunnels. */
export function startProxy(): Promise<TestProxy> {
  const seen: string[] = []
  const auth: string[] = []
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? '')
    if (req.headers['proxy-authorization']) auth.push(String(req.headers['proxy-authorization']))
    const target = new URL(req.url ?? '')
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: req.headers
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      }
    )
    req.pipe(upstream)
  })
  server.on('connect', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    seen.push(`CONNECT ${req.url}`)
    if (req.headers['proxy-authorization']) auth.push(String(req.headers['proxy-authorization']))
    const [host, port] = (req.url ?? '').split(':')
    const upstream = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  return listen(server, 'http').then((s) => ({ ...s, seen, auth }))
}
