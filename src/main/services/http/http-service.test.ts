import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { resolveInherited, type ContainerLevel } from './build-request'
import type { VariableLayer } from '@shared/variables'
import { CookieJar } from './cookie-jar'
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
    kind: 'collection',
    scripts: { preRequest: '', postResponse: '' },
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

describe('HttpService.resolveForCode', () => {
  const layers: VariableLayer[] = [
    {
      source: 'environment',
      sourceName: 'Dev',
      variables: [
        { id: '1', key: 'host', value: 'api.test', enabled: true, secret: false },
        { id: '2', key: 'pass', value: 'hunter2', enabled: true, secret: true }
      ]
    }
  ]
  const input = (revealSecrets: boolean) => ({
    parentId: 'c',
    environmentId: 'dev',
    revealSecrets,
    request: request('https://{{host}}/users', {
      method: 'POST',
      params: [{ id: 'p', key: 'q', value: '{{missing}}', enabled: true }],
      headers: [{ id: 'h', key: 'X-Pass', value: '{{pass}}', enabled: true }],
      auth: { type: 'basic', username: 'me', password: '{{pass}}' },
      body: { mode: 'json', json: '{"a":1}' }
    })
  })

  it('resolves like sending, keeps secrets as {{name}} and leaves out default headers', async () => {
    const {
      request: r,
      unresolvedVariables,
      urlError
    } = await service(layers).resolveForCode(input(false))
    expect(urlError).toBeNull()
    expect(r.url).toBe('https://api.test/users?q=%7B%7Bmissing%7D%7D')
    expect(r.headers).toEqual([
      ['X-Pass', '{{pass}}'],
      ['X-From', 'collection'],
      ['Content-Type', 'application/json']
    ])
    expect(r.basicAuth).toEqual({ username: 'me', password: '{{pass}}' })
    expect(r.body).toEqual({ kind: 'text', text: '{"a":1}', json: true })
    expect(unresolvedVariables).toEqual(['missing'])
  })

  it('reveals secrets on request, and reports an invalid URL instead of failing', async () => {
    const revealed = await service(layers).resolveForCode(input(true))
    expect(revealed.request.basicAuth?.password).toBe('hunter2')
    const bad = await service().resolveForCode({
      ...input(false),
      request: request('ftp://x')
    })
    expect(bad.urlError).toMatch(/Unsupported protocol/)
    expect(bad.request.url).toBe('ftp://x')
    // The collection's Bearer auth is inherited (no Basic here).
    expect(bad.request.headers).toContainEqual(['Authorization', 'Bearer tok'])
  })
})

describe('HttpService auth (decision 128)', () => {
  const send = (http: HttpService, url: string, auth: object, extra: object = {}) =>
    http.send({
      runId: crypto.randomUUID(),
      parentId: 'c',
      environmentId: null,
      request: request(url, { auth, ...extra })
    })
  const echoOf = (r: Awaited<ReturnType<HttpService['send']>>) => {
    if (r.kind !== 'response' || r.body.kind !== 'text') throw new Error(JSON.stringify(r))
    return JSON.parse(r.body.text) as { headers: Record<string, string>; uri?: string }
  }

  it('answers a Digest challenge', async () => {
    const ok = await send(service(), `${server.url}/digest?x=1`, {
      type: 'digest',
      username: 'user',
      password: 'pass'
    })
    expect(ok).toMatchObject({ kind: 'response', status: 200 })
    expect(echoOf(ok).uri).toBe('/digest?x=1')
    const wrong = await send(service(), `${server.url}/digest`, {
      type: 'digest',
      username: 'user',
      password: 'nope'
    })
    expect(wrong).toMatchObject({ kind: 'response', status: 401 })
  })

  it('gets an OAuth 2.0 client credentials token and sends it as a bearer', async () => {
    const http = service()
    const auth = {
      type: 'oauth2',
      accessTokenUrl: `${server.url}/oauth/token`,
      clientId: 'cid',
      clientSecret: 'secret'
    }
    const first = echoOf(await send(http, `${server.url}/echo`, auth)).headers.authorization
    expect(first).toMatch(/^Bearer tok-\d+-client_credentials$/)
    // Kept in memory: the next request reuses it.
    expect(echoOf(await send(http, `${server.url}/echo`, auth)).headers.authorization).toBe(first)
    // An explicit Authorization header wins.
    const explicit = await send(http, `${server.url}/echo`, auth, {
      headers: [{ id: 'h', key: 'Authorization', value: 'Mine', enabled: true }]
    })
    expect(echoOf(explicit).headers.authorization).toBe('Mine')

    const failed = await send(http, `${server.url}/echo`, { ...auth, clientSecret: 'bad' })
    expect(failed).toMatchObject({ kind: 'error', code: 'AUTH' })
    expect(failed.kind === 'error' && failed.message).toContain('invalid_client')
  })

  it('signs with AWS Signature V4', async () => {
    const auth = {
      type: 'awsSigV4',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      service: 'execute-api'
    }
    const headers = echoOf(await send(service(), `${server.url}/echo`, auth)).headers
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-east-1\/execute-api\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/
    )
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    const missing = await send(service(), `${server.url}/echo`, { ...auth, region: '' })
    expect(missing).toMatchObject({ kind: 'error', code: 'AUTH' })
  })

  it('notes auth that generated code cannot carry', async () => {
    const resolved = await service().resolveForCode({
      parentId: 'c',
      environmentId: null,
      request: request(`${server.url}/echo`, { auth: { type: 'digest' } }),
      revealSecrets: false
    })
    expect(resolved.authNote).toContain('Digest')
  })
})

describe('HttpService cookie jar (decision 129)', () => {
  const jarService = (jar: CookieJar) =>
    new HttpService({
      getContainerChain: async () => [],
      resolveInherited,
      getVariableLayers: async () => [],
      getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
      getProxySettings: () => proxySettingsSchema.parse({}),
      resolveSystemProxy: async () => 'DIRECT',
      userAgent: 'Hachi/test',
      cookieJar: () => jar
    })
  const headersOf = (r: Awaited<ReturnType<HttpService['send']>>) => {
    if (r.kind !== 'response' || r.body.kind !== 'text') throw new Error(JSON.stringify(r))
    return (JSON.parse(r.body.text) as { headers: Record<string, string> }).headers
  }
  const send = (http: HttpService, path: string, extra: object = {}) =>
    http.send({
      runId: crypto.randomUUID(),
      parentId: null,
      environmentId: null,
      request: request(`${server.url}${path}`, extra)
    })

  it('keeps cookies set on a redirect and sends them on the next hop', async () => {
    const jar = new CookieJar()
    const http = jarService(jar)
    const result = await send(http, '/login')
    expect(result).toMatchObject({ kind: 'response', status: 200, redirects: 1 })
    expect(headersOf(result).cookie).toBe('sid=xyz')
    expect(jar.list().map((c) => c.name)).toEqual(['sid'])
    // Typed Cookie headers win by name; the jar adds the rest.
    const typed = await send(http, '/echo', {
      headers: [{ id: 'h', key: 'Cookie', value: 'mine=1', enabled: true }]
    })
    expect(headersOf(typed).cookie).toBe('mine=1; sid=xyz')
    // Turned off for one request.
    const off = await send(http, '/echo', { settings: { useCookieJar: false } })
    expect(headersOf(off).cookie).toBeUndefined()
  })

  it('still follows / limits redirects when following them itself', async () => {
    const http = jarService(new CookieJar())
    expect(await send(http, '/redirect?n=2')).toMatchObject({ status: 200, redirects: 2 })
    expect(await send(http, '/redirect?n=5')).toMatchObject({ code: 'TOO_MANY_REDIRECTS' })
    const kept = await send(http, '/redirect?n=1', { settings: { followRedirects: false } })
    expect(kept).toMatchObject({ status: 302, redirects: 0 })
  })
})
