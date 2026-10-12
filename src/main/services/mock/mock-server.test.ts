import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { MockEvent, MockLogEntry } from '@shared/mock'
import { mockFileSchema } from '@shared/schemas/mock'
import { MockServers } from './mock-server'

let servers: MockServers
let events: MockEvent[]
const logs = () => events.flatMap((e) => ('log' in e ? e.log : [])) as MockLogEntry[]
afterEach(() => servers?.stopAll())

const mock = (extra: { port?: number } & Record<string, unknown> = {}) => ({
  ...mockFileSchema.parse({
    version: 1,
    id: 'm1',
    name: 'API',
    routes: [
      { id: 'r1', method: 'GET', path: '/users/:id', body: '{"id":1}' },
      {
        id: 'r2',
        method: 'POST',
        path: '/users',
        status: 201,
        headers: [{ id: 'h', key: 'X-Mock', value: 'yes', enabled: true }],
        body: 'created',
        delayMs: 50
      }
    ],
    websockets: [
      {
        id: 'w1',
        path: '/ws',
        onConnect: [{ id: 'c', message: 'hello' }],
        rules: [{ id: 'x', match: 'equals', pattern: 'ping', reply: 'pong' }],
        intervals: [{ id: 'i', everyMs: 100, message: 'tick' }]
      }
    ],
    ...extra,
    port: 4010
  }),
  port: extra.port ?? 0 // any free port (tests only)
})

const start = async (extra: Record<string, unknown> = {}) => {
  events = []
  servers = new MockServers((e) => events.push(e))
  const status = await servers.start(mock(extra))
  return status.url as string
}

describe('MockServers (decision 133)', () => {
  it('answers routes with fixed content, CORS and a 404 for the rest', async () => {
    const url = await start()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const get = await fetch(`${url}/users/7?x=1`)
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toContain('application/json')
    expect(get.headers.get('access-control-allow-origin')).toBe('*')
    expect(await get.text()).toBe('{"id":1}')

    const started = Date.now()
    const post = await fetch(`${url}/users`, { method: 'POST', body: '{"a":1}' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
    expect([post.status, post.headers.get('x-mock'), await post.text()]).toEqual([
      201,
      'yes',
      'created'
    ])

    const preflight = await fetch(`${url}/users`, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'PUT', Origin: 'http://app.test' }
    })
    expect(preflight.status).toBe(204)
    expect((await fetch(`${url}/nope`)).status).toBe(404)
    await new Promise((r) => setTimeout(r, 150))
    expect(logs().map((l) => [l.method, l.path, l.routeId, l.status])).toEqual([
      ['GET', '/users/7', 'r1', 200],
      ['POST', '/users', 'r2', 201],
      ['OPTIONS', '/users', null, 204],
      ['GET', '/nope', null, 404]
    ])
  })

  it('runs WebSocket endpoints: on connect, reply rules, timed pushes', async () => {
    const url = await start()
    const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`)
    const received: string[] = []
    ws.on('message', (d) => received.push(d.toString()))
    await new Promise((r) => ws.once('open', r))
    ws.send('ping')
    ws.send('other')
    await new Promise((r) => setTimeout(r, 250))
    ws.close()
    expect(received[0]).toBe('hello')
    expect(received).toContain('pong')
    expect(received.filter((m) => m === 'tick').length).toBeGreaterThanOrEqual(1)
    expect(received.filter((m) => m === 'pong')).toHaveLength(1)

    const refused = new WebSocket(`${url.replace('http', 'ws')}/missing`)
    await expect(
      new Promise((resolve, reject) => {
        refused.once('open', resolve)
        refused.once('error', reject)
      })
    ).rejects.toThrow(/404/)
  })

  it('reports a busy port, and stops', async () => {
    const url = await start()
    const port = Number(new URL(url).port)
    const other = new MockServers(() => undefined)
    await expect(other.start(mock({ id: 'm2', port }))).rejects.toThrow(`連接埠 ${port} 已被使用`)
    expect(other.status('m2').error).toContain('已被使用')
    const stopped = await servers.stop('m1')
    expect(stopped).toEqual({ id: 'm1', running: false, url: null, error: null })
    await expect(fetch(`${url}/users/1`)).rejects.toThrow()
  })

  it('listens on every interface when LAN access is on', async () => {
    const url = await start({ lan: true })
    expect(url).toMatch(/^http:\/\/localhost:\d+$/)
    expect((await fetch(`${url.replace('localhost', '127.0.0.1')}/users/1`)).status).toBe(200)
  })
})
