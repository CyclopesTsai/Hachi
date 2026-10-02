import { describe, expect, it } from 'vitest'
import type { KeyValue } from '@shared/schemas/collection'
import { httpRequestSchema, type HttpRequest } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import type { InheritedSettings } from '@shared/http'
import {
  buildCodegenRequest,
  buildRequest,
  buildUrl,
  effectiveAuth,
  HttpBuildError,
  resolveInherited,
  type ContainerLevel
} from './build-request'

const kv = (key: string, value: string, enabled = true): KeyValue => ({
  id: key,
  key,
  value,
  enabled
})

function request(overrides: Record<string, unknown> = {}): HttpRequest {
  return httpRequestSchema.parse({
    version: 1,
    id: 'r',
    type: 'http',
    name: 'R',
    url: 'https://api.test/users',
    ...overrides
  })
}

const collection: ContainerLevel = {
  id: 'c',
  name: 'API',
  headers: [kv('X-Team', 'core'), kv('X-Env', 'prod'), kv('X-Off', '1', false)],
  auth: { type: 'bearer', token: 'col-token' }
}
const folder: ContainerLevel = {
  id: 'f',
  name: 'Admin',
  headers: [kv('x-env', 'staging')],
  auth: { type: 'inherit' }
}

const workspace = workspaceSettingsSchema.parse({})
const noFiles = async (): Promise<Uint8Array> => {
  throw new Error('no files')
}

function build(req: HttpRequest, chain: ContainerLevel[] = [], readFile = noFiles) {
  return buildRequest({
    request: req,
    inherited: resolveInherited(chain),
    workspace,
    userAgent: 'Hachi/test',
    readFile
  })
}

const header = (headers: [string, string][], name: string) =>
  headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]

describe('resolveInherited', () => {
  it('lets inner levels override same-named headers and skips disabled ones', () => {
    const { headers } = resolveInherited([collection, folder])
    expect(headers.map((h) => [h.key, h.value, h.sourceName])).toEqual([
      ['X-Team', 'core', 'API'],
      ['x-env', 'staging', 'Admin']
    ])
  })

  it('takes auth from the nearest level that is not "inherit"', () => {
    expect(resolveInherited([collection, folder]).auth).toEqual({
      auth: { type: 'bearer', token: 'col-token' },
      sourceId: 'c',
      sourceName: 'API'
    })
    expect(resolveInherited([{ ...collection, auth: { type: 'inherit' } }]).auth).toBeNull()
  })

  it('falls back to no auth', () => {
    expect(effectiveAuth({ type: 'inherit' }, { headers: [], auth: null })).toEqual({
      type: 'none'
    })
  })
})

describe('buildUrl', () => {
  it('keeps the typed query string and appends enabled params', () => {
    expect(
      buildUrl('https://x.test/a?keep=%2F&b=1', [
        kv('q', 'a b&c'),
        kv('off', '1', false),
        kv('', 'x')
      ])
    ).toBe('https://x.test/a?keep=%2F&b=1&q=a+b%26c')
  })

  it('adds http:// when no scheme is given', () => {
    expect(buildUrl('localhost:3000/x', [])).toBe('http://localhost:3000/x')
  })

  it.each([[''], ['   '], ['http://'], ['ftp://x.test']])('rejects %j', (url) => {
    expect(() => buildUrl(url, [])).toThrow(HttpBuildError)
  })
})

describe('buildRequest', () => {
  it('merges request headers over inherited ones and applies inherited auth', async () => {
    const built = await build(request({ headers: [kv('X-Env', 'local')] }), [collection, folder])
    expect(header(built.headers, 'x-env')).toBe('local')
    expect(header(built.headers, 'x-team')).toBe('core')
    expect(header(built.headers, 'authorization')).toBe('Bearer col-token')
    expect(header(built.headers, 'user-agent')).toBe('Hachi/test')
  })

  it('does not override an explicit Authorization header', async () => {
    const built = await build(
      request({ headers: [kv('Authorization', 'Custom x')], auth: { type: 'bearer', token: 't' } })
    )
    expect(built.headers.filter(([k]) => k.toLowerCase() === 'authorization')).toEqual([
      ['Authorization', 'Custom x']
    ])
  })

  it('encodes basic auth as UTF-8', async () => {
    const built = await build(
      request({ auth: { type: 'basic', username: '使用者', password: 'p:w' } })
    )
    expect(header(built.headers, 'authorization')).toBe(
      `Basic ${Buffer.from('使用者:p:w', 'utf8').toString('base64')}`
    )
  })

  it('puts API keys in a header or the query string', async () => {
    const inHeader = await build(
      request({ auth: { type: 'apiKey', key: 'X-Key', value: 'k1', in: 'header' } })
    )
    expect(header(inHeader.headers, 'x-key')).toBe('k1')
    const inQuery = await build(
      request({ auth: { type: 'apiKey', key: 'key', value: 'k 2', in: 'query' } })
    )
    expect(inQuery.url).toBe('https://api.test/users?key=k+2')
  })

  it.each([
    ['json', { mode: 'json', json: '{"a":1}' }, '{"a":1}', 'application/json'],
    [
      'raw',
      { mode: 'raw', raw: '<a/>', rawContentType: 'application/xml' },
      '<a/>',
      'application/xml'
    ],
    [
      'urlencoded',
      { mode: 'urlencoded', urlencoded: [kv('a', '1 2'), kv('b', 'x', false)] },
      'a=1+2',
      'application/x-www-form-urlencoded'
    ]
  ])('builds %s bodies with a matching content type', async (_mode, body, expected, type) => {
    const built = await build(request({ method: 'POST', body }))
    expect(built.body).toBe(expected)
    expect(header(built.headers, 'content-type')).toBe(type)
  })

  it('keeps an explicit Content-Type', async () => {
    const built = await build(
      request({
        method: 'POST',
        headers: [kv('Content-Type', 'application/vnd.x+json')],
        body: { mode: 'json', json: '{}' }
      })
    )
    expect(built.headers.filter(([k]) => k.toLowerCase() === 'content-type')).toHaveLength(1)
    expect(header(built.headers, 'content-type')).toBe('application/vnd.x+json')
  })

  it('builds multipart form data with files', async () => {
    const built = await build(
      request({
        method: 'POST',
        body: {
          mode: 'formData',
          formData: [
            { id: '1', key: 'title', value: 'hi' },
            { id: '2', key: 'upload', type: 'file', filePath: '/tmp/photo.png' }
          ]
        }
      }),
      [],
      async () => new Uint8Array([1, 2, 3])
    )
    const form = built.body as FormData
    expect(form.get('title')).toBe('hi')
    const file = form.get('upload') as File
    expect(file.name).toBe('photo.png')
    expect(file.size).toBe(3)
    expect(header(built.headers, 'content-type')).toBeUndefined()
  })

  it('reports a missing form-data file', async () => {
    await expect(
      build(
        request({
          method: 'POST',
          body: {
            mode: 'formData',
            formData: [{ id: '1', key: 'f', type: 'file', filePath: '/nope' }]
          }
        })
      )
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })

  it('never sends a body with HEAD', async () => {
    const built = await build(request({ method: 'HEAD', body: { mode: 'json', json: '{}' } }))
    expect(built.body).toBeNull()
  })

  it('uses Workspace settings unless the request overrides them', async () => {
    expect((await build(request())).options).toEqual({
      timeoutMs: 30000,
      validateSSL: true,
      followRedirects: true,
      maxRedirects: 3,
      useProxy: true
    })
    const custom = await build(
      request({
        settings: { timeoutMs: 0, validateSSL: false, followRedirects: false, useProxy: false }
      })
    )
    expect(custom.options).toMatchObject({
      timeoutMs: 0,
      validateSSL: false,
      followRedirects: false,
      useProxy: false
    })
  })
})

describe('buildCodegenRequest', () => {
  const workspace = workspaceSettingsSchema.parse({ timeoutMs: 5000, maxRedirects: 4 })
  const none: InheritedSettings = { headers: [], auth: null }
  const req = (extra: object) =>
    httpRequestSchema.parse({
      version: 1,
      id: 'r',
      type: 'http',
      name: 'R',
      url: 'a.test',
      ...extra
    })

  it('keeps Basic auth separate unless Authorization is set explicitly', () => {
    const basic = { type: 'basic', username: 'u', password: 'p' }
    expect(
      buildCodegenRequest({ request: req({ auth: basic }), inherited: none, workspace }).request
    ).toMatchObject({
      url: 'http://a.test/',
      basicAuth: { username: 'u', password: 'p' },
      headers: []
    })
    const explicit = buildCodegenRequest({
      request: req({
        auth: basic,
        headers: [{ id: 'h', key: 'authorization', value: 'X', enabled: true }]
      }),
      inherited: none,
      workspace
    }).request
    expect(explicit.basicAuth).toBeNull()
    expect(explicit.headers).toEqual([['authorization', 'X']])
  })

  it('maps bodies, content types and options', () => {
    const urlencoded = buildCodegenRequest({
      request: req({
        method: 'POST',
        body: {
          mode: 'urlencoded',
          urlencoded: [
            { id: '1', key: 'a', value: '1', enabled: true },
            { id: '2', key: 'b', value: '2', enabled: false }
          ]
        },
        settings: { validateSSL: false }
      }),
      inherited: none,
      workspace
    }).request
    expect(urlencoded.body).toEqual({ kind: 'urlencoded', fields: [['a', '1']] })
    expect(urlencoded.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']])
    expect(urlencoded.options).toEqual({
      validateSSL: false,
      followRedirects: true,
      maxRedirects: 4,
      timeoutMs: 5000
    })
    const form = buildCodegenRequest({
      request: req({
        method: 'POST',
        body: {
          mode: 'formData',
          formData: [
            { id: '1', key: 'f', type: 'file', filePath: '/x.png', enabled: true },
            { id: '2', key: 'empty', type: 'file', filePath: '', enabled: true },
            { id: '3', key: 't', type: 'text', value: 'v', enabled: true }
          ]
        }
      }),
      inherited: none,
      workspace
    }).request
    expect(form.body).toEqual({
      kind: 'formData',
      fields: [
        { type: 'file', key: 'f', path: '/x.png' },
        { type: 'text', key: 't', value: 'v' }
      ]
    })
    expect(form.headers).toEqual([])
    const raw = buildCodegenRequest({
      request: req({ method: 'HEAD', body: { mode: 'raw', raw: 'x' } }),
      inherited: none,
      workspace
    }).request
    expect(raw.body).toEqual({ kind: 'none' })
  })
})
