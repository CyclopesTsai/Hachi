/**
 * macOS certificate verification (decision 142): `security verify-cert` evaluates a chain
 * with the same trust engine as Safari, URLSession and the system curl. The certificates
 * come from Hachi's own connection (through the proxy), so `security` does not connect.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { msg } from '@shared/i18n'
import type { SystemTrustVerdict } from './types'
import { isSafeHostName, runCommand } from './trust-common'

const SECURITY = '/usr/bin/security'
const SYSTEM_ROOTS = '/System/Library/Keychains/SystemRootCertificates.keychain'
/** Missing intermediates may be downloaded (AIA), so allow some time. */
const VERIFY_TIMEOUT_MS = 20_000

const base = () => ({
  platform: 'darwin' as const,
  label: msg().tlsCheck.system.macLabel,
  clients: msg().tlsCheck.system.macClients
})

/** Pure parser of `security verify-cert -v` output (tests feed it samples). */
export function parseVerifyCert(code: number | null, raw: string): SystemTrustVerdict {
  const m = msg().tlsCheck.system
  // Colors (ESC [ … m) around the results.
  const output = raw.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
  const ct = /Certificate Transparency \(CT\) status:\s*(not verified|verified)/.exec(output)
  const ctVerified = ct ? ct[1] === 'verified' : null
  const ok = code === 0 && /certificate verification successful/.test(output)
  const reasons: string[] = []
  let rootUntrusted = false
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
    if (key === 'AnchorTrusted') rootUntrusted = true
    const text = m.reason(m.darwin[key] ?? m.other(key), certName)
    if (!reasons.includes(text)) reasons.push(text)
  }
  if (!ok && reasons.length === 0) {
    const result = /Cert Verify Result:\s*(.+)/.exec(output)?.[1]?.trim()
    reasons.push(result ? m.failedWith(result) : m.failed)
  }
  return {
    ...base(),
    ok,
    reasons: ok ? [] : reasons,
    ctVerified,
    rootUntrusted: !ok && rootUntrusted
  }
}

export async function verifyWithSecurity(
  host: string,
  pems: string[]
): Promise<SystemTrustVerdict> {
  if (!isSafeHostName(host) || pems.length === 0) {
    return {
      ...base(),
      ok: false,
      reasons: [msg().tlsCheck.system.badHost],
      ctVerified: null,
      rootUntrusted: false
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
        ...base(),
        ok: false,
        reasons: [msg().tlsCheck.system.cannotRun(result.failure)],
        ctVerified: null,
        rootUntrusted: false
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
