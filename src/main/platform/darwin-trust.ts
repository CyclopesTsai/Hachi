/**
 * macOS certificate verification (decision 142): `security verify-cert` evaluates a chain
 * with the same trust engine as Safari, URLSession and the system curl. The certificates
 * come from Hachi's own connection (through the proxy), so `security` does not connect.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SystemTrustVerdict } from './types'
import { isSafeHostName, runCommand } from './trust-common'

const SECURITY = '/usr/bin/security'
const SYSTEM_ROOTS = '/System/Library/Keychains/SystemRootCertificates.keychain'
/** Missing intermediates may be downloaded (AIA), so allow some time. */
const VERIFY_TIMEOUT_MS = 20_000

const LABEL = '這台 Mac（系統驗證）'
const CLIENTS = 'Safari、macOS App（URLSession）、系統 curl'

/** The bracketed keys `security verify-cert -v` prints for each certificate's errors. */
const ERROR_TEXT: Record<string, string> = {
  AnchorTrusted: '根憑證不受信任',
  MissingIntermediate: '找不到簽發它的憑證（少了中繼憑證，或根憑證不受信任）',
  SSLHostname: '網域不符',
  TemporalValidity: '已過期或尚未生效',
  OtherTrustValidityPeriod: '有效期超過 Apple 的上限（398 天）',
  ValidityPeriodMaximums: '有效期超過 Apple 的上限',
  ServerAuthEKU: 'Extended Key Usage 沒有 serverAuth（不能用於網站）',
  ExtendedKeyUsage: 'Extended Key Usage 不允許用於網站',
  KeyUsage: 'Key Usage 不允許用於網站',
  KeySize: '金鑰長度不足（RSA 至少 2048 位元）',
  WeakKeySize: '金鑰長度不足（RSA 至少 2048 位元）',
  WeakSignature: '簽章演算法太弱（例如 SHA-1）',
  SignatureHashAlgorithms: '簽章演算法太弱（例如 SHA-1）',
  SystemTrustedWeakHash: '簽章演算法太弱（例如 SHA-1）',
  CTRequired: '缺少 Certificate Transparency 紀錄（SCT）',
  Revocation: '憑證已被撤銷',
  BlackListedLeaf: '憑證已被 Apple 封鎖',
  BlackListedKey: '金鑰已被 Apple 封鎖',
  GrayListedLeaf: '憑證被 Apple 列為不信任',
  GrayListedKey: '金鑰被 Apple 列為不信任',
  BasicConstraints: 'Basic Constraints 不符（不是 CA 卻簽發了憑證）',
  BasicConstraintsCA: 'Basic Constraints 不符（不是 CA 卻簽發了憑證）',
  NameConstraints: '違反 Name Constraints',
  NonEmptySubject: 'Subject 欄位不符規定',
  IdLinkage: '簽發者與被簽發者的金鑰識別碼對不上',
  CriticalExtensions: '有無法識別的關鍵擴充欄位',
  ChainLength: '憑證鏈太長'
}

/** Pure parser of `security verify-cert -v` output (tests feed it samples). */
export function parseVerifyCert(code: number | null, raw: string): SystemTrustVerdict {
  // Colors (ESC [ … m) around the results.
  const output = raw.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
  const ct = /Certificate Transparency \(CT\) status:\s*(not verified|verified)/.exec(output)
  const ctVerified = ct ? ct[1] === 'verified' : null
  const ok = code === 0 && /certificate verification successful/.test(output)
  const reasons: string[] = []
  const section = /Certificate errors\n([\s\S]*?)\n---/.exec(output)?.[1] ?? ''
  let certName = ''
  for (const line of section.split('\n')) {
    const header = /^\s*\d+:\s+(.*)$/.exec(line)
    if (header) {
      certName = (header[1] as string).trim()
      continue
    }
    const key = /\[([A-Za-z]+)\]\s*$/.exec(line)?.[1]
    if (!key) continue
    const text = `${ERROR_TEXT[key] ?? `其他問題（${key}）`}：${certName}`
    if (!reasons.includes(text)) reasons.push(text)
  }
  if (!ok && reasons.length === 0) {
    const result = /Cert Verify Result:\s*(.+)/.exec(output)?.[1]?.trim()
    reasons.push(result ? `驗證失敗：${result}` : '驗證失敗')
  }
  return { label: LABEL, clients: CLIENTS, ok, reasons: ok ? [] : reasons, ctVerified }
}

export async function verifyWithSecurity(
  host: string,
  pems: string[]
): Promise<SystemTrustVerdict> {
  if (!isSafeHostName(host) || pems.length === 0) {
    return {
      label: LABEL,
      clients: CLIENTS,
      ok: false,
      reasons: ['無法檢查這個主機名稱'],
      ctVerified: null
    }
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-tls-'))
  try {
    const args = ['verify-cert', '-v']
    for (const [i, pem] of pems.entries()) {
      const file = path.join(dir, `${i}.pem`)
      await writeFile(file, pem)
      args.push('-c', file)
    }
    args.push('-p', 'ssl', '-n', host)
    const result = await runCommand(SECURITY, args, { timeoutMs: VERIFY_TIMEOUT_MS })
    if (result.failure) {
      return {
        label: LABEL,
        clients: CLIENTS,
        ok: false,
        reasons: [`無法執行系統驗證：${result.failure}`],
        ctVerified: null
      }
    }
    return parseVerifyCert(result.code, result.output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

let appleRoots: Promise<string[] | null> | null = null

/** The roots Apple ships (the same program as iOS), read once. */
export function readAppleRoots(): Promise<string[] | null> {
  appleRoots ??= runCommand(SECURITY, ['find-certificate', '-a', '-p', SYSTEM_ROOTS], {
    timeoutMs: 15_000,
    maxBuffer: 16 * 1024 * 1024
  }).then((r) => {
    const pems = r.output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    if (r.code !== 0 || !pems) {
      appleRoots = null // try again next time
      return null
    }
    return pems
  })
  return appleRoots
}
