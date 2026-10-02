import { describe, expect, it } from 'vitest'
import { httpRequestSchema, type HttpRequest } from '../schemas/http-request'
import type { PortableCollection, PortableFolder, PortableRequest } from './portable'
import {
  POSTMAN_SCHEMA_V21,
  TransferError,
  detectImportFormat,
  exportPostmanCollection,
  importPostmanCollection,
  importPostmanEnvironment,
  toPostmanUrl,
  unsupportedScriptApis
} from './postman'

let n = 0
const ctx = { newId: () => `id-${++n}` }

const V20 = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'

/** A Postman v2.1 export exercising most mappings. */
const sample = {
  info: { _postman_id: 'x', name: 'Shop API', schema: POSTMAN_SCHEMA_V21 },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'https://shop.test' },
    { key: 'retries', value: 3 },
    { key: 'off', value: 'x', disabled: true }
  ],
  event: [{ listen: 'prerequest', script: { exec: ['console.log(1)'] } }],
  item: [
    {
      name: 'Users',
      auth: { type: 'noauth' },
      item: [
        {
          name: 'Get user',
          request: {
            method: 'get',
            header: [
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Off', value: '1', disabled: true, description: 'not sent' }
            ],
            url: {
              raw: '{{baseUrl}}/users/:id?expand=orders&debug',
              host: ['{{baseUrl}}'],
              path: ['users', ':id'],
              query: [
                { key: 'expand', value: 'orders' },
                { key: 'debug', value: null },
                { key: 'page', value: '2', disabled: true }
              ],
              variable: [{ key: 'id', value: '42' }]
            }
          },
          response: [{ name: 'example' }],
          event: [
            { listen: 'test', script: { exec: ['pm.test("ok", () => {', '})'] } },
            { listen: 'prerequest', script: { exec: [''] } }
          ],
          protocolProfileBehavior: { disableStrictSSL: true, followRedirects: false }
        },
        {
          name: 'Create user',
          request: {
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: { mode: 'raw', raw: '{"name":"a"}', options: { raw: { language: 'json' } } },
            url: '{{baseUrl}}/users',
            auth: {
              type: 'basic',
              basic: [
                { key: 'username', value: 'u' },
                { key: 'password', value: 'p' }
              ]
            }
          }
        }
      ]
    },
    {
      name: 'Upload',
      request: {
        method: 'PUT',
        url: 'https://shop.test/files',
        auth: { type: 'oauth2', oauth2: [] },
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'title', value: 'cat', type: 'text' },
            { key: 'file', type: 'file', src: ['/a.png', '/b.png'] }
          ]
        }
      }
    },
    {
      name: 'GraphQL',
      request: {
        method: 'POST',
        url: 'https://shop.test/graphql',
        body: { mode: 'graphql', graphql: { query: '{ me { id } }', variables: '{"a":1}' } }
      }
    },
    {
      name: 'Form',
      request: {
        method: 'PURGE',
        url: 'https://shop.test/form',
        auth: {
          type: 'apikey',
          apikey: [
            { key: 'key', value: 'X-Key' },
            { key: 'value', value: 'k' },
            { key: 'in', value: 'query' }
          ]
        },
        body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] }
      }
    }
  ]
}

const folder = (c: { children: unknown[] }, i: number) => c.children[i] as PortableFolder
const req = (c: { children: unknown[] }, i: number) =>
  (c.children[i] as PortableRequest).request as HttpRequest

describe('detectImportFormat', () => {
  it('recognises collections v2.0 / v2.1 and environments', () => {
    expect(detectImportFormat(sample)).toBe('postman-collection')
    expect(detectImportFormat({ info: { schema: V20 }, item: [] })).toBe('postman-collection')
    expect(detectImportFormat({ name: 'Dev', values: [] })).toBe('postman-environment')
    expect(detectImportFormat({ values: [], _postman_variable_scope: 'globals' })).toBe(
      'postman-environment'
    )
    expect(detectImportFormat({ requests: [], order: [] })).toBeNull()
    expect(detectImportFormat([])).toBeNull()
  })

  it('explains unsupported files', () => {
    expect(() => importPostmanCollection({ requests: [], order: [] })).toThrow(/v1/)
    expect(() => importPostmanCollection({ foo: 1 })).toThrow(TransferError)
  })
})

describe('importPostmanCollection', () => {
  const { collection, warnings } = importPostmanCollection(sample, ctx)

  it('maps the collection: name, auth, variables, scripts', () => {
    expect(collection.name).toBe('Shop API')
    expect(collection.auth).toEqual({ type: 'bearer', token: '{{token}}' })
    expect(collection.variables.map((v) => [v.key, v.value, v.enabled])).toEqual([
      ['baseUrl', 'https://shop.test', true],
      ['retries', '3', true],
      ['off', 'x', false]
    ])
    expect(collection.scripts).toEqual({ preRequest: 'console.log(1)', postResponse: '' })
    expect(warnings).toContain('Collection 的腳本已保留，但目前不會執行')
  })

  it('maps folders and requests: URL, path variables, params, headers, settings, scripts', () => {
    const users = folder(collection, 0)
    expect(users.kind).toBe('folder')
    expect(users.auth).toEqual({ type: 'none' })
    const get = req(users, 0)
    expect(get.method).toBe('GET')
    expect(get.url).toBe('{{baseUrl}}/users/42')
    expect(get.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['expand', 'orders', true],
      ['debug', '', true],
      ['page', '2', false]
    ])
    expect(get.headers[1]).toMatchObject({ key: 'X-Off', enabled: false, description: 'not sent' })
    expect(get.auth).toEqual({ type: 'inherit' })
    expect(get.settings).toMatchObject({ validateSSL: false, followRedirects: false })
    expect(get.scripts).toEqual({ preRequest: '', postResponse: 'pm.test("ok", () => {\n})' })
    expect(warnings).toContain('範例回應（Examples）不會匯入')
  })

  it('maps bodies and auth types, warning about what does not fit', () => {
    const create = req(folder(collection, 0), 1)
    expect(create.body).toMatchObject({ mode: 'json', json: '{"name":"a"}' })
    expect(create.auth).toEqual({ type: 'basic', username: 'u', password: 'p' })

    const upload = req(collection, 1)
    expect(upload.auth).toEqual({ type: 'none' })
    expect(upload.body.mode).toBe('formData')
    expect(upload.body.formData.map((f) => [f.key, f.type, f.value, f.filePath])).toEqual([
      ['title', 'text', 'cat', ''],
      ['file', 'file', '', '/a.png']
    ])

    const gql = req(collection, 2)
    expect(gql.body.mode).toBe('json')
    expect(JSON.parse(gql.body.json)).toEqual({ query: '{ me { id } }', variables: { a: 1 } })

    const form = req(collection, 3)
    expect(form.method).toBe('GET')
    expect(form.auth).toEqual({ type: 'apiKey', key: 'X-Key', value: 'k', in: 'query' })
    expect(form.body.urlencoded.map((r) => [r.key, r.value])).toEqual([['a', '1']])

    expect(warnings).toEqual(
      expect.arrayContaining([
        '不支援的 Auth 類型「oauth2」，已改為 None（Upload）',
        'Form-data 欄位有多個檔案，只匯入第一個（Upload）',
        'GraphQL Body 已轉成 JSON Body（GraphQL）',
        '不支援的 HTTP 方法「PURGE」，已改為 GET（Form）'
      ])
    )
  })

  it('accepts v2.0 shapes: string request, header string, object auth attributes', () => {
    const { collection: c } = importPostmanCollection(
      {
        info: { name: 'Old', schema: V20 },
        item: [
          { name: 'Ping', request: 'https://x.test/ping' },
          {
            name: 'Auth',
            request: {
              url: 'https://x.test',
              header: 'A: 1\nB: two: parts',
              auth: { type: 'bearer', bearer: { token: 't' } }
            }
          }
        ]
      },
      ctx
    )
    expect(req(c, 0)).toMatchObject({ method: 'GET', url: 'https://x.test/ping' })
    expect(req(c, 1).headers.map((h) => [h.key, h.value])).toEqual([
      ['A', '1'],
      ['B', 'two: parts']
    ])
    expect(req(c, 1).auth).toEqual({ type: 'bearer', token: 't' })
  })

  it('builds URLs from structured parts and limits names', () => {
    const { collection: c } = importPostmanCollection(
      {
        info: { name: '', schema: POSTMAN_SCHEMA_V21 },
        item: [
          {
            name: 'x'.repeat(150),
            request: {
              url: { protocol: 'https', host: ['api', 'test'], port: '8443', path: ['v1', 'a'] }
            }
          },
          { name: 'Missing path var', request: { url: 'https://a.test/:id' } }
        ]
      },
      ctx
    )
    expect(c.name).toBe('Imported Collection')
    expect(req(c, 0).url).toBe('https://api.test:8443/v1/a')
    expect(req(c, 0).name).toHaveLength(100)
    expect(req(c, 1).url).toBe('https://a.test/:id')
  })

  it('reports one warning with examples for many items', () => {
    const item = Array.from({ length: 5 }, (_, i) => ({
      name: `R${i}`,
      request: { url: 'https://a.test', auth: { type: 'digest' } }
    }))
    const { warnings: w } = importPostmanCollection(
      { info: { name: 'A', schema: POSTMAN_SCHEMA_V21 }, item },
      ctx
    )
    expect(w).toEqual(['不支援的 Auth 類型「digest」，已改為 None（R0、R1、R2 等 5 項）'])
  })
})

describe('unsupportedScriptApis', () => {
  it('lists Postman APIs the sandbox does not provide', () => {
    expect(
      unsupportedScriptApis(
        `pm.sendRequest(url, cb); const _ = require('lodash'); const C = require("crypto-js")\npm.cookies.get('a'); postman.setNextRequest('x')`
      )
    ).toEqual(['pm.sendRequest', 'pm.cookies', 'setNextRequest', "require('lodash')"])
    expect(unsupportedScriptApis('pm.test("ok", () => pm.response.to.have.status(200))')).toEqual(
      []
    )
  })

  it('is reported when importing', () => {
    const { warnings } = importPostmanCollection(
      {
        info: { name: 'A', schema: POSTMAN_SCHEMA_V21 },
        item: [
          {
            name: 'R',
            request: 'https://a.test',
            event: [{ listen: 'test', script: { exec: ['pm.sendRequest("x")'] } }]
          }
        ]
      },
      ctx
    )
    expect(warnings).toEqual(['腳本使用了 Hachi 不支援的寫法：pm.sendRequest（R）'])
  })
})

describe('importPostmanEnvironment', () => {
  it('maps values; secret type becomes a secret variable', () => {
    const env = importPostmanEnvironment(
      {
        name: 'Prod',
        values: [
          { key: 'host', value: 'prod.test', enabled: true },
          { key: 'token', value: 's3cret', type: 'secret', enabled: true },
          { key: 'old', value: '1', enabled: false },
          { key: '', value: 'ignored' }
        ]
      },
      ctx
    )
    expect(env.name).toBe('Prod')
    expect(env.variables.map((v) => [v.key, v.value, v.secret, v.enabled])).toEqual([
      ['host', 'prod.test', false, true],
      ['token', 's3cret', true, true],
      ['old', '1', false, false]
    ])
  })
})

describe('toPostmanUrl', () => {
  it('splits URL parts and merges the typed query with Params', () => {
    expect(
      toPostmanUrl('https://api.test:8080/v1/users?a=1#top', [
        { id: '1', key: 'b', value: '2', enabled: true },
        { id: '2', key: 'c', value: '3', enabled: false }
      ])
    ).toEqual({
      raw: 'https://api.test:8080/v1/users?a=1&b=2#top',
      protocol: 'https',
      host: ['api', 'test'],
      port: '8080',
      path: ['v1', 'users'],
      query: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
        { key: 'c', value: '3', disabled: true }
      ],
      hash: 'top'
    })
    expect(toPostmanUrl('{{baseUrl}}/x', [])).toEqual({
      raw: '{{baseUrl}}/x',
      host: ['{{baseUrl}}'],
      path: ['x']
    })
  })
})

describe('exportPostmanCollection', () => {
  it('round-trips through import', () => {
    const { collection } = importPostmanCollection(sample, ctx)
    const exported = exportPostmanCollection(collection, 'pid')
    expect(exported.json.info).toEqual({
      _postman_id: 'pid',
      name: 'Shop API',
      schema: POSTMAN_SCHEMA_V21
    })
    const again = importPostmanCollection(exported.json, ctx).collection

    const strip = (c: PortableCollection) =>
      JSON.parse(JSON.stringify(c, (key, value: unknown) => (key === 'id' ? undefined : value)))
    expect(strip(again)).toEqual(strip(collection))
  })

  it('copies shared headers into requests, leaves secrets empty and skips WebSocket items', () => {
    const httpRequest = (name: string, headers: HttpRequest['headers'] = []): PortableRequest => ({
      kind: 'request',
      request: httpRequestSchema.parse({
        version: 1,
        id: name,
        type: 'http',
        name,
        url: 'https://a.test',
        headers
      })
    })
    const collection: PortableCollection = {
      name: 'C',
      headers: [{ id: 'h', key: 'X-Team', value: 'core', enabled: true }],
      auth: { type: 'none' },
      variables: [
        { id: 'v1', key: 'token', value: 'top-secret', enabled: true, secret: true },
        { id: 'v2', key: 'host', value: 'a.test', enabled: true, secret: false }
      ],
      scripts: null,
      children: [
        {
          kind: 'folder',
          name: 'F',
          headers: [{ id: 'h2', key: 'X-Team', value: 'folder', enabled: true }],
          auth: { type: 'inherit' },
          scripts: null,
          children: [
            httpRequest('Own', [{ id: 'h3', key: 'x-team', value: 'mine', enabled: true }]),
            httpRequest('Inherits')
          ]
        },
        {
          kind: 'request',
          request: {
            version: 1,
            id: 'ws',
            type: 'websocket',
            name: 'Live'
          } as unknown as PortableRequest['request']
        }
      ]
    }
    const out = exportPostmanCollection(collection, 'p')
    const items = out.json.item as Record<string, unknown>[]
    const inner = (
      items[0] as { item: { request: { header: { key: string; value: string }[] } }[] }
    ).item
    expect(inner[0]?.request.header).toEqual([{ key: 'x-team', value: 'mine' }])
    expect(inner[1]?.request.header).toEqual([{ key: 'X-Team', value: 'folder' }])
    expect(items).toHaveLength(1)
    expect(out.skipped).toEqual(['Live'])
    expect(out.json.variable).toEqual([
      { key: 'token', value: '', type: 'string' },
      { key: 'host', value: 'a.test', type: 'string' }
    ])
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        'Postman 沒有共用 Headers：Collection / 資料夾的 Headers 已併入每個請求',
        '機密變數的值不會匯出（已留空）'
      ])
    )
  })
})
