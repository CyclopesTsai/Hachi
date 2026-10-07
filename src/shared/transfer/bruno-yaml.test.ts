import { describe, expect, it } from 'vitest'
import type { HttpRequest } from '../schemas/http-request'
import { exportBrunoCollection, importBrunoFolder } from './bruno'
import type { PortableFolder, PortableRequest } from './portable'

let n = 0
const id = () => `y-${++n}`

// OpenCollection YAML as written by Bruno 3.x (opencollection.yml + one file per item).
const files: Record<string, string> = {
  'opencollection.yml': `opencollection: 1.0.0
info:
  name: Nebula

request:
  headers:
    - name: X-Team
      value: core
  auth:
    type: bearer
    token: "{{token}}"
  variables:
    - name: baseUrl
      value: https://nebula.test
    - name: retries
      value:
        type: number
        data: "3"
bundled: false
`,
  'users/folder.yml': `info:
  name: 使用者
  type: folder
  seq: 1

request:
  auth: inherit
`,
  'users/登入.yml': `info:
  name: 登入
  type: http
  seq: 2

http:
  method: POST
  url: "{{baseUrl}}/users/:id/login"
  params:
    - name: id
      value: "42"
      type: path
    - name: lang
      value: zh
      type: query
    - name: debug
      value: "1"
      type: query
      disabled: true
  headers:
    - name: Accept
      value: application/json
  body:
    type: json
    data: |-
      {
        "user": "hachi"
      }
  auth: inherit

runtime:
  variables:
    - name: ts
      value: "{{$timestamp}}"
  actions:
    - type: set-variable
      phase: after-response
      selector:
        expression: res.body.token
        method: jsonq
      variable:
        name: token
        scope: runtime
  scripts:
    - type: before-request
      code: bru.setVar("a", 1)
    - type: after-response
      code: console.log(res.getStatus())
    - type: tests
      code: |-
        test("ok", function () {
          expect(res.status).to.equal(200);
        });
  assertions:
    - expression: res.status
      operator: eq
      value: "200"
    - expression: res.body.token
      operator: isString

settings:
  encodeUrl: true
  timeout: 5000
  followRedirects: false

docs: 登入並取得 token
`,
  'users/upload.yml': `info:
  name: Upload
  type: http
  seq: 1

http:
  method: PUT
  url: "{{baseUrl}}/files"
  body:
    type: multipart-form
    data:
      - name: title
        type: text
        value: cat
      - name: file
        type: file
        value:
          - pics/cat.png
`,
  'graph.yml': `info:
  name: Me
  type: graphql
  seq: 2

graphql:
  method: POST
  url: "{{baseUrl}}/graphql"
  body:
    query: "{ me { id } }"
    variables: '{"a": 1}'
`,
  'environments/dev.yml': `name: dev
variables:
  - name: baseUrl
    value: http://localhost:3000
  - name: port
    value:
      type: number
      data: "3000"
  - secret: true
    name: token
`,
  '.github/workflows/ci.yml': 'on: push\njobs: {}\n'
}

const req = (c: { children: unknown[] }, i: number) =>
  (c.children[i] as PortableRequest).request as HttpRequest
const folder = (c: { children: unknown[] }, i: number) => c.children[i] as PortableFolder

describe('OpenCollection YAML import', () => {
  const { collection, environments, warnings } = importBrunoFolder(files, id)

  it('reads the collection defaults and folders', () => {
    expect(collection.name).toBe('Nebula')
    expect(collection.headers.map((h) => [h.key, h.value])).toEqual([['X-Team', 'core']])
    expect(collection.auth).toEqual({ type: 'bearer', token: '{{token}}' })
    expect(collection.variables.map((v) => [v.key, v.value])).toEqual([
      ['baseUrl', 'https://nebula.test'],
      ['retries', '3']
    ])
    expect(collection.children.map((c) => (c.kind === 'folder' ? c.name : c.request.name))).toEqual(
      ['使用者', 'Me']
    )
    expect(folder(collection, 0).auth).toEqual({ type: 'inherit' })
  })

  it('reads a request: params, body, auth, runtime, settings, docs', () => {
    const login = req(folder(collection, 0), 1)
    expect(login.method).toBe('POST')
    expect(login.url).toBe('{{baseUrl}}/users/42/login')
    expect(login.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['lang', 'zh', true],
      ['debug', '1', false]
    ])
    expect(JSON.parse(login.body.json)).toEqual({ user: 'hachi' })
    expect(login.auth).toEqual({ type: 'inherit' })
    expect(login.extractions.map((e) => [e.source, e.path, e.variable])).toEqual([
      ['jsonBody', 'token', 'token']
    ])
    expect(login.assertions.map((a) => [a.target, a.path, a.operator, a.expected])).toEqual([
      ['status', '', 'eq', '200'],
      ['jsonBody', 'token', 'isType', 'string']
    ])
    expect(login.scripts.preRequest).toBe(
      'bru.setVar("ts", bru.interpolate("{{$timestamp}}"))\nbru.setVar("a", 1)'
    )
    expect(login.scripts.postResponse).toContain('console.log(res.getStatus())')
    expect(login.scripts.postResponse).toContain('test("ok"')
    expect(login.settings).toMatchObject({ timeoutMs: 5000, followRedirects: false })
    expect(login.docs).toBe('登入並取得 token')

    const upload = req(folder(collection, 0), 0)
    expect(upload.body.formData.map((f) => [f.key, f.type, f.value, f.filePath])).toEqual([
      ['title', 'text', 'cat', ''],
      ['file', 'file', '', 'pics/cat.png']
    ])
    const gql = req(collection, 1)
    expect(JSON.parse(gql.body.json)).toEqual({ query: '{ me { id } }', variables: { a: 1 } })
  })

  it('names environments after the collection; secrets have no value', () => {
    expect(environments.map((e) => e.name)).toEqual(['Nebula / dev'])
    expect(environments[0]?.variables.map((v) => [v.key, v.value, v.secret])).toEqual([
      ['baseUrl', 'http://localhost:3000', false],
      ['port', '3000', false],
      ['token', '', true]
    ])
    expect(warnings).toContain('Bruno 不把機密變數的值存在檔案中，請在環境中重新輸入')
  })

  it('reports broken YAML with the file name', () => {
    expect(() => importBrunoFolder({ ...files, 'bad.yml': 'info: [' })).toThrow(/^bad\.yml：/)
  })
})

describe('OpenCollection YAML export', () => {
  it('writes files Bruno 3 reads, and reads back the same collection', () => {
    const { collection, environments } = importBrunoFolder(files, id)
    const out = exportBrunoCollection(collection, environments, 'yaml')
    expect(Object.keys(out.files).sort()).toEqual([
      'Me.yml',
      'environments/dev.yml',
      'opencollection.yml',
      '使用者/Upload.yml',
      '使用者/folder.yml',
      '使用者/登入.yml'
    ])
    expect(out.files['opencollection.yml']).toMatch(
      /^opencollection: 1\.0\.0\ninfo:\n {2}name: Nebula\n/
    )
    expect(out.files['environments/dev.yml']).toContain('- secret: true\n    name: token')

    const again = importBrunoFolder(out.files, id)
    const strip = (v: unknown) =>
      JSON.parse(JSON.stringify(v, (key, value: unknown) => (key === 'id' ? undefined : value)))
    expect(strip(again.collection)).toEqual(strip(collection))
    expect(strip(again.environments)).toEqual(strip(environments))
  })
})
