import { describe, expect, it } from 'vitest'
import { authSchema, type Auth } from '../schemas/collection'
import { httpRequestSchema } from '../schemas/http-request'
import { exportBrunoCollection, importBrunoFolder } from './bruno'
import type { PortableCollection } from './portable'
import { exportPostmanCollection, importPostmanCollection } from './postman'

// Decision 128: OAuth 2.0, Digest and AWS Signature survive export → import.
const auths: Auth[] = [
  authSchema.parse({ type: 'digest', username: 'u', password: 'p' }),
  authSchema.parse({
    type: 'awsSigV4',
    accessKeyId: 'AKID',
    secretAccessKey: '{{awsSecret}}',
    sessionToken: 'tok',
    region: 'eu-west-1',
    service: 'execute-api'
  }),
  authSchema.parse({
    type: 'oauth2',
    grantType: 'client_credentials',
    accessTokenUrl: 'https://a.test/token',
    clientId: 'id',
    clientSecret: 'secret',
    scope: 'read write',
    clientAuth: 'body',
    pkce: false
  }),
  authSchema.parse({
    type: 'oauth2',
    grantType: 'password',
    accessTokenUrl: 'https://a.test/token',
    clientId: 'id',
    username: 'me',
    password: 'pw',
    headerPrefix: 'Token',
    pkce: false
  }),
  authSchema.parse({
    type: 'oauth2',
    grantType: 'authorization_code',
    accessTokenUrl: 'https://a.test/token',
    authUrl: 'https://a.test/authorize',
    callbackUrl: 'http://127.0.0.1:5555/cb',
    clientId: 'id',
    pkce: true
  })
]

const collection: PortableCollection = {
  name: 'Auth',
  headers: [],
  auth: { type: 'none' },
  variables: [],
  scripts: null,
  children: auths.map((auth, i) => ({
    kind: 'request' as const,
    request: httpRequestSchema.parse({
      version: 1,
      id: `r${i}`,
      type: 'http',
      name: `R${i}`,
      url: 'https://a.test',
      auth
    })
  }))
}

const authsOf = (c: PortableCollection) =>
  c.children.map((child) => (child.kind === 'request' ? child.request.auth : null))

let n = 0
const newId = () => `id-${++n}`

describe('auth import / export (decision 128)', () => {
  it('round-trips through Postman', () => {
    const json = exportPostmanCollection(collection, 'p').json
    const back = importPostmanCollection(json, { newId })
    expect(back.warnings).toEqual([])
    expect(authsOf(back.collection)).toEqual(auths)
  })

  for (const format of ['bru', 'yaml'] as const) {
    it(`round-trips through Bruno (${format})`, () => {
      const { files } = exportBrunoCollection(collection, [], format)
      const back = importBrunoFolder(files, newId)
      expect(back.warnings).toEqual([])
      expect(authsOf(back.collection)).toEqual(auths)
    })
  }

  it('warns about what Hachi does not support', () => {
    const json = {
      info: {
        name: 'A',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [
        {
          name: 'Implicit',
          request: {
            url: 'https://a.test',
            auth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: 'implicit' }] }
          }
        }
      ]
    }
    const back = importPostmanCollection(json, { newId })
    expect(back.warnings).toEqual([
      '不支援的 OAuth 2.0 Grant Type「implicit」，已改為 None（Implicit）'
    ])
  })
})
