import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HttpErrorData, HttpResponseData, HttpResult } from '@shared/http'
import type { BuiltRequest, EffectiveOptions } from './build-request'
import { msg } from '@shared/i18n'
import { classifyError, sendHttp, type SendOptions } from './http-client'
import {
  startHttp2Server,
  startHttpServer,
  startHttpsServer,
  startProxy,
  type TestProxy,
  type TestServer
} from './test-servers'

let server: TestServer
let tlsServer: TestServer
let proxy: TestProxy

beforeAll(async () => {
  ;[server, tlsServer, proxy] = await Promise.all([
    startHttpServer(),
    startHttpsServer(),
    startProxy()
  ])
})

afterAll(async () => {
  await Promise.all([server.close(), tlsServer.close(), proxy.close()])
})

const defaults: EffectiveOptions = {
  timeoutMs: 5000,
  validateSSL: true,
  followRedirects: true,
  maxRedirects: 3,
  useProxy: true,
  httpVersion: 'auto'
}

function req(
  url: string,
  overrides: Omit<Partial<BuiltRequest>, 'options'> & { options?: Partial<EffectiveOptions> } = {}
): BuiltRequest {
  return {
    method: 'GET',
    url,
    headers: [],
    body: null,
    ...overrides,
    options: { ...defaults, ...overrides.options }
  }
}

async function send(built: BuiltRequest, options: Partial<SendOptions> = {}): Promise<HttpResult> {
  const { result } = await sendHttp(built, {
    runId: 'run',
    proxyUrl: null,
    proxyAuth: null,
    signal: new AbortController().signal,
    ...options
  })
  return result
}

function ok(result: HttpResult): HttpResponseData {
  if (result.kind !== 'response')
    throw new Error(`expected a response, got ${result.code}: ${result.message}`)
  return result
}

function failed(result: HttpResult): HttpErrorData {
  if (result.kind !== 'error') throw new Error(`expected an error, got ${result.status}`)
  return result
}

function text(result: HttpResponseData): string {
  if (result.body.kind !== 'text') throw new Error(`expected text, got ${result.body.kind}`)
  return result.body.text
}

describe('sendHttp', () => {
  it('returns status, headers, cookies, timings and the text body', async () => {
    const r = ok(await send(req(`${server.url}/json`)))
    expect(r).toMatchObject({ status: 200, statusText: 'OK', redirects: 0 })
    expect(JSON.parse(text(r))).toEqual({ ok: true, items: [1, 2, 3] })
    expect(r.contentType).toBe('application/json; charset=utf-8')
    expect(r.headers.filter(([k]) => k === 'set-cookie')).toHaveLength(2)
    expect(r.cookies).toEqual([
      { name: 'session', value: 'abc', path: '/', httpOnly: true, secure: false },
      { name: 'theme', value: 'dark', maxAge: 60, httpOnly: false, secure: false }
    ])
    expect(r.bodyBytes).toBe(text(r).length)
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.timings.headersMs)
  })

  it('sends method, headers and body', async () => {
    const r = ok(
      await send(
        req(`${server.url}/echo?a=1`, {
          method: 'PATCH',
          headers: [
            ['X-Test', 'yes'],
            ['Content-Type', 'application/json']
          ],
          body: '{"name":"hachi"}'
        })
      )
    )
    const echo = JSON.parse(text(r)) as {
      method: string
      url: string
      headers: Record<string, string>
      body: string
    }
    expect(echo).toMatchObject({ method: 'PATCH', url: '/echo?a=1', body: '{"name":"hachi"}' })
    expect(echo.headers['x-test']).toBe('yes')
  })

  it('decompresses gzip bodies', async () => {
    expect(text(ok(await send(req(`${server.url}/gzip`))))).toBe('compressed hello')
  })

  it('follows redirects and counts them', async () => {
    const r = ok(await send(req(`${server.url}/redirect?n=2`)))
    expect(r).toMatchObject({ status: 200, redirects: 2 })
  })

  it('returns the 3xx response when redirects are off', async () => {
    const r = ok(await send(req(`${server.url}/redirect`, { options: { followRedirects: false } })))
    expect(r.status).toBe(302)
    expect(r.headers).toContainEqual(['location', '/json'])
  })

  it('stops after the configured number of redirects', async () => {
    const r = failed(
      await send(req(`${server.url}/redirect?n=4`, { options: { maxRedirects: 3 } }))
    )
    expect(r.code).toBe('TOO_MANY_REDIRECTS')
  })

  it('times out', async () => {
    const r = failed(await send(req(`${server.url}/slow?ms=2000`, { options: { timeoutMs: 200 } })))
    expect(r.code).toBe('TIMEOUT')
  })

  it('can be cancelled', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const r = failed(await send(req(`${server.url}/slow?ms=2000`), { signal: controller.signal }))
    expect(r.code).toBe('CANCELLED')
  })

  it('reports connection errors as NETWORK', async () => {
    const r = failed(await send(req('http://127.0.0.1:1/nothing')))
    expect(r.code).toBe('NETWORK')
  })

  it('rejects self-signed certificates unless SSL verification is off', async () => {
    expect(failed(await send(req(`${tlsServer.url}/json`))).code).toBe('TLS')
    const r = ok(await send(req(`${tlsServer.url}/json`, { options: { validateSSL: false } })))
    expect(r.status).toBe(200)
  })

  it('marks big text bodies as "large" and binary bodies as "binary"', async () => {
    const big = ok(await send(req(`${server.url}/bytes?size=2048`), { displayLimitBytes: 1024 }))
    expect(big.body).toEqual({ kind: 'large' })
    expect(big.bodyBytes).toBe(2048)
    const image = ok(await send(req(`${server.url}/bytes?size=10&type=image/png`)))
    expect(image.body).toEqual({ kind: 'binary' })
    const empty = ok(await send(req(`${server.url}/bytes?size=0`)))
    expect(empty.body).toEqual({ kind: 'empty' })
  })

  it('aborts responses over the size limit', async () => {
    const r = failed(await send(req(`${server.url}/bytes?size=5000`), { maxResponseBytes: 1000 }))
    expect(r.code).toBe('TOO_LARGE')
  })

  it('goes through an HTTP proxy (absolute-form) with proxy auth', async () => {
    const r = ok(
      await send(req(`${server.url}/json`), {
        proxyUrl: proxy.url,
        proxyAuth: { username: 'me', password: 'secret' }
      })
    )
    expect(r.status).toBe(200)
    expect(proxy.seen).toContain(`${server.url}/json`)
    expect(proxy.auth).toContain(`Basic ${Buffer.from('me:secret').toString('base64')}`)
  })

  it('tunnels HTTPS through the proxy with CONNECT', async () => {
    const r = ok(
      await send(req(`${tlsServer.url}/json`, { options: { validateSSL: false } }), {
        proxyUrl: proxy.url
      })
    )
    expect(r.status).toBe(200)
    expect(proxy.seen).toContain(`CONNECT ${new URL(tlsServer.url).host}`)
  })

  it('reports an unreachable proxy', async () => {
    const r = failed(await send(req(`${server.url}/json`), { proxyUrl: 'http://127.0.0.1:1' }))
    expect(['PROXY', 'NETWORK']).toContain(r.code)
  })
})

describe('HTTP version (decision 146)', () => {
  let h2: TestServer
  let h2Only: TestServer
  beforeAll(async () => {
    ;[h2, h2Only] = await Promise.all([startHttp2Server(), startHttp2Server({ h2Only: true })])
  })
  afterAll(async () => {
    await Promise.all([h2.close(), h2Only.close()])
  })
  const insecure = (url: string, httpVersion: EffectiveOptions['httpVersion']) =>
    req(url, { options: { validateSSL: false, httpVersion } })
  const version = (r: HttpResponseData) => (JSON.parse(text(r)) as { version: string }).version
  const v = () => msg().httpMain.version

  it('Auto uses HTTP/2 when the server offers it, else HTTP/1.1', async () => {
    const r = ok(await send(insecure(`${h2.url}/version`, 'auto')))
    expect([r.httpVersion, version(r)]).toEqual(['2', '2.0'])
    expect(r.statusText).toBe('OK')
    expect(r.headers).toContainEqual(['x-test', 'A'])
    expect(r.headers.some(([k]) => k.startsWith(':'))).toBe(false)
    // No status line: just the fields (":status" + 3 digits included).
    expect(r.headerBytes).toBe(r.headers.reduce((n, [k, v]) => n + k.length + v.length, 10))
    expect(ok(await send(insecure(`${tlsServer.url}/json`, 'auto'))).httpVersion).toBe('1.1')
    expect(ok(await send(req(`${server.url}/json`))).httpVersion).toBe('1.1')
  })

  it('HTTP/1.1 only does not offer h2', async () => {
    const r = ok(await send(insecure(`${h2.url}/version`, 'http1')))
    expect([r.httpVersion, version(r)]).toEqual(['1.1', '1.1'])
    const e = failed(await send(insecure(`${h2Only.url}/version`, 'http1')))
    expect([e.code, e.message]).toEqual(['HTTP_VERSION', v().onlyHttp2])
  })

  it('HTTP/2 only fails instead of falling back', async () => {
    const r = ok(await send(insecure(`${h2Only.url}/version`, 'http2')))
    expect([r.httpVersion, version(r)]).toEqual(['2', '2.0'])
    const e = failed(await send(insecure(`${tlsServer.url}/json`, 'http2')))
    expect([e.code, e.message]).toEqual(['HTTP_VERSION', v().noHttp2])
    const plain = failed(
      await send(req(`${server.url}/json`, { options: { httpVersion: 'http2' } }))
    )
    expect([plain.code, plain.message]).toEqual(['HTTP_VERSION', v().noH2c])
  })

  it('works through the proxy tunnel', async () => {
    const r = ok(await send(insecure(`${h2Only.url}/version`, 'http2'), { proxyUrl: proxy.url }))
    expect(r.httpVersion).toBe('2')
    const auto = ok(await send(insecure(`${h2.url}/version`, 'auto'), { proxyUrl: proxy.url }))
    expect(auto.httpVersion).toBe('2')
    const e = failed(
      await send(insecure(`${h2Only.url}/version`, 'http1'), { proxyUrl: proxy.url })
    )
    expect(e.code).toBe('HTTP_VERSION')
    const old = failed(
      await send(insecure(`${tlsServer.url}/json`, 'http2'), { proxyUrl: proxy.url })
    )
    expect([old.code, old.message]).toEqual(['HTTP_VERSION', v().noHttp2])
  })

  it('reports the protocol of the final response after redirects', async () => {
    const to = encodeURIComponent(`${tlsServer.url}/json`)
    const hooks = { header: () => null, store: () => undefined }
    for (const cookies of [undefined, hooks]) {
      const r = ok(await send(insecure(`${h2.url}/redirect?to=${to}`, 'auto'), { cookies }))
      expect([r.redirects, r.httpVersion]).toEqual([1, '1.1'])
    }
    const e = failed(await send(insecure(`${h2.url}/redirect?to=${to}`, 'http2')))
    expect(e.code).toBe('HTTP_VERSION')
  })
})

describe('classifyError', () => {
  it('walks the cause chain', () => {
    const error = new Error('fetch failed', {
      cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    })
    expect(classifyError(error, false, false)).toEqual({
      code: 'NETWORK',
      message: 'fetch failed: refused'
    })
  })

  it('explains ALPN failures by the HTTP version setting', () => {
    const alpn = Object.assign(new Error('alert'), {
      code: 'ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL'
    })
    const v = msg().httpMain.version
    expect(classifyError(alpn, false, false, 'http1')).toEqual({
      code: 'HTTP_VERSION',
      message: v.onlyHttp2
    })
    expect(classifyError(alpn, false, false, 'http2').message).toBe(v.noHttp2)
    expect(classifyError(alpn, false, false).message).toBe(v.noProtocol)
  })

  it('prefers cancel / timeout flags', () => {
    expect(classifyError(new Error('x'), true, false).code).toBe('CANCELLED')
    expect(classifyError(new Error('x'), false, true).code).toBe('TIMEOUT')
  })
})
