/**
 * Windows certificate verification (decision 142): .NET's X509Chain (CryptoAPI, the
 * verifier behind Edge, Chrome and .NET apps) run by a fixed PowerShell script. The
 * certificates go in through stdin as base64 DER; nothing is interpolated into the script.
 * X509Chain does not check the host name, so that is done here.
 */
import { X509Certificate } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { msg } from '@shared/i18n'
import type { SystemTrustVerdict } from './types'
import { isSafeHostName, runCommand } from './trust-common'

const base = () => ({
  platform: 'win32' as const,
  label: msg().tlsCheck.system.windowsLabel,
  clients: msg().tlsCheck.system.windowsClients,
  ctVerified: null
})
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

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]

/** Pure parser of the script's JSON output (tests feed it samples). */
export function parseChainJson(json: string, hostMismatch: boolean): SystemTrustVerdict {
  const m = msg().tlsCheck.system
  let data: { ok?: unknown; status?: unknown; elements?: unknown }
  try {
    data = JSON.parse(json.trim()) as typeof data
  } catch {
    return { ...base(), ok: false, reasons: [m.badOutput], rootUntrusted: false }
  }
  const reasons: string[] = []
  let rootUntrusted = false
  if (hostMismatch) reasons.push(m.hostMismatch)
  for (const element of asArray(data.elements)) {
    const e = element as { name?: unknown; status?: unknown }
    for (const status of asArray(e.status)) {
      if (typeof status !== 'string' || status === 'NoError') continue
      if (status === 'UntrustedRoot') rootUntrusted = true
      const text = m.reason(m.win32[status] ?? m.other(status), String(e.name ?? ''))
      if (!reasons.includes(text)) reasons.push(text)
    }
  }
  const ok = data.ok === true && !hostMismatch
  if (!ok && reasons.length === 0) {
    for (const status of asArray(data.status)) {
      if (typeof status !== 'string') continue
      if (status === 'UntrustedRoot') rootUntrusted = true
      reasons.push(m.win32[status] ?? m.other(status))
    }
    if (reasons.length === 0) reasons.push(m.failed)
  }
  return { ...base(), ok, reasons: ok ? [] : reasons, rootUntrusted: !ok && rootUntrusted }
}

const toBase64Der = (pem: string) => new X509Certificate(pem).raw.toString('base64')

export async function verifyWithX509Chain(
  host: string,
  pems: string[]
): Promise<SystemTrustVerdict> {
  const m = msg().tlsCheck.system
  const fail = (reason: string): SystemTrustVerdict => ({
    ...base(),
    ok: false,
    reasons: [reason],
    rootUntrusted: false
  })
  if (!isSafeHostName(host) || pems.length === 0) return fail(m.badHost)
  let leaf: X509Certificate
  let input: string
  try {
    leaf = new X509Certificate(pems[0] as string)
    input = pems.map(toBase64Der).join('\n')
  } catch {
    return fail(m.cannotRead)
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
    return fail(m.cannotRun(result.failure ?? result.output.trim().slice(0, 300)))
  }
  return parseChainJson(result.stdout, hostMismatch)
}
