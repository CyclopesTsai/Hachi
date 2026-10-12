import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { resolveInherited } from './build-request'
import { HttpService } from './http-service'
import { analyzeChain, diagnoseTls, setTrustStoreForTests } from './tls-diagnosis'
import { tlsOptions } from './test-servers'

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8')
const root = fixture('chain-root.pem')
const intermediate = fixture('chain-intermediate.pem')
const leaf = fixture('chain-leaf.pem')
const x509 = (pem: string) => new X509Certificate(pem)

// A server that sends only the leaf, and one that sends leaf + intermediate.
const servers: https.Server[] = []
const start = async (cert: string, key: string) => {
  const server = https.createServer({ cert, key }, (_req, res) => res.end('ok'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `https://localhost:${(server.address() as AddressInfo).port}/`
}
let leafOnly: string
let fullChain: string
let selfSigned: string
beforeAll(async () => {
  const key = fixture('chain-leaf-key.pem')
  leafOnly = await start(leaf, key)
  fullChain = await start(leaf + intermediate, key)
  selfSigned = await start(tlsOptions.cert.toString(), tlsOptions.key.toString())
})
afterAll(() => {
  for (const s of servers) s.close()
})
afterEach(() => setTrustStoreForTests(null))

describe('TLS diagnosis (decision 132)', () => {
  it('finds the missing intermediate and its AIA URL', async () => {
    setTrustStoreForTests([root])
    const d = await diagnoseTls(leafOnly)
    expect(d.verdict).toBe('incomplete-chain')
    expect(d.missing).toEqual({
      name: 'Hachi Test Intermediate CA',
      aiaUrl: 'http://ca.hachi.test/intermediate.cer'
    })
    expect(d.chain.map((c) => [c.name, c.source])).toEqual([['localhost', 'server']])
    expect(d.opensslError).toBeTruthy()
    expect(d.summary).toContain('中繼憑證')
  })

  it('accepts a complete chain and shows the root from the trust store', async () => {
    setTrustStoreForTests([root])
    const d = await diagnoseTls(fullChain)
    expect(d.verdict).toBe('ok')
    expect(d.chain.map((c) => [c.name, c.source, c.trusted])).toEqual([
      ['localhost', 'server', false],
      ['Hachi Test Intermediate CA', 'server', false],
      ['Hachi Test Root CA', 'trust-store', true]
    ])
    expect(d.chain[0]?.altNames).toEqual(['localhost', '127.0.0.1'])
  })

  it('tells an unknown root from a broken chain', async () => {
    setTrustStoreForTests([])
    const d = await diagnoseTls(fullChain)
    expect(d.verdict).toBe('untrusted-root')
    expect(d.missing?.name).toBe('Hachi Test Root CA')
  })

  it('reports self-signed certificates, host names and dates', async () => {
    expect((await diagnoseTls(selfSigned)).verdict).toBe('self-signed')
    setTrustStoreForTests([root])
    const certs = [x509(leaf), x509(intermediate)]
    expect(analyzeChain('api.example.com', certs, null).verdict).toBe('hostname-mismatch')
    expect(analyzeChain('localhost', certs, null, Date.UTC(2300, 0, 1)).verdict).toBe('expired')
    expect(analyzeChain('localhost', certs, null, Date.UTC(2000, 0, 1)).verdict).toBe(
      'not-yet-valid'
    )
    // Intermediate and leaf swapped: the signatures do not line up.
    expect(analyzeChain('localhost', [x509(intermediate), x509(leaf)], null).verdict).toBe(
      'hostname-mismatch'
    )
    expect(analyzeChain('localhost', [x509(leaf), x509(root)], null).verdict).toBe('bad-signature')
  })

  it('says so when it cannot connect', async () => {
    const d = await diagnoseTls('https://127.0.0.1:1/')
    expect(d.verdict).toBe('unavailable')
  })
})

describe('HttpService and the TLS diagnosis', () => {
  it('attaches the diagnosis to a certificate failure only when asked', async () => {
    setTrustStoreForTests([root])
    const http = new HttpService({
      getContainerChain: async () => [],
      resolveInherited,
      getVariableLayers: async () => [],
      getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
      getProxySettings: () => proxySettingsSchema.parse({}),
      resolveSystemProxy: async () => 'DIRECT',
      userAgent: 'Hachi/test'
    })
    const send = (diagnoseTls: boolean) =>
      http.send({
        runId: crypto.randomUUID(),
        parentId: null,
        environmentId: null,
        request: httpRequestSchema.parse({
          version: 1,
          id: 'r',
          type: 'http',
          name: 'R',
          url: leafOnly
        }),
        diagnoseTls
      })
    const diagnosed = await send(true)
    expect(diagnosed).toMatchObject({ kind: 'error', code: 'TLS' })
    expect(diagnosed.kind === 'error' && diagnosed.tls?.verdict).toBe('incomplete-chain')
    expect(diagnosed.kind === 'error' && diagnosed.message).not.toContain('--use-system-ca')
    const plain = await send(false)
    expect(plain.kind === 'error' && plain.tls).toBeUndefined()
  })
})
