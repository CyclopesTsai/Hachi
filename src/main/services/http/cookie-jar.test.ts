import { describe, expect, it } from 'vitest'
import { CookieJar, domainMatches, pathMatches } from './cookie-jar'

const now = Date.UTC(2026, 0, 1)

describe('CookieJar (decision 129)', () => {
  it('stores Set-Cookie and sends matching cookies back', () => {
    const jar = new CookieJar()
    jar.store(
      'https://api.example.com/v1/login',
      ['sid=1; Path=/', 'theme=dark', 'wide=yes; Domain=.example.com; Path=/'],
      now
    )
    // No Path: the default path is the request path's directory.
    expect(jar.header('https://api.example.com/v1/users', now)).toBe('theme=dark; sid=1; wide=yes')
    expect(jar.header('https://api.example.com/other', now)).toBe('sid=1; wide=yes')
    // Host-only vs Domain cookies.
    expect(jar.header('https://www.example.com/', now)).toBe('wide=yes')
    expect(jar.header('https://example.org/', now)).toBeNull()
  })

  it('orders longer paths first and replaces cookies with the same name / domain / path', () => {
    const jar = new CookieJar()
    jar.store('http://localhost/', ['a=1; Path=/'], now)
    jar.store('http://localhost/', ['b=2; Path=/deep'], now + 1)
    jar.store('http://localhost/', ['a=3; Path=/'], now + 2)
    expect(jar.header('http://localhost/deep/x', now)).toBe('b=2; a=3')
    expect(jar.list(now)).toHaveLength(2)
  })

  it('expires cookies with Max-Age / Expires, and deletes with Max-Age=0', () => {
    const jar = new CookieJar()
    jar.store(
      'https://a.test/',
      ['short=1; Max-Age=10', `dated=1; Expires=${new Date(now + 60_000).toUTCString()}`],
      now
    )
    expect(jar.header('https://a.test/', now)).toBe('short=1; dated=1')
    expect(jar.header('https://a.test/', now + 20_000)).toBe('dated=1')
    jar.store('https://a.test/', ['dated=; Max-Age=0'], now)
    expect(jar.header('https://a.test/', now)).toBe('short=1')
  })

  it('keeps Secure cookies to secure origins and refuses foreign domains', () => {
    const jar = new CookieJar()
    jar.store('http://plain.test/', ['s=1; Secure'], now) // refused: not a secure origin
    jar.store('https://plain.test/', ['s=2; Secure'], now)
    jar.store('https://plain.test/', ['x=1; Domain=other.test', 'tld=1; Domain=test'], now)
    expect(jar.header('http://plain.test/', now)).toBeNull()
    expect(jar.header('https://plain.test/', now)).toBe('s=2')
    expect(jar.list(now).map((c) => c.name)).toEqual(['s'])
    // localhost counts as secure, as in browsers.
    jar.store('http://localhost:3000/', ['local=1; Secure'], now)
    expect(jar.header('http://localhost:3000/', now)).toBe('local=1')
  })

  it('deletes, clears, clones and notifies', () => {
    const jar = new CookieJar()
    let changes = 0
    jar.onChange(() => changes++)
    jar.store('https://a.test/', ['a=1', 'b=2'], now)
    jar.store('https://b.test/', ['c=3'], now)
    const copy = jar.clone()
    jar.delete({ name: 'a', domain: 'a.test', path: '/' })
    jar.clear('b.test')
    expect(jar.list(now).map((c) => c.name)).toEqual(['b'])
    jar.clear()
    expect(jar.list(now)).toEqual([])
    expect(copy.list(now)).toHaveLength(3)
    expect(changes).toBe(5)
  })

  it('matches domains and paths as RFC 6265 says', () => {
    expect(domainMatches('a.b.example.com', 'example.com')).toBe(true)
    expect(domainMatches('badexample.com', 'example.com')).toBe(false)
    expect(domainMatches('1.2.3.4', '2.3.4')).toBe(false)
    expect(pathMatches('/docs/x', '/docs')).toBe(true)
    expect(pathMatches('/docsx', '/docs')).toBe(false)
    expect(pathMatches('/docs/', '/docs/')).toBe(true)
  })
})
