import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HachiError } from '@shared/errors'
import type { TlsCheckResult } from '@shared/http'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { readAppleRoots, verifyWithSecurity } from '../../platform/darwin-trust'
import type { SystemTrustVerdict } from '../../platform/types'
import { verifyWithX509Chain } from '../../platform/win32-trust'
import { resolveInherited } from './build-request'
import { HttpService } from './http-service'
import { checkCertificates, extraChecks, type TlsCheckDeps } from './tls-check'
import { DIRECT, setTrustStoreForTests, type Handshake } from './tls-diagnosis'

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8')
const root = fixture('chain-root.pem')
const intermediate = fixture('chain-intermediate.pem')
const leaf = fixture('chain-leaf.pem')
const selfSignedPem = fixture('localhost-cert.pem')
const x509 = (pem: string) => new X509Certificate(pem)

const servers: https.Server[] = []
const start = async (cert: string) => {
  const server = https.createServer({ cert, key: fixture('chain-leaf-key.pem') }, (_req, res) =>
    res.end('ok')
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `https://localhost:${(server.address() as AddressInfo).port}/`
}
let leafOnly: string
let fullChain: string
let rootSent: string
beforeAll(async () => {
  ;[leafOnly, fullChain, rootSent] = await Promise.all([
    start(leaf),
    start(leaf + intermediate),
    start(leaf + intermediate + root)
  ])
})
afterAll(() => {
  for (const s of servers) s.close()
})
afterEach(() => setTrustStoreForTests(null))

const macVerdict = (ok: boolean, reasons: string[] = []): SystemTrustVerdict => ({
  label: '這台 Mac（系統驗證）',
  clients: 'Safari',
  ok,
  reasons,
  ctVerified: ok
})
type Checked = Omit<TlsCheckResult, 'unresolvedVariables'>
const rows = (r: Checked) => r.trust.map((t) => [t.source, t.status])
const check = (r: Checked, id: string) => r.checks.find((c) => c.id === id)

describe('certificate check (decision 142)', () => {
  it('compares Hachi, Mozilla, the OS and Apple, and says what to do', async () => {
    setTrustStoreForTests([root]) // like a CA only some lists have (TWCA CYBER Root CA)
    const verifySystem = vi.fn(async () =>
      macVerdict(false, ['根憑證不受信任：Hachi Test Root CA'])
    )
    const r = await checkCertificates(fullChain, DIRECT, {
      verifySystem,
      appleRoots: async () => [selfSignedPem] // Apple's list does not have the root
    })
    expect(r.diagnosis.verdict).toBe('ok')
    expect(rows(r)).toEqual([
      ['hachi', 'pass'],
      ['mozilla', 'fail'],
      ['system', 'fail'],
      ['apple', 'fail']
    ])
    // The OS also gets Hachi's root, so it can say "root not trusted".
    const [host, pems] = verifySystem.mock.calls[0] as unknown as [string, string[]]
    expect(host).toBe('localhost')
    expect(pems.map((p) => x509(p).subject)).toEqual([
      x509(leaf).subject,
      x509(intermediate).subject,
      x509(root).subject
    ])
    expect(r.trust[3]?.reasons[0]).toBe('「Hachi Test Root CA」不在 Apple 內建的根憑證中')
    expect(r.advice[0]).toBe(
      'macOS / iOS 不信任「Hachi Test Root CA」→ 請 CA 提供 Apple 信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。'
    )
    expect(r.advice.join('\n')).toContain('不在 Mozilla 的根憑證清單中')
  })

  it('downloads a missing intermediate for the Apple row, as iOS does', async () => {
    setTrustStoreForTests([root])
    const fetchIssuer = vi.fn(async (url: string) =>
      url === 'http://ca.hachi.test/intermediate.cer' ? x509(intermediate) : null
    )
    const r = await checkCertificates(leafOnly, DIRECT, {
      verifySystem: async () => macVerdict(true),
      appleRoots: async () => [root],
      fetchIssuer
    })
    expect(fetchIssuer).toHaveBeenCalledTimes(1)
    expect(r.diagnosis.verdict).toBe('incomplete-chain')
    expect(rows(r)).toEqual([
      ['hachi', 'fail'],
      ['mozilla', 'fail'],
      ['system', 'pass'],
      ['apple', 'fail'] // the chain is fine now, but the test leaf breaks Apple's rules
    ])
    const apple = r.trust[3]?.reasons.join('\n') ?? ''
    expect(apple).not.toContain('少了中繼憑證')
    expect(apple).toContain('Extended Key Usage')
    expect(r.advice.join('\n')).toContain('fullchain')
    expect(r.advice.join('\n')).toContain('serverAuth')
  })

  it('checks versions, the root sent, SCTs and Apple rules', async () => {
    setTrustStoreForTests([root])
    const r = await checkCertificates(rootSent, DIRECT)
    expect(r.trust.find((t) => t.source === 'system')?.status).toBe('unsupported')
    expect(r.trust.some((t) => t.source === 'apple')).toBe(false)
    expect(check(r, 'versions')).toMatchObject({ status: 'pass' })
    expect(check(r, 'versions')?.detail).toContain('支援 TLS 1.3、TLS 1.2')
    expect(check(r, 'versions')?.detail).toContain('不支援 TLS 1.1、TLS 1.0')
    expect(check(r, 'root-sent')).toMatchObject({ status: 'warn' })
    expect(check(r, 'root-sent')?.detail).toContain('Hachi Test Root CA')
    expect(check(r, 'ocsp-stapling')?.status).toBe('info')
    expect(check(r, 'sct')?.status).toBe('warn')
    expect(check(r, 'apple-key')).toMatchObject({
      status: 'pass',
      detail: expect.stringContaining('RSA 2048')
    })
    expect(check(r, 'apple-signature')?.status).toBe('pass')
    expect(check(r, 'apple-eku')?.status).toBe('fail')
    expect(check(r, 'apple-san')?.status).toBe('pass')
    expect(check(r, 'apple-validity')?.status).toBe('warn') // 100 years; Apple's list unknown here
    expect(check(r, 'expiry')?.status).toBe('pass')
  })

  it('warns before certificates expire', () => {
    const certs = [x509(leaf), x509(intermediate)]
    const main: Handshake = {
      certs,
      opensslError: null,
      protocol: 'TLSv1.3',
      ocsp: Buffer.from('x')
    }
    const run = (now: number, appleAnchored: boolean | null) =>
      extraChecks({
        certs,
        main,
        versions: ['yes', 'yes', 'no', 'no'],
        appleAnchored,
        ctVerified: null,
        now
      })
    const end = Date.parse(certs[0]?.validTo as string)
    const soon = run(end - 10.5 * 86_400_000, false)
    expect(soon.find((c) => c.id === 'expiry')).toMatchObject({ status: 'warn' })
    expect(soon.find((c) => c.id === 'expiry')?.detail).toContain('網站憑證「localhost」剩 10 天')
    expect(soon.find((c) => c.id === 'ocsp-stapling')?.status).toBe('pass')
    // A private CA: Apple's 398 days and SCTs do not apply.
    expect(soon.find((c) => c.id === 'apple-validity')?.status).toBe('info')
    expect(soon.find((c) => c.id === 'sct')?.status).toBe('info')
    expect(run(end + 86_400_000, true).find((c) => c.id === 'expiry')?.status).toBe('fail')
    expect(run(end - 400 * 86_400_000, true).find((c) => c.id === 'apple-validity')?.status).toBe(
      'fail'
    )
    const old = extraChecks({
      certs,
      main,
      versions: ['no', 'yes', 'yes', 'yes'],
      appleAnchored: null,
      ctVerified: null,
      now: Date.now()
    }).find((c) => c.id === 'versions')
    expect(old?.status).toBe('warn')
    expect(old?.detail).toContain('TLS 1.1、TLS 1.0 已淘汰')
  })

  it('says so when it cannot connect', async () => {
    const r = await checkCertificates('https://127.0.0.1:1/', DIRECT)
    expect(r.diagnosis.verdict).toBe('unavailable')
    expect(r.diagnosis.summary).toBe('無法連線讀取憑證鏈')
    expect(r.trust).toEqual([])
  })

  it('reports a system verifier that throws', async () => {
    setTrustStoreForTests([root])
    const r = await checkCertificates(fullChain, DIRECT, {
      verifySystem: async () => {
        throw new Error('boom')
      }
    })
    expect(r.trust.find((t) => t.source === 'system')).toMatchObject({
      status: 'error',
      reasons: ['無法執行系統驗證：boom']
    })
  })
})

describe('HttpService.checkTls', () => {
  const service = (deps: Partial<TlsCheckDeps> = {}) =>
    new HttpService({
      getContainerChain: async () => [],
      resolveInherited,
      getVariableLayers: async () => [
        {
          source: 'environment',
          sourceName: 'dev',
          variables: [{ id: '1', key: 'base', value: fullChain, enabled: true, secret: false }]
        }
      ],
      getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
      getProxySettings: () => proxySettingsSchema.parse({}),
      resolveSystemProxy: async () => 'DIRECT',
      userAgent: 'Hachi/test',
      tlsCheck: deps
    })
  const input = (url: string) => ({ parentId: null, environmentId: null, url, useProxy: true })

  it('replaces variables and accepts wss://', async () => {
    setTrustStoreForTests([root])
    const r = await service().checkTls(input('{{base}}api?x={{nope}}'))
    expect(r.host).toBe('localhost')
    expect(r.trust[0]?.status).toBe('pass')
    expect(r.unresolvedVariables).toEqual(['nope'])
    const ws = await service().checkTls(input(fullChain.replace('https:', 'wss:')))
    expect(ws.port).toBe(r.port)
    expect(ws.trust[0]?.status).toBe('pass')
  })

  it('says http:// / ws:// are unencrypted, and only checks https:// and wss://', async () => {
    const s = service()
    const http = await s.checkTls(input('http://localhost:8080/{{nope}}'))
    expect(http).toMatchObject({ insecure: 'http', host: 'localhost', port: 8080, trust: [] })
    expect(http.unresolvedVariables).toEqual(['nope'])
    expect(await s.checkTls(input('ws://localhost/'))).toMatchObject({ insecure: 'ws', port: 80 })
    await expect(s.checkTls(input('ftp://localhost/'))).rejects.toBeInstanceOf(HachiError)
    await expect(s.checkTls(input('ftp://localhost/'))).rejects.toThrow('https:// 或 wss://')
    await expect(s.checkTls(input('  '))).rejects.toThrow('請先輸入網址')
  })
})

// The acceptance case of issue #4: trusted by Hachi, not by macOS.
describe.runIf(process.platform === 'darwin')('macOS system verification', () => {
  it('Hachi trusts the test CA, macOS and iOS do not', { timeout: 40_000 }, async () => {
    setTrustStoreForTests([root])
    const r = await checkCertificates(fullChain, DIRECT, {
      verifySystem: verifyWithSecurity,
      appleRoots: readAppleRoots
    })
    expect(rows(r)).toEqual([
      ['hachi', 'pass'],
      ['mozilla', 'fail'],
      ['system', 'fail'],
      ['apple', 'fail']
    ])
    expect(r.trust[2]?.label).toBe('這台 Mac（系統驗證）')
    expect(r.trust[2]?.reasons).toContain('根憑證不受信任：Hachi Test Root CA')
    expect(r.trust[3]?.reasons[0]).toBe('「Hachi Test Root CA」不在 Apple 內建的根憑證中')
    expect(r.advice[0]).toContain('macOS / iOS 不信任「Hachi Test Root CA」')
  })
})

describe.runIf(process.platform === 'win32')('Windows system verification', () => {
  it('reports an untrusted root and a host mismatch', { timeout: 60_000 }, async () => {
    const pems = [leaf, intermediate, root]
    const verdict = await verifyWithX509Chain('localhost', pems)
    expect(verdict.ok).toBe(false)
    expect(verdict.label).toBe('這台 Windows（系統驗證）')
    expect(verdict.reasons.some((r) => r.startsWith('根憑證不受信任'))).toBe(true)
    const other = await verifyWithX509Chain('api.example.com', pems)
    expect(other.reasons).toContain('網域不符')
  })
})

// Real sites; run by hand: HACHI_NETWORK_TESTS=1 npx vitest run tls-check
describe.runIf(process.env.HACHI_NETWORK_TESTS === '1')('real sites', () => {
  const deps: TlsCheckDeps =
    process.platform === 'darwin'
      ? { verifySystem: verifyWithSecurity, appleRoots: readAppleRoots }
      : process.platform === 'win32'
        ? { verifySystem: verifyWithX509Chain }
        : {}
  const statuses = (r: Checked) =>
    r.trust.filter((t) => t.status !== 'unsupported').map((t) => t.status)

  it('github.com passes everywhere', { timeout: 60_000 }, async () => {
    const r = await checkCertificates('https://github.com/', DIRECT, deps)
    expect(statuses(r).every((s) => s === 'pass')).toBe(true)
    expect(r.advice).toEqual([])
  })

  it('untrusted-root.badssl.com fails everywhere', { timeout: 60_000 }, async () => {
    const r = await checkCertificates('https://untrusted-root.badssl.com/', DIRECT, deps)
    expect(statuses(r).every((s) => s === 'fail')).toBe(true)
  })
})
