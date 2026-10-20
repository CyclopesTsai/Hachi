import { describe, expect, it } from 'vitest'
import { exampleResponseSchema } from '../schemas/example'
import { httpRequestSchema } from '../schemas/http-request'
import { exportBrunoCollection, importBrunoFolder, importBrunoJson } from './bruno'
import { bruExampleText, parseBruExample } from './bruno-example'
import type { PortableCollection, PortableRequest } from './portable'

let n = 0
const id = () => `id-${++n}`

// The example block as Bruno writes it (its example/jsonToBru.js).
const BRU = `meta {
  name: Create user
  type: http
  seq: 1
}

post {
  url: {{baseUrl}}/users
  body: json
  auth: none
}

body:json {
  { "name": "a" }
}

example {
  name: Created
  description: A new user

  request: {
    url: {{baseUrl}}/users?tag=x
    method: post
    mode: json
    params:query: {
      tag: x
    }

    headers: {
      content-type: application/json
      ~x-off: 1
    }

    body:json: {
      {
        "name": "a"
      }
    }
  }

  response: {
    headers: {
      content-type: application/json
    }

    status: {
      code: 201
      text: Created
    }

    body: {
      type: json
      content: '''
        {
          "id": 1
        }
      '''
    }
  }
}

example {
  name: Missing

  request: {
    url: {{baseUrl}}/users
    method: post
    mode: none
  }

  response: {
    status: {
      code: 404
    }
  }
}
`

describe('Bruno example blocks', () => {
  it('reads the nested request / response syntax', () => {
    const block = BRU.slice(BRU.indexOf('example {') + 'example {\n'.length)
    const text = block
      .slice(0, block.indexOf('\n}\n'))
      .split('\n')
      .map((l) => l.replace(/^ {2}/, ''))
      .join('\n')
    expect(parseBruExample(text)).toEqual({
      name: 'Created',
      description: 'A new user',
      request: {
        url: '{{baseUrl}}/users?tag=x',
        method: 'POST',
        headers: [
          { name: 'content-type', value: 'application/json', enabled: true },
          { name: 'x-off', value: '1', enabled: false }
        ],
        params: [{ name: 'tag', value: 'x', enabled: true, type: 'query' }],
        body: { mode: 'json', json: '{\n  "name": "a"\n}' }
      },
      response: {
        status: 201,
        statusText: 'Created',
        headers: [{ name: 'content-type', value: 'application/json', enabled: true }],
        body: { type: 'json', content: '{\n  "id": 1\n}' }
      }
    })
  })

  it('writes what it reads', () => {
    const example = parseBruExample(
      bruExampleText({
        name: 'Ok',
        description: '',
        request: {
          url: 'https://a.test/x',
          method: 'PUT',
          headers: [{ name: 'X-A', value: '1', enabled: true }],
          params: [{ name: 'id', value: '7', enabled: true, type: 'path' }],
          body: { mode: 'text', text: 'line 1\n}\nline 3' }
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [],
          body: { type: 'text', content: 'done\n  indented\n}' }
        }
      })
    )
    expect(example.request).toMatchObject({
      method: 'PUT',
      params: [{ name: 'id', type: 'path' }],
      body: { mode: 'text', text: 'line 1\n}\nline 3' }
    })
    expect(example.response.body).toEqual({ type: 'text', content: 'done\n  indented\n}' })
  })
})

describe('Bruno examples ↔ saved results (decision 140)', () => {
  it('imports the examples of .bru files', () => {
    const { collection } = importBrunoFolder(
      { 'bruno.json': '{"name":"Shop"}', 'create.bru': BRU },
      id
    )
    const request = collection.children[0] as PortableRequest
    expect(request.examples).toHaveLength(2)
    expect(request.examples?.[0]).toMatchObject({
      name: 'Created',
      sent: null,
      // Like requests: the query of the URL becomes Params.
      request: { method: 'POST', url: '{{baseUrl}}/users', params: [{ key: 'tag', value: 'x' }] },
      response: {
        status: 201,
        contentType: 'application/json',
        body: { encoding: 'text', data: '{\n  "id": 1\n}' }
      }
    })
    expect(request.examples?.[1]?.response).toMatchObject({ status: 404, body: { data: '' } })
  })

  const collection: PortableCollection = {
    name: 'Shop',
    headers: [],
    auth: { type: 'none' },
    scripts: null,
    variables: [],
    children: [
      {
        kind: 'request',
        request: httpRequestSchema.parse({
          version: 1,
          id: 'r',
          type: 'http',
          name: 'Get',
          url: '{{baseUrl}}/users'
        }),
        examples: [
          {
            name: 'Users',
            savedAt: '2026-10-20T00:00:00.000Z',
            request: httpRequestSchema.parse({
              version: 1,
              id: 'r',
              type: 'http',
              name: 'Get',
              url: '{{baseUrl}}/users',
              headers: [{ id: 'h', key: 'Accept', value: 'application/json', enabled: true }]
            }),
            sent: null,
            response: exampleResponseSchema.parse({
              status: 200,
              statusText: 'OK',
              headers: [['content-type', 'application/json']],
              contentType: 'application/json',
              body: { encoding: 'text', data: '[{"id":1}]' },
              bodyBytes: 10
            })
          },
          {
            name: 'Photo',
            savedAt: '',
            request: httpRequestSchema.parse({ version: 1, id: 'r', type: 'http', name: 'Get' }),
            sent: null,
            response: exampleResponseSchema.parse({
              contentType: 'image/png',
              body: { encoding: 'base64', data: 'AAAA' }
            })
          }
        ]
      }
    ]
  }

  for (const format of ['bru', 'yaml'] as const) {
    it(`exports results as examples and reads them back (${format})`, () => {
      const out = exportBrunoCollection(collection, [], format)
      expect(out.warnings.join()).toContain('Photo')
      const again = importBrunoFolder(out.files, id).collection.children[0] as PortableRequest
      expect(again.examples?.map((e) => e.name)).toEqual(['Users', 'Photo'])
      expect(again.examples?.[0]).toMatchObject({
        request: {
          url: '{{baseUrl}}/users',
          headers: [{ key: 'Accept', value: 'application/json' }]
        },
        response: { status: 200, statusText: 'OK', body: { data: '[{"id":1}]' } }
      })
    })
  }

  it('imports the examples of Bruno JSON exports', () => {
    const { collection: imported } = importBrunoJson(
      {
        name: 'Shop',
        version: '1',
        items: [
          {
            type: 'http',
            name: 'Get',
            seq: 1,
            request: { url: 'https://a.test', method: 'GET' },
            examples: [
              {
                name: 'Ok',
                request: { url: 'https://a.test', method: 'GET', body: { mode: 'none' } },
                response: {
                  status: '200',
                  statusText: 'OK',
                  headers: [{ name: 'content-type', value: 'application/json' }],
                  body: { type: 'json', content: { ok: true } }
                }
              }
            ]
          }
        ]
      },
      id
    )
    const request = imported.children[0] as PortableRequest
    expect(request.examples?.[0]?.response).toMatchObject({
      status: 200,
      body: { data: '{\n  "ok": true\n}' }
    })
  })
})
