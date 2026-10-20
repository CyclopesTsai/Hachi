import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { HIDDEN_VALUE } from '@shared/schemas/example'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { buildVariableMap, type VariableLayer } from '@shared/variables'
import { resolveInherited } from './build-request'
import { HttpService } from './http-service'
import { maskSecrets, secretValues, sentBodyOf } from './saved-result'
import { startHttpServer, type TestServer } from './test-servers'

let server: TestServer
beforeAll(async () => {
  server = await startHttpServer()
})
afterAll(() => server.close())

const variable = (key: string, value: string, secret = false) => ({
  id: key,
  key,
  value,
  enabled: true,
  secret
})

const layers: VariableLayer[] = [
  {
    source: 'environment',
    sourceName: 'dev',
    variables: [
      variable('token', 's3cret-token', true),
      variable('pin', 'abc', true),
      variable('wrapped', 'x-{{token}}-y', true),
      variable('host', 'example')
    ]
  }
]

describe('secret values', () => {
  it('lists secret values (also with nested variables expanded), longest first', () => {
    const map = buildVariableMap(layers)
    const expand = (t: string) => t.replace('{{token}}', 's3cret-token')
    expect(secretValues(map, expand)).toEqual([
      { name: 'wrapped', value: 'x-s3cret-token-y' },
      { name: 'wrapped', value: 'x-{{token}}-y' },
      { name: 'token', value: 's3cret-token' }
    ])
  })

  it('puts secrets back as {{name}}, URL-encoded ones too', () => {
    const secrets = [{ name: 'key', value: 'a b&c=d' }]
    expect(maskSecrets('q=a%20b%26c%3Dd and a b&c=d', secrets)).toBe('q={{key}} and {{key}}')
  })

  it('records form-data fields, files by name', () => {
    const form = new FormData()
    form.append('note', 'hi')
    form.append('photo', new File([new Uint8Array([1])], 'cat.png'))
    expect(sentBodyOf(form)).toMatchObject({
      kind: 'form',
      fields: [
        { name: 'note', value: 'hi', file: false },
        { name: 'photo', value: 'cat.png', file: true }
      ]
    })
    expect(sentBodyOf(null).kind).toBe('none')
  })
})

describe('HttpService.savedResult', () => {
  const http = new HttpService({
    getContainerChain: async () => [],
    resolveInherited,
    getVariableLayers: async () => layers,
    getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
    getProxySettings: () => proxySettingsSchema.parse({}),
    resolveSystemProxy: async () => 'DIRECT',
    userAgent: 'Hachi/test'
  })

  it('hides secrets and credential headers in what is saved', async () => {
    const source = httpRequestSchema.parse({
      version: 1,
      id: 'r',
      type: 'http',
      name: 'R',
      method: 'POST',
      url: `${server.url}/echo?key={{token}}`,
      headers: [
        { id: 'h1', key: 'X-Token', value: '{{token}}', enabled: true },
        { id: 'h2', key: 'Cookie', value: 'a=1', enabled: true }
      ],
      auth: { type: 'basic', username: 'me', password: '{{token}}' },
      body: { mode: 'json', json: '{"token":"{{token}}","host":"{{host}}"}' }
    })
    const result = await http.send({
      runId: 'save',
      parentId: null,
      environmentId: null,
      request: source
    })
    expect(result.kind).toBe('response')
    const saved = http.savedResult('save', 'Echo', '2026-10-20T00:00:00.000Z')
    const text = JSON.stringify(saved)
    expect(text).not.toContain('s3cret-token')
    expect(saved.request.url).toBe(`${server.url}/echo?key={{token}}`)
    expect(saved.sent).toMatchObject({
      method: 'POST',
      url: `${server.url}/echo?key={{token}}`,
      body: { kind: 'text', text: '{"token":"{{token}}","host":"example"}' }
    })
    const sentHeaders = Object.fromEntries(
      saved.sent!.headers.map(([k, v]) => [k.toLowerCase(), v])
    )
    expect(sentHeaders['x-token']).toBe('{{token}}')
    expect(sentHeaders.authorization).toBe(HIDDEN_VALUE)
    expect(sentHeaders.cookie).toBe(HIDDEN_VALUE)
    // The echo puts the secret into the response body: it is masked there too.
    expect(saved.response).toMatchObject({ status: 200, body: { encoding: 'text' } })
    expect(saved.response.body.data).toContain('{{token}}')
  })

  it('keeps binary bodies as base64 and refuses bodies over 1 MB', async () => {
    const source = (url: string) =>
      httpRequestSchema.parse({ version: 1, id: 'r', type: 'http', name: 'R', url })
    await http.send({
      runId: 'img',
      parentId: null,
      environmentId: null,
      request: source(`${server.url}/bytes?size=3&type=image/png`)
    })
    expect(http.savedResult('img', 'Image', '').response.body).toEqual({
      encoding: 'base64',
      data: 'AAAA'
    })
    await http.send({
      runId: 'big',
      parentId: null,
      environmentId: null,
      request: source(`${server.url}/bytes?size=${1024 * 1024 + 1}`)
    })
    expect(() => http.savedResult('big', 'Big', '')).toThrow(/1 MB/)
    expect(() => http.savedResult('gone', 'X', '')).toThrow()
  })
})
