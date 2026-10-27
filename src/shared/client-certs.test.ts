import { describe, expect, it } from 'vitest'
import {
  clientCertFiles,
  clientCertHostLabel,
  matchClientCertificate,
  portOf
} from './client-certs'
import { appConfigSchema, clientCertificateSchema } from './schemas/app-config'

const entry = (host: string, extra: Record<string, unknown> = {}) =>
  clientCertificateSchema.parse({ id: host + JSON.stringify(extra), host, ...extra })

describe('matchClientCertificate (decision 147)', () => {
  const exact = entry('api.example.com')
  const exactPort = entry('api.example.com', { port: 8443 })
  const wildcard = entry('*.example.com')
  const deeper = entry('*.eu.example.com')
  const list = [wildcard, deeper, exact, exactPort]
  const match = (host: string, port = 443) => matchClientCertificate(list, host, port)

  it('prefers the exact host, then the longer *. suffix, then a set port', () => {
    expect(match('api.example.com')).toBe(exact)
    expect(match('api.example.com', 8443)).toBe(exactPort)
    expect(match('www.example.com')).toBe(wildcard)
    expect(match('api.eu.example.com')).toBe(deeper)
  })

  it('does not match the apex with *., other hosts, or disabled entries', () => {
    expect(match('example.com')).toBeNull()
    expect(match('example.org')).toBeNull()
    expect(match('evil-example.com')).toBeNull()
    const off = entry('api.example.com', { enabled: false })
    expect(matchClientCertificate([off], 'api.example.com', 443)).toBeNull()
  })

  it('compares hosts case-insensitively; IPv6 with or without brackets', () => {
    expect(match('API.Example.COM')).toBe(exact)
    const v6 = entry('[::1]', { port: 8443 })
    expect(v6.host).toBe('::1')
    expect(matchClientCertificate([v6], '[::1]', 8443)).toBe(v6)
    expect(clientCertHostLabel(v6)).toBe('[::1]:8443')
  })

  it('rejects malformed hosts and ports in the settings', () => {
    for (const host of ['', 'http://a.test', 'a.test/path', '*', 'a.*.test', 'a b']) {
      expect(clientCertificateSchema.safeParse({ id: 'x', host }).success, host).toBe(false)
    }
    expect(clientCertificateSchema.safeParse({ id: 'x', host: 'a.test', port: 0 }).success).toBe(
      false
    )
    expect(appConfigSchema.parse({ version: 1 }).clientCertificates).toEqual([])
  })

  it('labels entries and their files', () => {
    expect(clientCertHostLabel(exactPort)).toBe('api.example.com:8443')
    const pem = entry('a.test', { certPath: '/c/client.pem', keyPath: 'C:\\k\\client-key.pem' })
    expect(clientCertFiles(pem)).toBe('client.pem + client-key.pem')
    expect(clientCertFiles(entry('a.test', { type: 'pfx', pfxPath: '/c/apns.p12' }))).toBe(
      'apns.p12'
    )
    expect(portOf(new URL('wss://a.test/x'))).toBe(443)
    expect(portOf(new URL('http://a.test:8080'))).toBe(8080)
  })
})
