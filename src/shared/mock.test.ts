import { describe, expect, it } from 'vitest'
import { findRoute, mockPathOf, pathMatches, wsRuleMatches } from './mock'
import { mockRouteSchema } from './schemas/mock'

const route = (method: string, path: string, extra: object = {}) =>
  mockRouteSchema.parse({ id: `${method} ${path}`, method, path, ...extra })

describe('Mock Server helpers (decision 133)', () => {
  it('matches paths with :params and a trailing *', () => {
    expect(pathMatches('/users/:id', '/users/42')).toBe(true)
    expect(pathMatches('/users/:id', '/users/42/posts')).toBe(false)
    expect(pathMatches('/users/:id', '/users')).toBe(false)
    expect(pathMatches('/files/*', '/files/a/b.txt')).toBe(true)
    expect(pathMatches('/files/*', '/files')).toBe(true) // * may be empty
    expect(pathMatches('/', '/')).toBe(true)
    expect(pathMatches('/a/', '/a')).toBe(true)
    expect(pathMatches('*', '/anything/at/all')).toBe(true)
  })

  it('picks the first enabled route for the method (HEAD falls back to GET)', () => {
    const routes = [
      route('GET', '/users/:id', { enabled: false }),
      route('POST', '/users'),
      route('ANY', '/users/*'),
      route('GET', '/users/:id')
    ]
    expect(findRoute(routes, 'get', '/users/1')?.id).toBe('ANY /users/*')
    expect(findRoute(routes, 'POST', '/users')?.id).toBe('POST /users')
    expect(findRoute([route('GET', '/x')], 'HEAD', '/x')?.id).toBe('GET /x')
    expect(findRoute(routes, 'DELETE', '/other')).toBeNull()
  })

  it('matches WebSocket reply rules', () => {
    expect(wsRuleMatches('contains', 'ping', 'a ping!')).toBe(true)
    expect(wsRuleMatches('equals', 'ping', 'ping ')).toBe(false)
    expect(wsRuleMatches('regex', '^\\{"type":"sub', '{"type":"subscribe"}')).toBe(true)
    expect(wsRuleMatches('regex', '(', 'x')).toBe(false)
  })

  it('turns request URLs into route paths', () => {
    expect(mockPathOf('{{baseUrl}}/users/{{id}}?x=1')).toBe('/users/:id')
    expect(mockPathOf('https://api.test:8080/v1/items#top')).toBe('/v1/items')
    expect(mockPathOf('api.test/v1')).toBe('/v1')
    expect(mockPathOf('{{host}}')).toBe('/')
    expect(mockPathOf('/health')).toBe('/health')
  })
})
