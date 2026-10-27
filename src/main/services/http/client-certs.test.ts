import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HttpResult } from '@shared/http'
import { msg } from '@shared/i18n'
import { clientCertificateSchema, type ClientCertificate } from '@shared/schemas/app-config'
import type { BuiltRequest } from './build-request'
import {
  ClientCertError,
  ClientCertSet,
  loadClientCertificate,
  probeClientCert,
  verdictFromCode
} from './client-certs'
import { sendHttp } from './http-client'
import {
  mtlsFile,
  startHttpsServer,
  startMtlsServer,
  startProxy,
  type TestProxy,
  type TestServer
} from './test-servers'

const read = (p: string) => readFile(p)
const m = () => msg().httpMain.clientCert

let ids = 0
const pem = (host: string, extra: Partial<ClientCertificate> = {}) =>
  clientCertificateSchema.parse({
    id: `cert-${++ids}`,
    host,
    certPath: mtlsFile('client.pem'),
    keyPath: mtlsFile('client-key.pem'),
    ...extra
  })
const pfx = (host: string, extra: Partial<ClientCertificate> = {}) =>
  pem(host, { type: 'pfx', pfxPath: mtlsFile('client.p12'), passphrase: 'secret', ...extra })
const stranger = (host: string) =>
  pem(host, { certPath: mtlsFile('stranger.pem'), keyPath: mtlsFile('stranger-key.pem') })

describe('loadClientCertificate (decision 147)', () => {
  it('reads PEM (plain or encrypted key) and PKCS#12', async () => {
    expect((await loadClientCertificate(pem('a.test'), read)).cert).toBeInstanceOf(Buffer)
    const encrypted = pem('a.test', {
      keyPath: mtlsFile('client-key-encrypted.pem'),
      passphrase: 'secret'
    })
    expect((await loadClientCertificate(encrypted, read)).passphrase).toBe('secret')
    expect((await loadClientCertificate(pfx('a.test'), read)).pfx).toBeInstanceOf(Buffer)
  })

  it('explains unusable files', async () => {
    const fails = (entry: ClientCertificate) =>
      loadClientCertificate(entry, read).then(
        () => 'loaded',
        (e: unknown) => (e instanceof ClientCertError ? e.message : `other: ${String(e)}`)
      )
    expect(await fails(pfx('a.test', { passphrase: 'nope' }))).toBe(m().wrongPassphrase('a.test'))
    expect(await fails(pem('a.test', { keyPath: mtlsFile('client-key-encrypted.pem') }))).toBe(
      m().wrongPassphrase('a.test')
    )
    expect(await fails(pem('a.test', { keyPath: mtlsFile('stranger-key.pem') }))).toBe(
      m().keyMismatch('a.test')
    )
    expect(await fails(pem('a.test', { certPath: '/nope/missing.pem' }))).toBe(
      m().notFound('a.test', '/nope/missing.pem')
    )
    expect(await fails(pem('a.test', { keyPath: '' }))).toBe(m().noFile('a.test'))
    expect(await fails(pfx('a.test', { pfxPath: mtlsFile('ca.pem') }))).toMatch(
      m().badFile('a.test', '').slice(0, 20)
    )
  })

  it('reads every enabled entry once; a broken one fails only its own hosts', async () => {
    const set = await ClientCertSet.load(
      [
        pem('good.test'),
        pfx('bad.test', { passphrase: 'nope' }),
        pem('off.test', { enabled: false })
      ],
      read
    )
    expect(set.match('good.test', 443)?.tls?.cert).toBeInstanceOf(Buffer)
    expect(set.match('bad.test', 443)?.error?.message).toBe(m().wrongPassphrase('bad.test'))
    expect(set.match('off.test', 443)).toBeNull()
  })

  it('tells refusals from TLS alert codes', () => {
    expect(verdictFromCode('ERR_SSL_TLSV1_ALERT_CERTIFICATE_REQUIRED', false)).toBe('required')
    expect(verdictFromCode('ERR_SSL_TLSV1_ALERT_UNKNOWN_CA', true)).toBe('rejected')
    expect(verdictFromCode('ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE', true)).toBe('rejected')
    expect(verdictFromCode('ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', false)).toBe('likelyRequired')
    expect(verdictFromCode('ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', true)).toBe('likelyRejected')
    expect(verdictFromCode('ERR_TLS_CERT_ALTNAME_INVALID', false)).toBeNull()
    expect(verdictFromCode('ECONNRESET', false)).toBeNull()
  })
})

describe('sending with client certificates (decision 147)', () => {
  let tls13: TestServer
  let tls12: TestServer
  let plain: TestServer
  let proxy: TestProxy
  beforeAll(async () => {
    ;[tls13, tls12, plain, proxy] = await Promise.all([
      startMtlsServer('TLSv1.3'),
      startMtlsServer('TLSv1.2'),
      startHttpsServer(),
      startProxy()
    ])
  })
  afterAll(async () => {
    await Promise.all([tls13.close(), tls12.close(), plain.close(), proxy.close()])
  })

  const built = (url: string): BuiltRequest => ({
    method: 'GET',
    url,
    headers: [],
    body: null,
    options: {
      timeoutMs: 5000,
      validateSSL: false,
      followRedirects: true,
      maxRedirects: 3,
      useProxy: true,
      httpVersion: 'auto'
    }
  })
  const send = async (url: string, list: ClientCertificate[], proxyUrl: string | null = null) =>
    sendHttp(built(url), {
      runId: 'r',
      proxyUrl,
      proxyAuth: null,
      signal: new AbortController().signal,
      clientCerts: await ClientCertSet.load(list, read)
    })
  const body = (r: HttpResult) => {
    if (r.kind !== 'response') throw new Error(`${r.code}: ${r.message}`)
    return r.body.kind === 'text' ? r.body.text : r.body.kind
  }

  it('presents the certificate of the matching host (PEM or PKCS#12, TLS 1.2 and 1.3)', async () => {
    for (const server of [tls13, tls12]) {
      for (const entry of [pem('localhost'), pfx('*.localhost'), pfx('localhost')]) {
        const { result } = await send(`${server.url}/`, [entry])
        if (entry.host === '*.localhost') {
          // *. does not match the host itself.
          expect(result.kind).toBe('error')
          continue
        }
        expect(body(result)).toBe('hello client')
        expect(result.kind === 'response' && result.clientCertificate).toEqual({
          host: 'localhost',
          files: entry.type === 'pfx' ? 'client.p12' : 'client.pem + client-key.pem'
        })
      }
    }
  })

  it('without a certificate the server refuses; the outcome is marked for a second look', async () => {
    const { result, refused } = await send(`${tls13.url}/`, [pem('other.test')])
    expect(result.kind).toBe('error')
    expect(refused).toBe(true)
    // Not for requests that never reached a server.
    expect((await send('https://127.0.0.1:1/', [])).refused).toBe(false)
  })

  it('an unusable file fails before connecting, with CLIENT_CERT', async () => {
    const { result } = await send(`${tls13.url}/`, [pem('localhost', { keyPath: '/nope.pem' })])
    expect(result.kind === 'error' && [result.code, result.message]).toEqual([
      'CLIENT_CERT',
      m().notFound('localhost', '/nope.pem')
    ])
    // Other hosts are not affected.
    const other = await send(`${plain.url}/json`, [pem('localhost', { keyPath: '/nope.pem' })])
    expect(other.result.kind).toBe('response')
  })

  it('works through the proxy tunnel, and follows redirects to another host with its certificate', async () => {
    const r = await send(`${tls13.url}/`, [pfx('localhost')], proxy.url)
    expect(body(r.result)).toBe('hello client')
    // 127.0.0.1 (no certificate) redirects to localhost (certificate).
    const from = tls12.url.replace('localhost', '127.0.0.1')
    const to = encodeURIComponent(`${tls13.url}/`)
    for (const proxyUrl of [null, proxy.url]) {
      const { result } = await send(
        `${from}/redirect?to=${to}`,
        [pem('localhost'), pem('127.0.0.1')],
        proxyUrl
      )
      expect(body(result)).toBe('hello client')
    }
  })

  it('probes why the server ended the connection', async () => {
    const target = (s: TestServer) => {
      const u = new URL(s.url)
      return [u.hostname, Number(u.port)] as const
    }
    const direct = { proxyUrl: null, proxyAuth: null }
    const tlsOf = async (e: ClientCertificate) => loadClientCertificate(e, read)
    expect(await probeClientCert(...target(tls13), direct)).toBe('required')
    expect(await probeClientCert(...target(tls12), direct)).toBe('likelyRequired')
    const strangerTls = await tlsOf(stranger('localhost'))
    expect(await probeClientCert(...target(tls13), { ...direct, clientCert: strangerTls })).toMatch(
      /[rR]ejected/
    )
    expect(
      await probeClientCert(...target(tls13), { ...direct, clientCert: await tlsOf(pem('x')) })
    ).toBeNull()
    expect(await probeClientCert(...target(plain), direct)).toBeNull()
  })
})
