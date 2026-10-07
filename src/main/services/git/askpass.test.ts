import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { AskpassServer, promptKind } from './askpass'

/** Runs the askpass script the way git does: prompt as the argument, answer on stdout. */
function ask(env: Record<string, string>, prompt: string) {
  return new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile(
      env.GIT_ASKPASS as string,
      [prompt],
      { env: { ...process.env, ...env }, shell: process.platform === 'win32' },
      (error, stdout) => resolve({ code: error ? Number(error.code ?? 1) : 0, stdout })
    )
  })
}

describe('AskpassServer', () => {
  let server: AskpassServer | null = null
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('answers git through the helper, or exits 1 when cancelled', async () => {
    const prompts: string[] = []
    // In tests the helper runs on node (process.execPath).
    server = new AskpassServer(async (prompt) => {
      prompts.push(prompt)
      return prompt.startsWith('Username') ? 'hachi' : null
    })
    const env = await server.start()
    expect(await ask(env, "Username for 'https://git.test': ")).toEqual({
      code: 0,
      stdout: 'hachi\n'
    })
    expect((await ask(env, "Password for 'https://hachi@git.test': ")).code).not.toBe(0)
    expect(prompts).toEqual([
      "Username for 'https://git.test': ",
      "Password for 'https://hachi@git.test': "
    ])
  })

  it('ignores requests without the token', async () => {
    server = new AskpassServer(async () => 'leak')
    const env = await server.start()
    const result = await ask({ ...env, HACHI_ASKPASS_TOKEN: 'wrong' }, 'Password: ')
    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
  })

  it('tells what is asked', () => {
    expect(promptKind("Username for 'https://x': ")).toBe('username')
    expect(promptKind("Password for 'https://u@x': ")).toBe('password')
    expect(promptKind("Enter passphrase for key '/Users/a/.ssh/id_ed25519': ")).toBe('passphrase')
    expect(promptKind('Are you sure you want to continue connecting (yes/no)?')).toBe('other')
  })
})
