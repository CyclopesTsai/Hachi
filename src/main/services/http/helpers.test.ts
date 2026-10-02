import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { parsePacResult, resolveProxyUrl, shouldBypassProxy } from './proxy'
import {
  BodyTooLargeError,
  decodeText,
  decompress,
  isTextual,
  parseSetCookie,
  suggestFileName
} from './response-utils'

describe('shouldBypassProxy', () => {
  const list = ['localhost', '*.internal', '.corp.test', '::1']
  it.each([
    ['localhost', true],
    ['LOCALHOST', true],
    ['api.internal', true],
    ['internal', true],
    ['a.b.corp.test', true],
    ['corp.test', true],
    ['::1', true],
    ['[::1]', true],
    ['example.com', false],
    ['notinternal', false]
  ])('%s → %s', (host, expected) => {
    expect(shouldBypassProxy(host, list)).toBe(expected)
  })

  it('supports "*" for everything', () => {
    expect(shouldBypassProxy('anything.test', ['*'])).toBe(true)
  })
})

describe('parsePacResult', () => {
  it.each([
    ['PROXY proxy.test:3128; DIRECT', 'http://proxy.test:3128'],
    ['HTTPS secure.test:443', 'https://secure.test:443'],
    ['DIRECT', null],
    ['SOCKS5 s.test:1080', null],
    ['', null]
  ])('%j → %j', (input, expected) => {
    expect(parsePacResult(input)).toBe(expected)
  })
})

describe('resolveProxyUrl', () => {
  const settings = (o: object) => proxySettingsSchema.parse(o)
  const system = async () => 'PROXY sys.test:8080'

  it('returns null when off, bypassed or disabled for the request', async () => {
    expect(await resolveProxyUrl('http://a.test', settings({}), true, system)).toBeNull()
    const custom = settings({ mode: 'custom', url: 'proxy.test:3128' })
    expect(await resolveProxyUrl('http://localhost:3000', custom, true, system)).toBeNull()
    expect(await resolveProxyUrl('http://a.test', custom, false, system)).toBeNull()
  })

  it('uses the custom URL (adding http://) or the system proxy', async () => {
    const custom = settings({ mode: 'custom', url: 'proxy.test:3128' })
    expect(await resolveProxyUrl('http://a.test', custom, true, system)).toBe(
      'http://proxy.test:3128'
    )
    expect(await resolveProxyUrl('http://a.test', settings({ mode: 'system' }), true, system)).toBe(
      'http://sys.test:8080'
    )
  })
})

describe('parseSetCookie', () => {
  it('parses attributes', () => {
    expect(
      parseSetCookie(
        'id=a=b; Domain=.x.test; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; SameSite=Lax; HttpOnly'
      )
    ).toEqual({
      name: 'id',
      value: 'a=b',
      domain: '.x.test',
      path: '/',
      expires: 'Wed, 21 Oct 2026 07:28:00 GMT',
      secure: true,
      sameSite: 'Lax',
      httpOnly: true
    })
  })

  it('ignores headers without a name', () => {
    expect(parseSetCookie('=x')).toBeNull()
    expect(parseSetCookie('garbage')).toBeNull()
  })
})

describe('decompress', () => {
  const text = Buffer.from('hello hello hello')
  it.each([
    ['gzip', zlib.gzipSync(text)],
    ['deflate', zlib.deflateSync(text)],
    ['deflate', zlib.deflateRawSync(text)],
    ['br', zlib.brotliCompressSync(text)],
    ['identity', text]
  ])('handles %s', (encoding, data) => {
    expect(decompress(data, encoding).toString()).toBe('hello hello hello')
  })

  it('returns the input for unknown encodings or corrupt data', () => {
    expect(decompress(text, 'weird')).toBe(text)
    expect(decompress(text, 'gzip')).toBe(text)
  })

  it('guards against decompression bombs', () => {
    const bomb = zlib.gzipSync(Buffer.alloc(5_000_000))
    expect(() => decompress(bomb, 'gzip', 1_000_000)).toThrow(BodyTooLargeError)
  })
})

describe('isTextual / decodeText', () => {
  it.each([
    ['application/json', true],
    ['application/problem+json; charset=utf-8', true],
    ['text/html', true],
    ['image/svg+xml', true],
    ['image/png', false],
    ['application/octet-stream', false]
  ])('%s → %s', (type, expected) => {
    expect(isTextual(type, Buffer.from('x'))).toBe(expected)
  })

  it('sniffs bodies without a content type', () => {
    expect(isTextual('', Buffer.from('plain text 中文'))).toBe(true)
    expect(isTextual('', Buffer.from([0x89, 0x50, 0x00, 0x47]))).toBe(false)
  })

  it('honours the charset', () => {
    const big5 = Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]) // "中文" in Big5
    expect(decodeText(big5, 'text/plain; charset=big5')).toBe('中文')
    expect(decodeText(Buffer.from('é'), 'text/plain')).toBe('é')
  })
})

describe('suggestFileName', () => {
  it.each([
    ['https://x.test/api/users', 'application/json', 'users.json'],
    ['https://x.test/report.pdf', 'application/pdf', 'report.pdf'],
    ['https://x.test/', 'text/html; charset=utf-8', 'response.html'],
    ['https://x.test/a%3Ab', 'text/plain', 'a-b.txt'],
    ['https://x.test/blob', 'application/x-unknown', 'blob.bin']
  ])('%s (%s) → %s', (url, type, expected) => {
    expect(suggestFileName(url, type)).toBe(expected)
  })
})
