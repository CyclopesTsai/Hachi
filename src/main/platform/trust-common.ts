/**
 * Shared by the system certificate verifiers (decision 142).
 */
import { execFile } from 'node:child_process'
import net from 'node:net'

/**
 * A host name or IP address that is safe to hand to a system command as an argument
 * (letters, digits, dots, hyphens, underscores; never starting with "-").
 */
export function isSafeHostName(host: string): boolean {
  if (net.isIP(host)) return true
  return (
    host.length > 0 &&
    host.length <= 253 &&
    /^[a-z0-9_]([a-z0-9_.-]*[a-z0-9_.])?$/i.test(host) &&
    !host.includes('..')
  )
}

export interface CommandOutput {
  /** Exit code; null when the command could not run or was killed (timeout). */
  code: number | null
  /** stdout followed by stderr. */
  output: string
  stdout: string
  /** Why it could not run, when it did not. */
  failure: string | null
}

/** Runs a command without a shell; never throws. */
export function runCommand(
  file: string,
  args: string[],
  options: { timeoutMs: number; input?: string; maxBuffer?: number }
): Promise<CommandOutput> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`
        if (!error) return resolve({ code: 0, output, stdout, failure: null })
        const e = error as NodeJS.ErrnoException & { code?: unknown; killed?: boolean }
        if (typeof e.code === 'number') {
          return resolve({ code: e.code, output, stdout, failure: null })
        }
        resolve({
          code: null,
          output,
          stdout,
          failure: e.killed ? '逾時' : (e.message ?? String(error))
        })
      }
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
  })
}
