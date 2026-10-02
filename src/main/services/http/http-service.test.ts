import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { resolveInherited, type ContainerLevel } from './build-request'
import type { VariableLayer } from '@shared/variables'
import { HttpService, ResponseStore } from './http-service'
import { startHttpServer, type TestServer } from './test-servers'

let server: TestServer
beforeAll(async () => {
  server = await startHttpServer()
})
afterAll(() => server.close())

const chain: ContainerLevel[] = [
  {
    id: 'c',
    name: 'API',
    headers: [{ id: 'h', key: 'X-From', value: 'collection', enabled: true }],
    auth: { type: 'bearer', token: 'tok' }
  }
]

function service(layers: VariableLayer[] = []) {
  return new HttpService({
    getContainerChain: async () => chain,
    resolveInherited,
    getVariableLayers: async () => layers,
    getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
    getProxySettings: () => proxySettingsSchema.parse({}),
    resolveSystemProxy: async () => 'DIRECT',
    userAgent: 'Hachi/test'
  })
}

const request = (url: string, extra: object = {}) =>
  httpRequestSchema.parse({ version: 1, id: 'r', type: 'http', name: 'R', url, ...extra })

describe('HttpService', () => {
  it('sends with inherited headers / auth and keeps the body for later', async () => {
    const http = service()
    const result = await http.send({
      runId: 'a',
      parentId: 'c',
      environmentId: null,
      request: request(`${server.url}/echo`)
    })
    expect(result.kind).toBe('response')
    const echo = JSON.parse(http.getBodyText('a')) as { headers: Record<string, string> }
    expect(echo.headers['x-from']).toBe('collection')
    expect(echo.headers.authorization).toBe('Bearer tok')
    expect(http.requireStored('a').suggestedName).toBe('echo.json')
  })

  it('turns build problems into error results', async () => {
    const result = await service().send({
      runId: 'b',
      parentId: 'c',
      environmentId: null,
      request: request('ftp://x')
    })
    expect(result).toMatchObject({ kind: 'error', code: 'INVALID_URL' })
  })

  it('cancels a running request by run id', async () => {
    const http = service()
    const pending = http.send({
      runId: 'c',
      parentId: 'c',
      environmentId: null,
      request: request(`${server.url}/slow?ms=3000`)
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(http.cancel('c')).toBe(true)
    expect(await pending).toMatchObject({ kind: 'error', code: 'CANCELLED' })
    expect(http.cancel('c')).toBe(false)
  })

  it('refuses a duplicate run id while running, and unknown stored bodies', async () => {
    const http = service()
    const pending = http.send({
      runId: 'd',
      parentId: 'c',
      environmentId: null,
      request: request(`${server.url}/slow?ms=300`)
    })
    await expect(
      http.send({
        runId: 'd',
        parentId: 'c',
        environmentId: null,
        request: request(`${server.url}/json`)
      })
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' })
    await pending
    expect(() => http.getBodyText('missing')).toThrow(/no longer available/)
  })
})

describe('HttpService variables', () => {
  const variable = (key: string, value: string, secret = false) => ({
    id: key,
    key,
    value,
    enabled: true,
    secret
  })

  it('resolves {{variables}} in the request and inherited settings before sending', async () => {
    const http = new HttpService({
      getContainerChain: async () => [
        {
          ...chain[0]!,
          headers: [{ id: 'h', key: 'X-From', value: '{{team}}', enabled: true }],
          auth: { type: 'bearer', token: '{{token}}' }
        }
      ],
      resolveInherited,
      getVariableLayers: async () => [
        { source: 'environment', sourceName: 'dev', variables: [variable('token', 's3', true)] },
        {
          source: 'collection',
          sourceName: 'API',
          variables: [variable('base', server.url), variable('team', 'core')]
        }
      ],
      getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
      getProxySettings: () => proxySettingsSchema.parse({}),
      resolveSystemProxy: async () => 'DIRECT',
      userAgent: 'Hachi/test'
    })
    const result = await http.send({
      runId: 'v1',
      parentId: 'c',
      environmentId: 'e',
      request: request('{{base}}/echo?id={{$randomInt}}', {
        headers: [{ id: 'x', key: 'X-Missing', value: '{{nope}}', enabled: true }]
      })
    })
    expect(result).toMatchObject({ kind: 'response', unresolvedVariables: ['nope'] })
    const echo = JSON.parse(http.getBodyText('v1')) as {
      url: string
      headers: Record<string, string>
    }
    expect(echo.headers['x-from']).toBe('core')
    expect(echo.headers.authorization).toBe('Bearer s3')
    expect(echo.headers['x-missing']).toBe('{{nope}}')
    expect(echo.url).toMatch(/^\/echo\?id=\d+$/)
  })

  it('reports unresolved variables on build errors too', async () => {
    const result = await service().send({
      runId: 'v2',
      parentId: null,
      environmentId: null,
      request: request('{{host}}/x')
    })
    expect(result).toMatchObject({ kind: 'error', unresolvedVariables: ['host'] })
  })
})

describe('ResponseStore', () => {
  const entry = (size: number) => ({ body: Buffer.alloc(size), contentType: '', url: 'http://x' })

  it('evicts the oldest entries beyond the count or size limit, keeping the newest', () => {
    const store = new ResponseStore(2, 100)
    store.put('1', entry(10))
    store.put('2', entry(10))
    store.put('3', entry(10))
    expect([store.get('1'), store.get('2'), store.get('3')].map(Boolean)).toEqual([
      false,
      true,
      true
    ])
    store.put('big', entry(500))
    expect(store.get('big')).toBeTruthy()
    expect(store.get('3')).toBeUndefined()
  })
})
