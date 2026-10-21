/**
 * Windows certificate verification (decision 142): .NET's X509Chain (CryptoAPI, the
 * verifier behind Edge, Chrome and .NET apps) run by a fixed PowerShell script. The
 * certificates go in through stdin as base64 DER; nothing is interpolated into the script.
 * X509Chain does not check the host name, so that is done here.
 */
import { X509Certificate } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import type { SystemTrustVerdict } from './types'
import { isSafeHostName, runCommand } from './trust-common'

const LABEL = '這台 Windows（系統驗證）'
const CLIENTS = 'Edge、Chrome、.NET / Windows App'
const VERIFY_TIMEOUT_MS = 30_000

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$lines = [Console]::In.ReadToEnd() -split '\\s+' | Where-Object { $_ -ne '' }
$certs = @($lines | ForEach-Object {
  New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,[Convert]::FromBase64String($_))
})
$chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$chain.ChainPolicy.UrlRetrievalTimeout = New-TimeSpan -Seconds 10
[void]$chain.ChainPolicy.ApplicationPolicy.Add((New-Object System.Security.Cryptography.Oid -ArgumentList '1.3.6.1.5.5.7.3.1'))
for ($i = 1; $i -lt $certs.Count; $i++) { [void]$chain.ChainPolicy.ExtraStore.Add($certs[$i]) }
$ok = $chain.Build($certs[0])
$elements = @($chain.ChainElements | ForEach-Object {
  [pscustomobject]@{
    name = $_.Certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    status = @($_.ChainElementStatus | ForEach-Object { $_.Status.ToString() })
  }
})
[pscustomobject]@{
  ok = $ok
  status = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() })
  elements = $elements
} | ConvertTo-Json -Compress -Depth 4
`

/** X509ChainStatusFlags names. */
const STATUS_TEXT: Record<string, string> = {
  UntrustedRoot: '根憑證不受信任',
  PartialChain: '無法建立完整的憑證鏈（少了中繼憑證，或根憑證不受信任）',
  NotTimeValid: '已過期或尚未生效',
  NotTimeNested: '有效期間不在簽發者的有效期間內',
  NotSignatureValid: '簽章無效',
  NotValidForUsage: '憑證用途不允許用於網站（缺少 serverAuth）',
  InvalidExtension: '擴充欄位無效',
  Revoked: '憑證已被撤銷',
  ExplicitDistrust: '憑證被系統設為不信任',
  HasWeakSignature: '簽章演算法太弱（例如 SHA-1）',
  InvalidBasicConstraints: 'Basic Constraints 不符',
  InvalidNameConstraints: '違反 Name Constraints',
  HasNotPermittedNameConstraint: '違反 Name Constraints',
  HasExcludedNameConstraint: '違反 Name Constraints',
  HasNotSupportedCriticalExtension: '有無法識別的關鍵擴充欄位',
  Cyclic: '憑證鏈形成循環',
  InvalidPolicyConstraints: '違反 Policy Constraints',
  NoIssuanceChainPolicy: '缺少必要的憑證政策'
}

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]

/** Pure parser of the script's JSON output (tests feed it samples). */
export function parseChainJson(json: string, hostMismatch: boolean): SystemTrustVerdict {
  const base = { label: LABEL, clients: CLIENTS, ctVerified: null }
  let data: { ok?: unknown; status?: unknown; elements?: unknown }
  try {
    data = JSON.parse(json.trim()) as typeof data
  } catch {
    return { ...base, ok: false, reasons: ['無法讀取系統驗證的結果'] }
  }
  const reasons: string[] = []
  if (hostMismatch) reasons.push('網域不符')
  for (const element of asArray(data.elements)) {
    const e = element as { name?: unknown; status?: unknown }
    for (const status of asArray(e.status)) {
      if (typeof status !== 'string' || status === 'NoError') continue
      const text = `${STATUS_TEXT[status] ?? `其他問題（${status}）`}：${String(e.name ?? '')}`
      if (!reasons.includes(text)) reasons.push(text)
    }
  }
  const ok = data.ok === true && !hostMismatch
  if (!ok && reasons.length === 0) {
    for (const status of asArray(data.status)) {
      if (typeof status === 'string') reasons.push(STATUS_TEXT[status] ?? `其他問題（${status}）`)
    }
    if (reasons.length === 0) reasons.push('驗證失敗')
  }
  return { ...base, ok, reasons: ok ? [] : reasons }
}

const toBase64Der = (pem: string) => new X509Certificate(pem).raw.toString('base64')

export async function verifyWithX509Chain(
  host: string,
  pems: string[]
): Promise<SystemTrustVerdict> {
  const fail = (reason: string): SystemTrustVerdict => ({
    label: LABEL,
    clients: CLIENTS,
    ok: false,
    reasons: [reason],
    ctVerified: null
  })
  if (!isSafeHostName(host) || pems.length === 0) return fail('無法檢查這個主機名稱')
  let leaf: X509Certificate
  let input: string
  try {
    leaf = new X509Certificate(pems[0] as string)
    input = pems.map(toBase64Der).join('\n')
  } catch {
    return fail('無法讀取憑證')
  }
  const hostMismatch = net.isIP(host) ? !leaf.checkIP(host) : !leaf.checkHost(host)
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = path.win32.join(
    root,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const result = await runCommand(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64')
    ],
    { timeoutMs: VERIFY_TIMEOUT_MS, input }
  )
  if (result.failure || result.code !== 0) {
    return fail(`無法執行系統驗證：${result.failure ?? result.output.trim().slice(0, 300)}`)
  }
  return parseChainJson(result.stdout, hostMismatch)
}
