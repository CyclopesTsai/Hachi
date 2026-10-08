import { describe, expect, it } from 'vitest'
import { digestAuthorization, parseDigestChallenge } from './digest'

const field = (header: string, name: string) => new RegExp(`${name}="?([^",]*)"?`).exec(header)?.[1]

describe('Digest auth', () => {
  it('parses the Digest challenge among several schemes', () => {
    const challenge = parseDigestChallenge([
      'Bearer realm="api"',
      'Basic realm="x", Digest realm="test", qop="auth,auth-int", nonce="n1", opaque="op", algorithm=MD5-sess'
    ])
    expect(challenge).toEqual({
      realm: 'test',
      nonce: 'n1',
      opaque: 'op',
      algorithm: 'MD5-sess',
      qop: ['auth', 'auth-int']
    })
    expect(parseDigestChallenge(['Basic realm="x"'])).toBeNull()
    expect(parseDigestChallenge(['Digest realm="a", nonce="n", qop="auth-int"'])).toBeNull()
    expect(parseDigestChallenge(['Digest realm="a", nonce="n", algorithm=SHA-512'])).toBeNull()
  })

  it('matches the RFC 2617 example', () => {
    const header = digestAuthorization({
      username: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      cnonce: '0a4f113b',
      challenge: {
        realm: 'testrealm@host.com',
        nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
        opaque: '5ccc069c403ebaf9f0171e9517f40e41',
        algorithm: 'MD5',
        qop: ['auth', 'auth-int']
      }
    })
    expect(field(header, 'response')).toBe('6629fae49393a05397450978507c4ef1')
    expect(header).toContain('qop=auth, nc=00000001, cnonce="0a4f113b"')
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
  })

  it('matches the RFC 7616 SHA-256 and MD5 examples', () => {
    const base = {
      username: 'Mufasa',
      password: 'Circle of Life',
      method: 'GET',
      uri: '/dir/index.html',
      cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ'
    }
    const challenge = {
      realm: 'http-auth@example.org',
      nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
      opaque: 'FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS',
      qop: ['auth', 'auth-int']
    }
    const sha = digestAuthorization({ ...base, challenge: { ...challenge, algorithm: 'SHA-256' } })
    expect(field(sha, 'response')).toBe(
      '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1'
    )
    const md5 = digestAuthorization({ ...base, challenge: { ...challenge, algorithm: 'MD5' } })
    expect(field(md5, 'response')).toBe('8ca523f5e9506fed4657c9700eebdbec')
  })

  it('works without qop (RFC 2069 style)', () => {
    const header = digestAuthorization({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/',
      challenge: { realm: 'r', nonce: 'n', opaque: null, algorithm: 'MD5', qop: [] }
    })
    expect(header).not.toContain('qop=')
    expect(header).not.toContain('opaque=')
  })
})
