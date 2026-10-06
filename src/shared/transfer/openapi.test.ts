import { describe, expect, it } from 'vitest'
import { httpRequestSchema } from '../schemas/http-request'
import { buildOpenApi, inferSchema, openApiHtml } from './openapi'
import type { PortableCollection, PortableItem } from './portable'

let n = 0
const kv = (key: string, value: string, enabled = true) => ({ id: `kv${++n}`, key, value, enabled })
const http = (fields: Record<string, unknown>): PortableItem => ({
  kind: 'request',
  request: httpRequestSchema.parse({ version: 1, id: `r${++n}`, type: 'http', ...fields })
})

const collection: PortableCollection = {
  name: 'Shop API',
  headers: [kv('X-Team', 'core'), kv('Accept', 'application/json')],
  auth: { type: 'bearer', token: '{{token}}' },
  scripts: null,
  variables: [],
  children: [
    {
      kind: 'folder',
      name: 'Users',
      headers: [],
      auth: { type: 'inherit' },
      scripts: null,
      children: [
        http({
          name: 'Get user',
          url: '{{baseUrl}}/users/{{userId}}/orders/:orderId?expand=items',
          params: [kv('page', '1')],
          headers: [kv('X-Trace', 'abc'), kv('Authorization', 'Bearer x')],
          assertions: [
            {
              id: 'a1',
              enabled: true,
              target: 'status',
              path: '',
              operator: 'eq',
              expected: '200'
            },
            { id: 'a2', enabled: true, target: 'status', path: '', operator: 'eq', expected: '404' }
          ],
          docs: 'Returns **one** user.'
        }),
        http({
          name: 'Create user',
          method: 'POST',
          url: '{{baseUrl}}/users',
          auth: { type: 'none' },
          body: { mode: 'json', json: '{"name":"Hachi","age":3,"tags":["a"],"vip":false,"x":null}' }
        }),
        http({ name: 'Duplicate', method: 'POST', url: '{{baseUrl}}/users' })
      ]
    },
    http({
      name: 'Upload',
      method: 'PUT',
      url: 'https://files.test/upload',
      auth: { type: 'apiKey', key: 'X-Key', value: 'k', in: 'header' },
      body: {
        mode: 'formData',
        formData: [
          { id: 'f1', key: 'title', type: 'text', value: 'cat' },
          { id: 'f2', key: 'file', type: 'file', filePath: '/tmp/cat.png' }
        ]
      }
    }),
    {
      kind: 'request',
      request: { version: 1, id: 'ws', type: 'websocket', name: 'Live' } as never
    },
    http({ name: 'Empty' })
  ]
}

describe('buildOpenApi', () => {
  const { document, skipped, warnings } = buildOpenApi(collection, {
    baseUrl: 'https://{{host}}/v1',
    host: 'shop.test',
    userId: '42'
  })
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>

  it('builds info, servers, tags and security schemes', () => {
    expect(document.openapi).toBe('3.0.3')
    expect(document.info).toEqual({ title: 'Shop API', version: '1.0.0' })
    expect(document.servers).toEqual([{ url: 'https://shop.test/v1' }])
    expect(document.tags).toEqual([{ name: 'Users' }])
    expect(document.components).toEqual({
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        'apiKey_header_X-Key': { type: 'apiKey', in: 'header', name: 'X-Key' }
      }
    })
    expect(Object.keys(paths)).toEqual(['/users/{userId}/orders/{orderId}', '/users', '/upload'])
  })

  it('maps path, query and header parameters, docs and responses', () => {
    const get = paths['/users/{userId}/orders/{orderId}']?.get
    expect(get).toMatchObject({
      summary: 'Get user',
      description: 'Returns **one** user.',
      tags: ['Users'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'OK' }, '404': { description: 'Not Found' } }
    })
    const params = (get?.parameters as { name: string; in: string; example?: string }[]).map(
      (p) => [p.in, p.name, p.example]
    )
    expect(params).toEqual([
      ['path', 'userId', '42'],
      ['path', 'orderId', undefined],
      ['query', 'expand', 'items'],
      ['query', 'page', '1'],
      ['header', 'X-Team', 'core'],
      ['header', 'X-Trace', 'abc']
    ])
  })

  it('documents bodies with an inferred schema', () => {
    const post = paths['/users']?.post
    expect(post?.security).toEqual([])
    expect(post?.requestBody).toEqual({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'integer' },
              tags: { type: 'array', items: { type: 'string' } },
              vip: { type: 'boolean' },
              x: { nullable: true }
            }
          },
          example: { name: 'Hachi', age: 3, tags: ['a'], vip: false, x: null }
        }
      }
    })
    expect(post?.responses).toEqual({ default: { description: 'Response' } })
    const put = paths['/upload']?.put
    expect(put?.servers).toEqual([{ url: 'https://files.test' }])
    expect(put?.requestBody).toEqual({
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string', example: 'cat' },
              file: { type: 'string', format: 'binary' }
            }
          }
        }
      }
    })
  })

  it('reports what was left out', () => {
    expect(skipped).toEqual(['Live'])
    expect(warnings).toEqual([
      '沒有網址，未匯出（Empty）',
      '與「Create user」的路徑和方法相同（POST /users），未匯出（Users / Duplicate）'
    ])
  })

  it('warns when the server variable has no value', () => {
    const result = buildOpenApi(collection)
    expect(result.document.servers).toEqual([{ url: '{{baseUrl}}' }])
    expect(result.warnings[0]).toBe('伺服器網址中的變數沒有值：{{baseUrl}}（可在匯出時選擇環境）')
  })

  it('infers nested schemas', () => {
    expect(inferSchema([{ a: 1.5 }])).toEqual({
      type: 'array',
      items: { type: 'object', properties: { a: { type: 'number' } } }
    })
  })
})

describe('openApiHtml', () => {
  it('inlines Redoc and the document without breaking out of the script tags', () => {
    const html = openApiHtml(
      { openapi: '3.0.3', info: { title: 'A </script><b>' }, paths: {} },
      {
        bundle:
          '/*! For license information please see x.LICENSE.txt */\nvar r=/<!--x-->/,s="<script><\\/script>";window.Redoc={init:function(){}}',
        licenses: '/*! MIT */'
      }
    )
    expect(html).toContain('<title>A &lt;/script&gt;&lt;b&gt;</title>')
    expect(html).toContain('var r=/\\x3C!--x-->/,s="\\x3Cscript><\\/script>"')
    expect(html).toContain('"title":"A \\u003c/script>\\u003cb>"')
    expect(html).not.toContain('For license information')
    expect(html.match(/<script>/g)).toHaveLength(2)
    expect(html.match(/<\/script>/g)).toHaveLength(2)
    expect(html).not.toContain('<!--')
  })
})
