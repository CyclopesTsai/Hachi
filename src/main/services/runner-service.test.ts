import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import type { Variable } from '@shared/schemas/collection'
import { httpRequestSchema, type HttpRequest } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import type { RunnerConfig, RunnerEvent } from '@shared/runner'
import type { WorkspaceTree } from '@shared/tree'
import { applyVariableChanges, type VariableLayer } from '@shared/variables'
import { resolveInherited } from './http/build-request'
import { RequestExecutor } from './http/executor'
import { HttpService } from './http/http-service'
import { startHttpServer, type TestServer } from './http/test-servers'
import { RunnerService } from './runner-service'
import { RuntimeVariables } from './runtime-variables'
import { runScript } from './scripts/engine'

let server: TestServer
beforeAll(async () => {
  server = await startHttpServer()
})
afterAll(() => server.close())

const WS = '/ws'
let env: Variable[]
let runtime: RuntimeVariables
let events: RunnerEvent[]
let requests: Record<string, HttpRequest>

const tree: WorkspaceTree = {
  workspaceId: 'w',
  collections: [
    {
      kind: 'collection',
      id: 'col',
      name: 'API',
      relPath: 'collections/api',
      children: [
        { kind: 'request', id: 'login', name: 'Login', relPath: '', requestType: 'http' },
        {
          kind: 'folder',
          id: 'f',
          name: 'Users',
          relPath: '',
          children: [
            { kind: 'request', id: 'list', name: 'List', relPath: '', requestType: 'http' },
            { kind: 'request', id: 'live', name: 'Live', relPath: '', requestType: 'websocket' }
          ]
        }
      ]
    }
  ]
}

const req = (id: string, extra: object) =>
  httpRequestSchema.parse({ version: 1, id, type: 'http', name: id, ...extra })

function service() {
  const layers = async (): Promise<VariableLayer[]> =>
    [
      runtime.layer(WS),
      { source: 'environment' as const, sourceName: 'dev', variables: env }
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
  const getEnvironment = async (id: string | null) => (id ? { name: 'dev', variables: env } : null)
  const executor = new RequestExecutor({
    http,
    runtime,
    runScript,
    workspacePath: () => WS,
    isTrusted: () => true,
    getEnvironment,
    getCollection: async () => null,
    getVariableLayers: layers,
    applyEnvironmentChanges: async (_id, changes) => {
      env = applyVariableChanges(env, changes)
    },
    applyCollectionChanges: async () => undefined,
    variablesChanged: () => undefined
  })
  return new RunnerService({
    executor,
    cancelHttp: (id) => http.cancel(id),
    getTree: async () => tree,
    getRequest: async (id) => requests[id] ?? null,
    runtimeValues: () => runtime.values(WS),
    getEnvironment,
    getCollection: async () => null,
    scriptsTrusted: () => true,
    emit: (e) => events.push(e),
    progressIntervalMs: 20
  })
}

const config = (over: Partial<RunnerConfig> = {}): RunnerConfig => ({
  targetId: 'col',
  itemIds: ['login', 'list', 'live'],
  environmentId: 'env',
  iterations: 1,
  concurrency: 1,
  delayMs: 0,
  stopOnFailure: false,
  keepBodies: false,
  data: null,
  skipScripts: false,
  ...over
})

beforeEach(() => {
  env = [{ id: 'h', key: 'host', value: server.url, enabled: true, secret: false }]
  runtime = new RuntimeVariables()
  events = []
  requests = {
    login: req('login', {
      method: 'POST',
      url: '{{host}}/echo?user={{user}}',
      scripts: { postResponse: "hachi.environment.set('seen', hachi.response.json().url)" },
      extractions: [{ id: 'e', source: 'jsonBody', path: 'url', variable: 'lastUrl' }]
    }),
    list: req('list', {
      url: '{{host}}/echo?last={{lastUrl}}',
      assertions: [{ id: 'a', target: 'status', operator: 'eq', expected: '200' }]
    })
  }
})

async function run(svc: RunnerService, c: RunnerConfig) {
  const runId = crypto.randomUUID()
  const started = await svc.start(runId, c)
  await svc.wait(runId)
  return { runId, started, progress: svc.progress(runId) }
}

describe('RunnerService', () => {
  it('runs the checked HTTP requests in tree order and skips WebSocket items', async () => {
    const svc = service()
    const { runId, started, progress } = await run(svc, config({ iterations: 2 }))
    expect(started.items.map((i) => [i.id, i.path])).toEqual([
      ['login', 'API / Login'],
      ['list', 'API / Users / List']
    ])
    expect(started.skipped).toEqual(['API / Users / Live'])
    expect(progress).toMatchObject({
      status: 'done',
      totalRounds: 2,
      completedRounds: 2,
      completedRequests: 4,
      totalRequests: 4
    })
    const { rows } = svc.rows(runId, { offset: 0, limit: 10, failedOnly: false })
    expect(rows.map((r) => [r.round, r.name, r.status, r.testsPassed, r.testsTotal])).toEqual([
      [0, 'Login', 200, 0, 0],
      [0, 'List', 200, 1, 1],
      [1, 'Login', 200, 0, 0],
      [1, 'List', 200, 1, 1]
    ])
    // Concurrency 1 behaves like sending from the editor: shared variables, files written.
    expect(rows[1]?.url).toContain('last=/echo')
    expect(runtime.values(WS).lastUrl).toBeDefined()
    expect(env.some((v) => v.key === 'seen')).toBe(true)
    expect(progress.stats.total).toMatchObject({ count: 4, failed: 0 })
    expect(events.at(-1)?.progress.status).toBe('done')
  })

  it('runs iterations × concurrency rounds; workers keep their variables to themselves', async () => {
    const svc = service()
    const { runId, progress } = await run(
      svc,
      config({
        concurrency: 3,
        iterations: 2,
        itemIds: ['login'],
        data: { fileName: 'users.csv', rows: [{ user: 'a' }, { user: 'b' }] }
      })
    )
    expect(progress).toMatchObject({ status: 'done', totalRounds: 6, completedRequests: 6 })
    const { rows } = svc.rows(runId, { offset: 0, limit: 100, failedOnly: false })
    // Data rows cycle by round number (decision 89).
    for (const row of rows) expect(row.url).toContain(`user=${row.round % 2 === 0 ? 'a' : 'b'}`)
    expect(new Set(rows.map((r) => r.worker))).toEqual(new Set([0, 1, 2]))
    // Decision 76 / 91: nothing leaks out of the workers.
    expect(env.some((v) => v.key === 'seen')).toBe(false)
    expect(runtime.values(WS)).toEqual({})
    const detail = svc.row(runId, 0)
    expect(detail?.data).toEqual({ user: rows[0]?.round === 0 ? 'a' : 'b' })
    expect(detail?.bodyNote).toBe('沒有保留回應內容')
  })

  it('stops on the first failure', async () => {
    requests.list = req('list', {
      url: '{{host}}/echo',
      assertions: [{ id: 'a', target: 'status', operator: 'eq', expected: '404' }]
    })
    const svc = service()
    const { runId, progress } = await run(svc, config({ iterations: 5, stopOnFailure: true }))
    expect(progress.status).toBe('stopped')
    expect(progress.message).toBe('「List」失敗（第 1 輪），已停止')
    expect(svc.rows(runId, { offset: 0, limit: 10, failedOnly: true }).total).toBe(1)
    expect(progress.completedRequests).toBe(2)
  })

  it('can be cancelled while requests are running', async () => {
    requests.login = req('login', { url: '{{host}}/slow?ms=5000' })
    const svc = service()
    const runId = crypto.randomUUID()
    await svc.start(runId, config({ itemIds: ['login'], iterations: 3, concurrency: 2 }))
    await new Promise((r) => setTimeout(r, 100))
    expect(svc.cancel(runId)).toBe(true)
    await svc.wait(runId)
    expect(svc.progress(runId)).toMatchObject({ status: 'cancelled', completedRequests: 0 })
  })

  it('keeps bodies when asked and exports JSON', async () => {
    const svc = service()
    const { runId } = await run(svc, config({ keepBodies: true, itemIds: ['list'] }))
    const detail = svc.row(runId, 0)
    expect(JSON.parse(detail?.body ?? '{}')).toMatchObject({ method: 'GET' })
    expect(detail?.requestHeaders.some(([k]) => k === 'User-Agent')).toBe(true)
    const exported = svc.exportJson(runId)
    expect(exported.fileName).toMatch(/^runner-.*\.json$/)
    const json = JSON.parse(exported.content) as {
      target: string
      rows: { body: string }[]
      stats: unknown
    }
    expect(json.target).toBe('API')
    expect(json.rows[0]?.body).toContain('"method":"GET"')
    svc.discard(runId)
    expect(() => svc.progress(runId)).toThrow(/不在記憶體/)
  })

  it('rejects a target without HTTP requests', async () => {
    await expect(service().start('x', config({ itemIds: ['live'] }))).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
  })
})
