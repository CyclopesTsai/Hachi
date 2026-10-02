import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { proxySettingsSchema, type ProxySettings } from '@shared/schemas/app-config'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { wsRequestSchema } from '@shared/schemas/ws-request'
import type { VariableLayer } from '@shared/variables'
import type { WsEventPayload, WsLogEntry } from '@shared/ws'
import { resolveInherited, type ContainerLevel } from '../http/build-request'
import { startProxy, type TestProxy } from '../http/test-servers'
import { startWsServer, type TestWsServer } from './test-ws-server'
import { WsService, type WsConnectionSummary } from './ws-service'

let server: TestWsServer
let tlsServer: TestWsServer
let proxy: TestProxy

beforeAll(async () => {
  ;[server, tlsServer, proxy] = await Promise.all([
    startWsServer(),
    startWsServer({ tls: true }),
    startProxy()
  ])
})
afterAll(async () => {
  await Promise.all([server.close(), tlsServer.close(), proxy.close()])
})

const variable = (key: string, value: string, secret = false) => ({
  id: key,
  key,
  value,
  enabled: true,
  secret
})

function setup(
  options: { layers?: VariableLayer[]; chain?: ContainerLevel[]; proxy?: ProxySettings } = {}
) {
  const payloads: WsEventPayload[] = []
  const finished: WsConnectionSummary[] = []
  const service = new WsService({
    getContainerChain: async () => options.chain ?? [],
    resolveInherited,
    getVariableLayers: async () => options.layers ?? [],
    getWorkspaceSettings: async () => workspaceSettingsSchema.parse({ timeoutMs: 2000 }),
    getProxySettings: () => options.proxy ?? proxySettingsSchema.parse({}),
    resolveSystemProxy: async () => 'DIRECT',
    userAgent: 'Hachi/test',
    emit: (p) => payloads.push(p),
    onFinished: (s) => finished.push(s),
    flushIntervalMs: 5
  })
  const entries = (id: string): WsLogEntry[] =>
    payloads.filter((p) => p.connectionId === id).flatMap((p) => p.entries)
  const status = (id: string) =>
    payloads.filter((p) => p.connectionId === id && p.state).at(-1)?.state
  return { service, payloads, finished, entries, status }
}

async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const request = (url: string, extra: object = {}) =>
  wsRequestSchema.parse({ version: 1, id: 'w', type: 'websocket', name: 'W', url, ...extra })

describe('WsService', () => {
  it('connects with variables, inherited headers / auth, params and a subprotocol', async () => {
    const { service, status } = setup({
      layers: [
        {
          source: 'environment',
          sourceName: 'dev',
          variables: [variable('base', server.url), variable('token', 'T0K', true)]
        }
      ],
      chain: [
        {
          id: 'c',
          name: 'C',
          headers: [{ id: 'h', key: 'X-Team', value: 'core', enabled: true }],
          auth: { type: 'bearer', token: '{{token}}' }
        }
      ]
    })
    const result = await service.connect({
      connectionId: 'a',
      parentId: 'c',
      environmentId: 'e',
      request: request('{{base}}/live?x={{missing}}', {
        params: [{ id: 'p', key: 'room', value: '1', enabled: true }],
        subprotocols: ['chat.v1', 'chat.v2']
      })
    })
    expect(result.unresolvedVariables).toEqual(['missing'])
    await until(() => status('a')?.status === 'open', 'open')
    expect(status('a')).toMatchObject({ protocol: 'chat.v2' })
    const seen = server.connections.at(-1)!
    expect(seen.url).toBe('/live?x={{missing}}&room=1')
    expect(seen.headers['x-team']).toBe('core')
    expect(seen.headers.authorization).toBe('Bearer T0K')
    expect(seen.headers['user-agent']).toBe('Hachi/test')
    expect(service.activeIds()).toEqual(['a'])
    service.disconnect('a')
    await until(() => status('a')?.status === 'closed', 'closed')
  })

  it('sends text / binary (variables resolved at send time) and logs the echo', async () => {
    const { service, entries, status, finished } = setup({
      layers: [{ source: 'environment', sourceName: 'dev', variables: [variable('who', 'hachi')] }]
    })
    await service.connect({
      connectionId: 'b',
      parentId: null,
      environmentId: null,
      request: request(server.url)
    })
    await until(() => status('b')?.status === 'open', 'open')
    const send = (format: 'text' | 'binary-hex' | 'binary-base64', content: string) =>
      service.send({ connectionId: 'b', parentId: null, environmentId: null, format, content })
    expect(await send('text', 'hi {{who}} {{nope}}')).toEqual({ unresolvedVariables: ['nope'] })
    await send('binary-hex', '01 02 ff')
    await send('binary-base64', 'AQL/')
    await expect(send('binary-hex', 'zz')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await until(() => entries('b').filter((e) => e.kind === 'message').length === 6, 'three echoes')
    const messages = entries('b').flatMap((e) => (e.kind === 'message' ? [e] : []))
    const view = (direction: string) =>
      messages.filter((m) => m.direction === direction).map((m) => [m.binary, m.data, m.size])
    const expected = [
      [false, 'hi hachi {{nope}}', 17],
      [true, 'AQL/', 3],
      [true, 'AQL/', 3]
    ]
    expect(view('sent')).toEqual(expected)
    expect(view('received')).toEqual(expected)
    expect(server.connections.at(-1)!.received.map((r) => r.data)).toEqual([
      'hi hachi {{nope}}',
      '0102ff',
      '0102ff'
    ])
    // Sequence numbers increase in order.
    const seqs = entries('b').map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))

    service.ping('b')
    await until(() => entries('b').some((e) => e.kind === 'event' && e.event === 'pong'), 'pong')
    const pong = entries('b').find((e) => e.kind === 'event' && e.event === 'pong')
    expect(pong).toMatchObject({ direction: 'received' })
    expect((pong as { latencyMs?: number }).latencyMs).toBeGreaterThanOrEqual(0)

    service.disconnect('b', 4001, 'bye')
    await until(() => finished.length === 1, 'finished')
    expect(server.connections.at(-1)).toMatchObject({ closeCode: 4001, closeReason: 'bye' })
    expect(status('b')).toMatchObject({ status: 'closed', closeCode: 4001, closeReason: 'bye' })
    expect(finished[0]).toMatchObject({ sent: 3, received: 3, closeCode: 4001, error: null })
    expect(finished[0]!.openedAt).not.toBeNull()
    await expect(send('text', 'late')).rejects.toMatchObject({ code: 'INVALID_OPERATION' })
  })

  it('logs messages pushed by the server and close codes chosen by the server', async () => {
    const { service, entries, status } = setup()
    await service.connect({
      connectionId: 'c',
      parentId: null,
      environmentId: null,
      request: request(server.url)
    })
    await until(() => status('c')?.status === 'open', 'open')
    server.broadcast('{"event":"tick"}')
    await until(() => entries('c').some((e) => e.kind === 'message'), 'push')
    expect(entries('c').find((e) => e.kind === 'message')).toMatchObject({
      direction: 'received',
      data: '{"event":"tick"}'
    })
    service.disconnect('c')
    await until(() => status('c')?.status === 'closed', 'closed')
  })

  it('reports invalid URLs, rejected upgrades and unreachable servers as errors', async () => {
    const { service, status, finished } = setup()
    await service.connect({
      connectionId: 'd1',
      parentId: null,
      environmentId: null,
      request: request('https://example.com')
    })
    expect(status('d1')).toMatchObject({ status: 'error' })
    expect(status('d1')?.error).toMatch(/Unsupported protocol/)

    await service.connect({
      connectionId: 'd2',
      parentId: null,
      environmentId: null,
      request: request(`${server.url}/reject`)
    })
    await until(() => status('d2')?.status === 'error', 'rejected')
    expect(status('d2')?.error).toMatch(/401/)
    expect(status('d2')?.closeCode).toBe(1006)

    await service.connect({
      connectionId: 'd3',
      parentId: null,
      environmentId: null,
      request: request('ws://127.0.0.1:1')
    })
    await until(() => status('d3')?.status === 'error', 'refused')
    expect(finished.map((f) => f.error !== null)).toEqual([true, true, true])
    expect(service.activeIds()).toEqual([])
  })

  it('can abort a connection that is still being established', async () => {
    const { service, status } = setup()
    await service.connect({
      connectionId: 'e',
      parentId: null,
      environmentId: null,
      request: request(`${server.url}/hang`)
    })
    expect(status('e')?.status).toBe('connecting')
    expect(service.disconnect('e')).toBe(true)
    await until(() => status('e')?.status === 'closed', 'aborted')
    expect(status('e')?.error).toBeUndefined()
  })

  it('times out the handshake with the connect timeout', async () => {
    const { service, status } = setup()
    await service.connect({
      connectionId: 't',
      parentId: null,
      environmentId: null,
      request: request(`${server.url}/hang`, { settings: { connectTimeoutMs: 200 } })
    })
    await until(() => status('t')?.status === 'error', 'timeout')
    expect(status('t')?.error).toMatch(/timed out/i)
  })

  it('validates TLS certificates unless turned off', async () => {
    const { service, status } = setup()
    await service.connect({
      connectionId: 's1',
      parentId: null,
      environmentId: null,
      request: request(tlsServer.url)
    })
    await until(() => status('s1')?.status === 'error', 'tls error')
    await service.connect({
      connectionId: 's2',
      parentId: null,
      environmentId: null,
      request: request(tlsServer.url, { settings: { validateSSL: false } })
    })
    await until(() => status('s2')?.status === 'open', 'tls open')
    service.disconnect('s2')
    await until(() => status('s2')?.status === 'closed', 'closed')
  })

  it('connects through the app proxy (CONNECT) with credentials, unless opted out', async () => {
    const proxySettings = proxySettingsSchema.parse({
      mode: 'custom',
      url: proxy.url,
      bypass: [],
      username: 'u',
      password: 'p w'
    })
    const { service, status } = setup({ proxy: proxySettings })
    await service.connect({
      connectionId: 'p1',
      parentId: null,
      environmentId: null,
      request: request(server.url)
    })
    await until(() => status('p1')?.status === 'open', 'open via proxy')
    const host = new URL(server.url).host
    expect(proxy.seen).toContain(`CONNECT ${host}`)
    expect(proxy.auth.at(-1)).toBe(`Basic ${Buffer.from('u:p w').toString('base64')}`)
    service.disconnect('p1')

    const before = proxy.seen.length
    await service.connect({
      connectionId: 'p2',
      parentId: null,
      environmentId: null,
      request: request(server.url, { settings: { useProxy: false } })
    })
    await until(() => status('p2')?.status === 'open', 'open direct')
    expect(proxy.seen.length).toBe(before)
    service.disconnectAll()
    await until(() => service.activeIds().length === 0, 'all closed')
  })

  it('sends heartbeats (ping frames or text messages)', async () => {
    const { service, entries, status } = setup()
    await service.connect({
      connectionId: 'h1',
      parentId: null,
      environmentId: null,
      request: request(server.url, {
        settings: { heartbeat: { enabled: true, mode: 'ping', intervalMs: 1000 } }
      })
    })
    await service.connect({
      connectionId: 'h2',
      parentId: null,
      environmentId: null,
      request: request(server.url, {
        settings: { heartbeat: { enabled: true, mode: 'text', intervalMs: 1000, payload: 'hb' } }
      })
    })
    await until(
      () =>
        entries('h1').some((e) => e.kind === 'event' && e.event === 'pong') &&
        entries('h2').some((e) => e.kind === 'message' && e.heartbeat && e.direction === 'sent'),
      'heartbeats',
      4000
    )
    expect(entries('h1').find((e) => e.kind === 'event' && e.event === 'ping')).toMatchObject({
      heartbeat: true,
      direction: 'sent'
    })
    service.disconnectAll()
    await until(
      () => status('h1')?.status === 'closed' && status('h2')?.status === 'closed',
      'closed'
    )
    expect(status('h1')?.closeCode).toBe(1001)
  })
})
