import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AskpassServer, promptKind } from './askpass'

/** git itself asks through the script: `git credential fill` without a credential helper. */
async function credentialFill(env: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-askpass-git-'))
  const config = path.join(dir, 'gitconfig')
  await writeFile(config, '')
  try {
    return await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = execFile(
        'git',
        ['-c', 'credential.helper=', 'credential', 'fill'],
        {
          env: {
            ...process.env,
            ...env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: config
          }
        },
        (error, stdout) => resolve({ code: error ? Number(error.code ?? 1) : 0, stdout })
      )
      child.stdin?.end('protocol=https\nhost=git.example.com\n\n')
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('AskpassServer', () => {
  let server: AskpassServer | null = null
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('answers git through the helper (git credential fill)', async () => {
    const prompts: string[] = []
    // In tests the helper runs on node (process.execPath).
    server = new AskpassServer(async (prompt) => {
      prompts.push(prompt)
      return prompt.startsWith('Username') ? 'hachi' : 's3cret'
    })
    const result = await credentialFill(await server.start())
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('username=hachi')
    expect(result.stdout).toContain('password=s3cret')
    expect(prompts.map((p) => p.split(' ')[0])).toEqual(['Username', 'Password'])
  })

  it('cancelling makes git fail; requests without the token are refused', async () => {
    server = new AskpassServer(async () => null)
    expect((await credentialFill(await server.start())).code).not.toBe(0)
    await server.stop()

    server = new AskpassServer(async () => 'leak')
    const env = await server.start()
    const result = await credentialFill({ ...env, HACHI_ASKPASS_TOKEN: 'wrong' })
    expect(result.code).not.toBe(0)
    expect(result.stdout).not.toContain('leak')
  })

  it('tells what is asked', () => {
    expect(promptKind("Username for 'https://x': ")).toBe('username')
    expect(promptKind("Password for 'https://u@x': ")).toBe('password')
    expect(promptKind("Enter passphrase for key '/Users/a/.ssh/id_ed25519': ")).toBe('passphrase')
    expect(promptKind('Are you sure you want to continue connecting (yes/no)?')).toBe('other')
  })
})
