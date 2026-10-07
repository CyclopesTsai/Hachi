/**
 * Finds the git installed on this computer and runs it (decision 111): arguments as an
 * array, never through a shell; git is not bundled with the app.
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import path from 'node:path'

export interface GitResult {
  stdout: string
  stderr: string
  /** Exit code; 0 = success. */
  code: number
}

export interface GitLocator {
  gitCandidates(): string[]
  gitUsable(file: string): Promise<boolean>
}

const isExecutable = async (file: string) => {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** First working git: PATH, then the platform's usual install locations. */
export async function findGit(locator: GitLocator): Promise<string | null> {
  const exe = process.platform === 'win32' ? 'git.exe' : 'git'
  const fromPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => path.join(dir, exe))
  for (const file of [...new Set([...fromPath, ...locator.gitCandidates()])]) {
    if (!(await isExecutable(file)) || !(await locator.gitUsable(file))) continue
    const version = await runGit(file, ['--version'], { cwd: process.cwd(), timeoutMs: 10_000 })
    if (version.code === 0 && version.stdout.startsWith('git version')) return file
  }
  return null
}

export function runGit(
  git: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      git,
      [...args],
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          // Never wait for input on a terminal; messages in English for parsing.
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
          // Reading the status must not take index.lock from other git tools.
          GIT_OPTIONAL_LOCKS: '0',
          ...options.env
        },
        timeout: options.timeoutMs ?? 60_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : error.killed ? 124 : 1
        resolve({ stdout, stderr: stderr || (error && code !== 0 ? error.message : ''), code })
      }
    )
  })
}
