import { describe, expect, it } from 'vitest'
import { parseVerifyCert } from './darwin-trust'
import { isSafeHostName } from './trust-common'
import { parseChainJson } from './win32-trust'

describe('system certificate verifiers (decision 142)', () => {
  it('only passes plain host names to system commands', () => {
    for (const ok of [
      'github.com',
      'localhost',
      'a-b.example.co.uk',
      '127.0.0.1',
      '::1',
      'x_y.test'
    ])
      expect(isSafeHostName(ok), ok).toBe(true)
    for (const bad of ['', '-n', '-flag.example.com', 'a b', 'a;b', 'a..b', 'a/b', 'x'.repeat(254)])
      expect(isSafeHostName(bad), bad).toBe(false)
  })

  it('reads `security verify-cert -v`', () => {
    const passed = parseVerifyCert(
      0,
      '...certificate verification successful.\n---\nCertificate chain\n 0: github.com\n---\nNo extended validation result found\nCertificate Transparency (CT) status: \x1b[32mverified\x1b[0m\n'
    )
    expect(passed).toMatchObject({ ok: true, reasons: [], ctVerified: true })

    const failed = parseVerifyCert(
      1,
      [
        'Cert Verify Result: CSSMERR_TP_NOT_TRUSTED',
        '---',
        'Certificate errors',
        ' 0: localhost',
        '\x1b[31m    [OtherTrustValidityPeriod]\x1b[0m',
        '\x1b[31m    The Extended Key Usage extension does not permit server authentication [ServerAuthEKU]\x1b[0m',
        ' 1: Hachi Test Intermediate CA',
        ' 2: Hachi Test Root CA',
        '\x1b[31m    The root of the certificate chain is not trusted [AnchorTrusted]\x1b[0m',
        '---',
        'No extended validation result found',
        'Certificate Transparency (CT) status: \x1b[31mnot verified\x1b[0m'
      ].join('\n')
    )
    expect(failed.ok).toBe(false)
    expect(failed.ctVerified).toBe(false)
    expect(failed.reasons).toEqual([
      '有效期超過 Apple 的上限（398 天）：localhost',
      'Extended Key Usage 沒有 serverAuth（不能用於網站）：localhost',
      '根憑證不受信任：Hachi Test Root CA'
    ])
    expect(parseVerifyCert(1, 'Cert Verify Result: Host name mismatch\n').reasons).toEqual([
      '驗證失敗：Host name mismatch'
    ])
    expect(
      parseVerifyCert(1, 'Certificate errors\n 0: x\n    odd [SomethingNew]\n---\n').reasons
    ).toEqual(['其他問題（SomethingNew）：x'])
  })

  it('reads the X509Chain JSON', () => {
    expect(
      parseChainJson('{"ok":true,"status":[],"elements":[{"name":"a","status":[]}]}', false)
    ).toMatchObject({ ok: true, reasons: [] })
    const untrusted = parseChainJson(
      JSON.stringify({
        ok: false,
        status: ['UntrustedRoot'],
        elements: [
          { name: 'localhost', status: ['NotValidForUsage'] },
          { name: 'Hachi Test Root CA', status: 'UntrustedRoot' }
        ]
      }),
      true
    )
    expect(untrusted.ok).toBe(false)
    expect(untrusted.reasons).toEqual([
      '網域不符',
      '憑證用途不允許用於網站（缺少 serverAuth）：localhost',
      '根憑證不受信任：Hachi Test Root CA'
    ])
    expect(parseChainJson('{"ok":true,"status":[],"elements":[]}', true).ok).toBe(false)
    expect(
      parseChainJson('{"ok":false,"status":"PartialChain","elements":[]}', false).reasons
    ).toEqual(['無法建立完整的憑證鏈（少了中繼憑證，或根憑證不受信任）'])
    expect(parseChainJson('#< CLIXML', false).reasons).toEqual(['無法讀取系統驗證的結果'])
  })
})
