import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import type { Variable } from '@shared/schemas/collection'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import type { HttpResult } from '@shared/http'
import type { ScriptReport } from '@shared/scripts'
import { applyVariableChanges, type VariableLayer } from '@shared/variables'
import { RuntimeVariables } from '../runtime-variables'
import { runScript } from '../scripts/engine'
import { resolveInherited } from './build-request'
import { RequestExecutor, applyScriptRequest } from './executor'
import { HttpService } from './http-service'
import { startHttpServer, type TestServer } from './test-servers'

let server: TestServer
beforeAll(async () => {
  server = await startHttpServer()
})
afterAll(() => server.close())

const WS = '/workspace'
const v = (key: string, value: string, secret = false): Variable => ({
  id: key,
  key,
  value,
  enabled: true,
  secret
})

let env: Variable[]
let col: Variable[]
let runtime: RuntimeVariables
let trusted: boolean
let notified: unknown[]

function executor() {
  const layers = async (): Promise<VariableLayer[]> =>
    [
      runtime.layer(WS),
      { source: 'environment' as const, sourceName: 'dev', variables: env },
      { source: 'collection' as const, sourceName: 'API', variables: col }
    ].filter((l) => l !== null)
  const http = new HttpService({
    getContainerChain: async () => [],
    resolveInherited,
    getVariableLayers: layers,
    getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
    getProxySettings: () => proxySettingsSchema.parse({}),
    resolveSystemProxy: async () => 'DIRECT',
    userAgent: 'Hachi/test'
  })
  return new RequestExecutor({
    http,
    runtime,
    runScript,
    workspacePath: () => WS,
    isTrusted: () => trusted,
    getEnvironment: async (id) => (id ? { name: 'dev', variables: env } : null),
    getCollection: async () => ({ id: 'col', name: 'API', variables: col }),
    getVariableLayers: layers,
    applyEnvironmentChanges: async (_id, changes) => {
      env = applyVariableChanges(env, changes)
    },
    applyCollectionChanges: async (_id, changes) => {
      col = applyVariableChanges(col, changes)
    },
    variablesChanged: (change) => notified.push(change)
  })
}

beforeEach(() => {
  env = [v('host', ''), v('secret', 'k3y', true)]
  col = [v('base', '')]
  runtime = new RuntimeVariables()
  trusted = true
  notified = []
  env[0] = v('host', server.url)
})

const request = (extra: object) =>
  httpRequestSchema.parse({
    version: 1,
    id: 'r',
    type: 'http',
    name: 'Echo',
    url: '{{host}}/echo',
    ...extra
  })

const send = (extra: object, options: { skipScripts?: boolean } = {}) =>
  executor().execute({
    runId: crypto.randomUUID(),
    parentId: 'col',
    environmentId: 'env',
    request: request(extra),
    ...options
  })

const report = (r: HttpResult) => r.scriptReport as ScriptReport
const echo = (r: HttpResult) => {
  if (r.kind !== 'response' || r.body.kind !== 'text')
    throw new Error(`no body: ${JSON.stringify(r)}`)
  return JSON.parse(r.body.text) as {
    url: string
    headers: Record<string, string>
    body: string
    method: string
  }
}

describe('RequestExecutor', () => {
  it('sends plainly (no report) when there is nothing to run', async () => {
    const result = await send({})
    expect(result.kind).toBe('response')
    expect(result.scriptReport).toBeUndefined()
  })

  it('runs the whole pipeline: pre-request → send → extract → post-response → assertions', async () => {
    const result = await send({
      method: 'POST',
      body: { mode: 'json', json: '{"n":1}' },
      scripts: {
        preRequest: `
          const sig = CryptoJS.HmacSHA256(hachi.request.body, hachi.variables.get('secret')).toString()
          hachi.request.headers.set('X-Sig', sig)
          hachi.request.url = hachi.request.url + '?run={{runNo}}'
          hachi.variables.set('runNo', 7)
          console.log('signed')
        `,
        postResponse: `
          const echo = hachi.response.json()
          hachi.test('extracted first', () => hachi.expect(hachi.variables.get('method')).toBe('POST'))
          hachi.environment.set('lastUrl', echo.url)
          hachi.collectionVariables.set('seen', 'yes')
        `
      },
      extractions: [
        { id: 'x1', source: 'jsonBody', path: 'method', variable: 'method' },
        {
          id: 'x2',
          source: 'jsonBody',
          path: 'headers["x-sig"]',
          variable: 'sig',
          scope: 'environment'
        }
      ],
      assertions: [
        { id: 'a1', target: 'status', operator: 'eq', expected: '200' },
        { id: 'a2', target: 'jsonBody', path: 'url', operator: 'eq', expected: '{{lastUrl}}' },
        { id: 'a3', target: 'jsonBody', path: 'method', operator: 'eq', expected: 'GET' }
      ]
    })
    const body = echo(result)
    // Variables set by the Pre-request script are resolved in the request it changed.
    expect(body.url).toBe('/echo?run=7')
    expect(body.headers['x-sig']).toMatch(/^[0-9a-f]{64}$/)
    const r = report(result)
    expect(r.preRequest?.logs.map((l) => l.text)).toEqual(['signed'])
    expect(r.postResponse?.tests).toEqual([{ name: 'extracted first', passed: true }])
    expect(r.assertions.map((a) => a.passed)).toEqual([true, true, false])
    expect(r.changes.map((c) => [c.by, c.scope, c.name])).toEqual([
      ['preRequest', 'runtime', 'runNo'],
      ['extraction', 'runtime', 'method'],
      ['extraction', 'environment', 'sig'],
      ['postResponse', 'environment', 'lastUrl'],
      ['postResponse', 'collection', 'seen']
    ])
    expect(runtime.values(WS)).toEqual({ runNo: '7', method: 'POST' })
    expect(env.find((x) => x.key === 'lastUrl')?.value).toBe('/echo?run=7')
    expect(env.find((x) => x.key === 'sig')?.value).toBe(body.headers['x-sig'])
    expect(col.find((x) => x.key === 'seen')?.value).toBe('yes')
    expect(notified).toContainEqual({ environmentId: 'env', collectionId: null })
    expect(notified).toContainEqual({ environmentId: null, collectionId: 'col' })
  })

  it('does not send when the Pre-request script fails, but keeps its logs and changes', async () => {
    const result = await send({
      scripts: {
        preRequest: 'console.log("x"); hachi.variables.set("a", 1); throw new Error("nope")'
      }
    })
    expect(result).toMatchObject({ kind: 'error', code: 'SCRIPT' })
    expect(result.kind === 'error' && result.message).toBe('Pre-request 腳本錯誤：nope（第 1 行）')
    expect(report(result).preRequest?.logs[0]?.text).toBe('x')
    expect(runtime.values(WS)).toEqual({ a: '1' })
  })

  it('refuses untrusted scripts unless they are skipped (decision 84)', async () => {
    trusted = false
    const scripts = { preRequest: 'hachi.variables.set("ran", 1)', postResponse: '' }
    const refused = await send({ scripts })
    expect(refused).toMatchObject({ kind: 'error', code: 'SCRIPT' })
    const skipped = await send(
      { scripts, assertions: [{ id: 'a', target: 'status', operator: 'eq', expected: '200' }] },
      { skipScripts: true }
    )
    expect(skipped.kind).toBe('response')
    expect(report(skipped)).toMatchObject({ scriptsSkipped: true, preRequest: null })
    expect(report(skipped).assertions[0]?.passed).toBe(true)
    expect(runtime.values(WS)).toEqual({})
  })

  it('reports a Post-response error without hiding the response', async () => {
    const result = await send({ scripts: { postResponse: 'hachi.response.json().x.y' } })
    expect(result.kind).toBe('response')
    expect(report(result).postResponse?.error).toMatch(/TypeError/)
  })

  it('reports environment extractions without an active environment', async () => {
    const result = await executor().execute({
      runId: 'x',
      parentId: 'col',
      environmentId: null,
      request: request({
        url: `${server.url}/json`,
        extractions: [{ id: 'e', source: 'status', variable: 's', scope: 'environment' }]
      })
    })
    expect(report(result).changeErrors).toEqual(['目前沒有選擇環境，擷取的值沒有存到環境'])
  })
})

describe('applyScriptRequest', () => {
  it('keeps disabled headers and row ids that did not move', () => {
    const base = request({
      method: 'POST',
      headers: [
        { id: 'h1', key: 'A', value: '1', enabled: true, description: 'kept' },
        { id: 'h2', key: 'Off', value: '0', enabled: false }
      ],
      body: { mode: 'raw', raw: 'old' }
    })
    const next = applyScriptRequest(base, {
      method: 'patch',
      url: 'x',
      headers: [
        ['A', '2'],
        ['B', '3']
      ],
      body: 'new'
    })
    expect(next.method).toBe('PATCH')
    expect(next.headers.map((h) => [h.id === 'h1', h.key, h.value, h.enabled])).toEqual([
      [true, 'A', '2', true],
      [false, 'B', '3', true],
      [false, 'Off', '0', false]
    ])
    expect(next.headers[0]?.description).toBe('kept')
    expect(next.body.raw).toBe('new')
    expect(
      applyScriptRequest(base, { method: 'BREW', url: 'x', headers: [], body: null }).method
    ).toBe('POST')
  })
})
