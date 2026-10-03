import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ScriptRunInput } from '@shared/scripts'
import { runScript, sanitizeOutput } from './engine'

function input(code: string, over: Partial<ScriptRunInput> = {}): ScriptRunInput {
  return {
    phase: 'preRequest',
    code,
    variables: {
      runtime: { r: 'run' },
      environment: { host: 'api.test', shared: 'from-env', token: 's3cret' },
      collection: { shared: 'from-collection', base: 'https://{{host}}' }
    },
    iterationData: null,
    info: {
      requestName: 'Get users',
      environmentName: 'dev',
      collectionName: 'API',
      iteration: 0,
      iterationCount: 1
    },
    request: {
      method: 'GET',
      url: '{{base}}/users',
      headers: [['Accept', 'application/json']],
      body: '{"a":1}'
    },
    response: null,
    timeoutMs: 1000,
    ...over
  }
}

const post = (code: string, over: Partial<ScriptRunInput> = {}) =>
  input(code, {
    phase: 'postResponse',
    response: {
      status: 201,
      statusText: 'Created',
      headers: [
        ['content-type', 'application/json'],
        ['x-id', '7']
      ],
      timeMs: 42,
      sizeBytes: 30,
      body: '{"id":7,"items":[{"name":"a"},{"name":"b"}],"ok":true}',
      bodyUnavailable: null
    },
    ...over
  })

describe('runScript: variables', () => {
  it('reads with runtime > environment > collection precedence and records changes', async () => {
    const out = await runScript(
      input(`
        console.log(hachi.variables.get('shared'), hachi.variables.get('r'), hachi.variables.get('nope'))
        hachi.variables.set('token2', { a: 1 })
        hachi.environment.set('count', 3)
        hachi.collectionVariables.unset('shared')
        hachi.environment.unset('missing')
        console.log(hachi.variables.replaceIn('{{base}}/x'), hachi.environment.name)
      `)
    )
    expect(out.error).toBeNull()
    expect(out.logs.map((l) => l.text)).toEqual([
      'from-env run undefined',
      'https://api.test/x dev'
    ])
    expect(out.changes).toEqual([
      { scope: 'runtime', name: 'token2', value: '{"a":1}' },
      { scope: 'environment', name: 'count', value: '3' },
      { scope: 'collection', name: 'shared', value: null }
    ])
  })

  it('reports setting a scope that does not exist, keeping earlier changes', async () => {
    const out = await runScript(
      input(`hachi.variables.set('a', '1')\nhachi.environment.set('b', 2)`, {
        variables: { runtime: {}, environment: null, collection: null }
      })
    )
    expect(out.error).toBe('目前沒有選擇環境，無法設定環境變數（第 2 行）')
    expect(out.changes).toEqual([{ scope: 'runtime', name: 'a', value: '1' }])
  })
})

describe('runScript: iteration data (Collection Runner)', () => {
  it('reads the data row between runtime and environment', async () => {
    const out = await runScript(
      input(
        `console.log(pm.iterationData.get('user'), hachi.variables.get('host'), hachi.variables.get('r'), hachi.iterationData.has('nope'), pm.info.iteration, pm.info.iterationCount)`,
        {
          iterationData: { user: 'alice', host: 'data.test', r: 'data-r' },
          info: {
            requestName: 'x',
            environmentName: null,
            collectionName: null,
            iteration: 3,
            iterationCount: 10
          }
        }
      )
    )
    expect(out.logs[0]?.text).toBe('alice data.test run false 3 10')
  })
})

describe('runScript: request (pre-request)', () => {
  it('returns the modified request', async () => {
    const out = await runScript(
      input(`
        hachi.request.headers.set('X-Sig', 'abc')
        hachi.request.headers.remove('accept')
        hachi.request.url = hachi.request.url + '?page=2'
        pm.request.headers.add({ key: 'X-Two', value: 2 })
        hachi.request.body = JSON.stringify({ b: 2 })
        pm.request.method = 'post'
      `)
    )
    expect(out.error).toBeNull()
    expect(out.request).toEqual({
      method: 'POST',
      url: '{{base}}/users?page=2',
      headers: [
        ['X-Sig', 'abc'],
        ['X-Two', '2']
      ],
      body: '{"b":2}'
    })
  })

  it('returns no request when the script did not touch it', async () => {
    expect((await runScript(input('hachi.request.headers.get("Accept")'))).request).toBeNull()
  })

  it('does not allow changing the request after the response', async () => {
    const out = await runScript(post('hachi.request.url = "x"'))
    expect(out.error).toMatch(/Post-response 腳本不能修改請求/)
  })
})

describe('runScript: response, tests and expectations', () => {
  it('exposes the response to hachi.* and pm.*', async () => {
    const out = await runScript(
      post(`
        const body = hachi.response.json()
        hachi.test('status', () => hachi.expect(hachi.response.status).toBe(201))
        hachi.test('id header', () => hachi.expect(hachi.response.headers.get('X-ID')).toBe('7'))
        hachi.test('items', () => {
          hachi.expect(body.items).toHaveLength(2)
          hachi.expect(body).toHaveProperty('items[1].name', 'b')
          hachi.expect(body.items).toContainEqual({ name: 'a' })
          hachi.expect(body.ok).not.toBe(false)
        })
        hachi.test('fails', () => hachi.expect(body.id).toBeGreaterThan(10))
        pm.test('pm status', () => pm.response.to.have.status(201))
        pm.test('pm ok', () => { pm.response.to.be.success })
        pm.test('chai', () => {
          pm.expect(pm.response.json().items).to.be.an('array').that.has.lengthOf(2)
          pm.expect(pm.response.json()).to.have.property('id', 7)
          pm.expect(pm.response.json()).to.deep.include({ ok: true })
          pm.expect(pm.response.responseTime).to.be.below(1000)
          pm.expect('hello').to.not.equal('world')
          pm.expect(pm.response.json()).to.have.nested.property('items[0].name').that.equals('a')
          pm.expect(pm.response).to.have.header('content-type')
          pm.expect([1, 2]).to.have.members([2, 1])
          pm.expect(null).to.be.null
        })
        pm.test('chai fail', () => pm.expect(pm.response.code).to.equal(200))
        pm.environment.set('id', pm.response.json().id)
        tests['legacy'] = responseCode.code === 201
      `)
    )
    expect(out.error).toBeNull()
    expect(out.tests).toEqual([
      { name: 'status', passed: true },
      { name: 'id header', passed: true },
      { name: 'items', passed: true },
      { name: 'fails', passed: false, error: 'expected 7 to be greater than 10' },
      { name: 'pm status', passed: true },
      { name: 'pm ok', passed: true },
      { name: 'chai', passed: true },
      { name: 'chai fail', passed: false, error: 'expected 201 to equal 200' },
      { name: 'legacy', passed: true }
    ])
    expect(out.changes).toEqual([{ scope: 'environment', name: 'id', value: '7' }])
  })

  it('explains an unreadable body', async () => {
    const out = await runScript(
      post('hachi.response.text()', {
        response: {
          status: 200,
          statusText: 'OK',
          headers: [],
          timeMs: 1,
          sizeBytes: 1,
          body: null,
          bodyUnavailable: '回應太大'
        }
      })
    )
    expect(out.error).toBe('回應太大（第 1 行）')
  })
})

describe('runScript: sandbox', () => {
  it('has no Node, network or timers', async () => {
    const out = await runScript(
      input(
        'console.log([typeof process, typeof fetch, typeof setTimeout, typeof XMLHttpRequest, typeof __hachiInput].join())'
      )
    )
    expect(out.logs[0]?.text).toBe('undefined,undefined,undefined,undefined,undefined')
    expect((await runScript(input('require("fs")'))).error).toMatch(/不支援 require\('fs'\)/)
    expect((await runScript(input('pm.sendRequest("x")'))).error).toMatch(/pm\.sendRequest/)
  })

  it('stops endless loops and memory hogs', async () => {
    const loop = await runScript(
      input('console.log("before"); while (true) {}', { timeoutMs: 200 })
    )
    expect(loop.error).toBe('腳本執行超過 0.2 秒，已中止')
    expect(loop.logs[0]?.text).toBe('before')
    const memory = await runScript(input('const a = []; for (;;) a.push(new Array(1e6).fill(1))'))
    expect(memory.error).toMatch(/記憶體超過上限|已中止/)
    const deep = await runScript(input('function f(n) { return f(n + 1) + 1 } f(0)'))
    expect(deep.error).toMatch(/堆疊溢位|已中止/)
    // Ordinary recursion still works, and the engine recovers after the failures above.
    const ok = await runScript(
      input('function f(n) { return n === 0 ? 0 : f(n - 1) + 1 } console.log(f(500))')
    )
    expect(ok.error).toBeNull()
    expect(ok.logs[0]?.text).toBe('500')
  })

  it('reports syntax errors with the line', async () => {
    expect((await runScript(input('const a = 1\nconst = 2'))).error).toMatch(/SyntaxError.*第 2 行/)
  })

  it('cannot forge the result through __hachiFinish', async () => {
    const out = await runScript(input('globalThis.__hachiFinish = () => "{}"; console.log("x")'))
    expect(out.logs.map((l) => l.text)).toEqual(['x'])
  })

  it('provides CryptoJS (also via require) and btoa / atob', async () => {
    const out = await runScript(
      input(`
        const C = require('crypto-js')
        console.log(CryptoJS.HmacSHA256('msg', 'key').toString(), C.MD5('a').toString())
        console.log(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse('héllo')))
        console.log(btoa('hello'), atob('aGVsbG8='))
      `)
    )
    expect(out.error).toBeNull()
    expect(out.logs.map((l) => l.text)).toEqual([
      `${createHmac('sha256', 'key').update('msg').digest('hex')} 0cc175b9c0f1b6a831c399e269772661`,
      Buffer.from('héllo').toString('base64'),
      'aGVsbG8= hello'
    ])
  })

  it('limits console output', async () => {
    const out = await runScript(input('for (let i = 0; i < 5000; i++) console.log(i)'))
    expect(out.logs).toHaveLength(1001)
    expect(out.logs.at(-1)?.level).toBe('warn')
  })
})

describe('sanitizeOutput', () => {
  it('drops malformed entries', () => {
    expect(
      sanitizeOutput({
        logs: [{ level: 'boom', text: 'x' }, { text: 1 }],
        tests: [{ name: 'a', passed: 'yes' }],
        changes: [
          { scope: 'environment', name: 'ok', value: 'v' },
          { scope: 'system', name: 'x', value: 'v' },
          { scope: 'runtime', name: ' ', value: 'v' },
          { scope: 'runtime', name: 'n', value: 3 }
        ],
        request: { method: 'GET', url: 1, headers: [] }
      })
    ).toEqual({
      logs: [{ level: 'log', text: 'x' }],
      tests: [],
      changes: [{ scope: 'environment', name: 'ok', value: 'v' }],
      request: null
    })
  })
})
