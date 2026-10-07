import { describe, expect, it } from 'vitest'
import type { HttpRequest } from '../schemas/http-request'
import { parseBru, serializeBru } from './bru-lang'
import { exportBrunoCollection, importBrunoFolder, importBrunoJson, isBrunoJson } from './bruno'
import type { PortableFolder, PortableRequest } from './portable'

let n = 0
const id = () => `id-${++n}`

const GET_USER = `meta {
  name: Get user
  type: http
  seq: 2
}

get {
  url: {{baseUrl}}/users/:id?expand=orders
  body: none
  auth: bearer
}

params:query {
  expand: orders
  ~debug: 1
}

params:path {
  id: 42
}

headers {
  Accept: application/json
  ~X-Debug: yes
}

auth:bearer {
  token: {{token}}
}

vars:pre-request {
  ts: {{$timestamp}}
}

vars:post-response {
  userId: res.body.data.id
  etag: res.headers.etag
  total: res.body.items.length + 1
}

assert {
  res.status: eq 200
  res.body.data.name: isString
  res.headers.content-type: contains json
  res.body.data.role: startsWith "adm"
  res.body.items: length 3
}

script:post-response {
  bru.setVar("seen", true)
}

tests {
  test("ok", function () {
    expect(res.getStatus()).to.equal(200);
  });
}

docs {
  # Get user
  Returns one user.
}
`

const CREATE_USER = `meta {
  name: Create user
  type: http
  seq: 1
}

post {
  url: {{baseUrl}}/users
  body: json
  auth: inherit
}

body:json {
  {
    "name": "Hachi",
    "tags": ["a", "b"]
  }
}
`

const folderFiles: Record<string, string> = {
  'bruno.json': JSON.stringify({ version: '1', name: 'Shop', type: 'collection' }),
  'collection.bru': `headers {
  X-Team: core
}

auth {
  mode: basic
}

auth:basic {
  username: admin
  password: {{password}}
}

vars:pre-request {
  baseUrl: https://shop.test
}
`,
  'users/folder.bru': `meta {
  name: Users
  seq: 1
}

auth {
  mode: inherit
}
`,
  'users/get-user.bru': GET_USER,
  'users/create-user.bru': CREATE_USER,
  'graph.bru': `meta {
  name: Me
  type: graphql
  seq: 2
}

post {
  url: {{baseUrl}}/graphql
  body: graphql
  auth: none
}

body:graphql {
  { me { id } }
}

body:graphql:vars {
  {"a": 1}
}
`,
  'upload.bru': `meta {
  name: Upload
  type: http
  seq: 3
}

put {
  url: {{baseUrl}}/files
  body: multipartForm
  auth: none
}

body:multipart-form {
  title: cat
  file: @file(pics/cat.png)
}
`,
  'environments/dev.bru': `vars {
  baseUrl: http://localhost:3000
  ~old: 1
}
vars:secret [
  token,
  password
]
`
}

const req = (c: { children: unknown[] }, i: number) =>
  (c.children[i] as PortableRequest).request as HttpRequest
const folder = (c: { children: unknown[] }, i: number) => c.children[i] as PortableFolder

describe('bru-lang', () => {
  it('parses dictionary, text and list blocks', () => {
    const blocks = parseBru(GET_USER)
    expect(blocks.map((b) => [b.name, b.kind])).toEqual([
      ['meta', 'dict'],
      ['get', 'dict'],
      ['params:query', 'dict'],
      ['params:path', 'dict'],
      ['headers', 'dict'],
      ['auth:bearer', 'dict'],
      ['vars:pre-request', 'dict'],
      ['vars:post-response', 'dict'],
      ['assert', 'dict'],
      ['script:post-response', 'text'],
      ['tests', 'text'],
      ['docs', 'text']
    ])
    expect(blocks[2]).toMatchObject({
      entries: [
        { key: 'expand', value: 'orders', enabled: true },
        { key: 'debug', value: '1', enabled: false }
      ]
    })
    expect(blocks[10]).toMatchObject({
      text: 'test("ok", function () {\n  expect(res.getStatus()).to.equal(200);\n});'
    })
    expect(parseBru(CREATE_USER)[2]).toMatchObject({
      text: '{\n  "name": "Hachi",\n  "tags": ["a", "b"]\n}'
    })
    expect(parseBru('vars:secret [\n  a,\n  ~b\n]\n')).toEqual([
      { kind: 'list', name: 'vars:secret', items: ['a', '~b'] }
    ])
  })

  it('reads multi-line values and round-trips through serializeBru', () => {
    const source = `vars {\n  note: '''\n    line 1\n    line 2\n  '''\n  a: 1\n}\n`
    const blocks = parseBru(source)
    expect(blocks).toEqual([
      {
        kind: 'dict',
        name: 'vars',
        entries: [
          { key: 'note', value: 'line 1\nline 2', enabled: true },
          { key: 'a', value: '1', enabled: true }
        ]
      }
    ])
    expect(parseBru(serializeBru(blocks))).toEqual(blocks)
    const all = parseBru(GET_USER)
    expect(parseBru(serializeBru(all))).toEqual(all)
  })

  it('reports broken files', () => {
    expect(() => parseBru('meta {\n  name: x\n')).toThrow(/沒有結束/)
    expect(() => parseBru('nonsense')).toThrow(/無法解析/)
  })
})

describe('importBrunoFolder', () => {
  const { collection, environments, warnings } = importBrunoFolder(folderFiles, id)

  it('maps the collection: name, shared headers, auth and variables', () => {
    expect(collection.name).toBe('Shop')
    expect(collection.headers.map((h) => [h.key, h.value])).toEqual([['X-Team', 'core']])
    expect(collection.auth).toEqual({ type: 'basic', username: 'admin', password: '{{password}}' })
    expect(collection.variables.map((v) => [v.key, v.value])).toEqual([
      ['baseUrl', 'https://shop.test']
    ])
  })

  it('orders items by seq and maps folders', () => {
    expect(collection.children.map((c) => (c.kind === 'folder' ? c.name : c.request.name))).toEqual(
      ['Users', 'Me', 'Upload']
    )
    expect(folder(collection, 0).auth).toEqual({ type: 'inherit' })
    expect(folder(collection, 0).children.map((c) => (c as PortableRequest).request.name)).toEqual([
      'Create user',
      'Get user'
    ])
  })

  it('maps a request: URL, params, headers, auth, assertions, extractions, scripts, docs', () => {
    const get = req(folder(collection, 0), 1)
    expect(get.method).toBe('GET')
    expect(get.url).toBe('{{baseUrl}}/users/42')
    expect(get.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['expand', 'orders', true],
      ['debug', '1', false]
    ])
    expect(get.headers.map((h) => [h.key, h.enabled])).toEqual([
      ['Accept', true],
      ['X-Debug', false]
    ])
    expect(get.auth).toEqual({ type: 'bearer', token: '{{token}}' })
    expect(get.assertions.map((a) => [a.target, a.path, a.operator, a.expected])).toEqual([
      ['status', '', 'eq', '200'],
      ['jsonBody', 'data.name', 'isType', 'string'],
      ['header', 'content-type', 'contains', 'json'],
      ['jsonBody', 'data.role', 'matches', '^adm']
    ])
    expect(get.extractions.map((e) => [e.source, e.path, e.variable, e.scope])).toEqual([
      ['jsonBody', 'data.id', 'userId', 'runtime'],
      ['header', 'etag', 'etag', 'runtime']
    ])
    expect(get.scripts.preRequest).toBe('bru.setVar("ts", bru.interpolate("{{$timestamp}}"))')
    expect(get.scripts.postResponse).toContain('bru.setVar("total", res.body.items.length + 1)')
    expect(get.scripts.postResponse).toContain('bru.setVar("seen", true)')
    expect(get.scripts.postResponse).toContain('test("ok"')
    expect(get.docs).toBe('# Get user\nReturns one user.')

    const create = req(folder(collection, 0), 0)
    expect(create.body).toMatchObject({ mode: 'json' })
    expect(JSON.parse(create.body.json)).toEqual({ name: 'Hachi', tags: ['a', 'b'] })
    expect(create.auth).toEqual({ type: 'inherit' })
  })

  it('converts GraphQL and multipart bodies', () => {
    const gql = req(collection, 1)
    expect(JSON.parse(gql.body.json)).toEqual({ query: '{ me { id } }', variables: { a: 1 } })
    const upload = req(collection, 2)
    expect(upload.body.formData.map((f) => [f.key, f.type, f.value, f.filePath])).toEqual([
      ['title', 'text', 'cat', ''],
      ['file', 'file', '', 'pics/cat.png']
    ])
  })

  it('imports environments; secret names come without values', () => {
    expect(environments).toHaveLength(1)
    expect(environments[0]?.name).toBe('Shop / dev')
    expect(environments[0]?.variables.map((v) => [v.key, v.value, v.enabled, v.secret])).toEqual([
      ['baseUrl', 'http://localhost:3000', true, false],
      ['old', '1', false, false],
      ['token', '', true, true],
      ['password', '', true, true]
    ])
  })

  it('lists what could not be mapped', () => {
    expect(warnings).toEqual(
      expect.arrayContaining([
        '無法對應的 Bruno 斷言已略過：res.body.items: length 3（Users / Get user）',
        'GraphQL 請求已轉成 JSON Body（Me）',
        'Bruno 不把機密變數的值存在檔案中，請在環境中重新輸入'
      ])
    )
  })

  it('imports a folder inside a collection on its own', () => {
    const files = Object.fromEntries(
      Object.entries(folderFiles)
        .filter(([path]) => path.startsWith('users/'))
        .map(([path, text]) => [path.slice('users/'.length), text])
    )
    const part = importBrunoFolder(files, id, 'users')
    expect(part.collection.name).toBe('Users')
    expect(part.collection.children.map((c) => (c as PortableRequest).request.name)).toEqual([
      'Create user',
      'Get user'
    ])
    expect(part.warnings[0]).toMatch(/只匯入這個資料夾/)
    expect(importBrunoFolder({ 'a.bru': CREATE_USER }, id, 'loose').collection.name).toBe('loose')
    expect(() => importBrunoFolder({ 'readme.md': '' })).toThrow(/找不到 Bruno 的檔案/)
  })
})

describe('importBrunoJson', () => {
  const json = {
    name: 'Shop JSON',
    version: '1',
    items: [
      {
        type: 'folder',
        name: 'Users',
        seq: 1,
        items: [
          {
            type: 'http',
            name: 'List',
            seq: 1,
            request: {
              url: '{{baseUrl}}/users?page=1',
              method: 'GET',
              headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
              params: [{ name: 'page', value: '1', type: 'query', enabled: true }],
              body: { mode: 'none' },
              auth: {
                mode: 'apikey',
                apikey: { key: 'X-Key', value: 'k', placement: 'queryparams' }
              },
              script: { req: '', res: '' },
              vars: { req: [], res: [{ name: 'first', value: 'res.body[0].id', enabled: true }] },
              assertions: [{ name: 'res.status', value: 'eq 200', enabled: true }],
              tests: '',
              docs: ''
            }
          }
        ]
      }
    ],
    environments: [
      {
        name: 'prod',
        variables: [{ name: 'baseUrl', value: 'https://p', enabled: true, secret: false }]
      }
    ],
    brunoConfig: { version: '1', name: 'Shop JSON', type: 'collection' }
  }

  it('detects Bruno JSON (and not Postman files)', () => {
    expect(isBrunoJson(json)).toBe(true)
    expect(isBrunoJson({ info: { schema: 'x' }, item: [] })).toBe(false)
    expect(isBrunoJson({ items: 'x' })).toBe(false)
  })

  it('maps the same way as folders', () => {
    const { collection, environments } = importBrunoJson(json, id)
    const list = req(folder(collection, 0), 0)
    expect(list.url).toBe('{{baseUrl}}/users')
    expect(list.params.map((p) => [p.key, p.value])).toEqual([['page', '1']])
    expect(list.auth).toEqual({ type: 'apiKey', key: 'X-Key', value: 'k', in: 'query' })
    expect(list.extractions[0]).toMatchObject({
      source: 'jsonBody',
      path: '[0].id',
      variable: 'first'
    })
    expect(list.assertions[0]).toMatchObject({ target: 'status', operator: 'eq', expected: '200' })
    expect(environments[0]?.name).toBe('Shop JSON / prod')
  })
})

describe('exportBrunoCollection', () => {
  it('writes a folder Bruno can open, and reads back the same requests', () => {
    const { collection, environments } = importBrunoFolder(folderFiles, id)
    const out = exportBrunoCollection(
      {
        ...collection,
        children: [
          ...collection.children,
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
      },
      environments
    )
    expect(Object.keys(out.files).sort()).toEqual([
      'Me.bru',
      'Upload.bru',
      'Users/Create user.bru',
      'Users/Get user.bru',
      'Users/folder.bru',
      'bruno.json',
      'collection.bru',
      'environments/dev.bru'
    ])
    expect(out.skipped).toEqual(['Live'])
    expect(out.files['environments/dev.bru']).toContain('vars:secret [\n  token,\n  password\n]')

    const again = importBrunoFolder(out.files, id)
    const strip = (v: unknown) =>
      JSON.parse(JSON.stringify(v, (key, value: unknown) => (key === 'id' ? undefined : value)))
    expect(strip(again.collection)).toEqual(strip(collection))
    expect(strip(again.environments)).toEqual(strip(environments))
  })
})
