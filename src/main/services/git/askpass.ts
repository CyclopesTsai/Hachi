/**
 * Asking for credentials when git needs them (decision 113): git runs GIT_ASKPASS /
 * SSH_ASKPASS with the prompt as its argument and reads the answer from its output. The
 * helper written here (run by this app's own binary as plain Node) forwards the prompt
 * over a private local socket to the app, which shows a dialog. Nothing is stored; git's
 * credential helper decides whether to remember it.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/** The helper: plain Node, no dependencies. Exit 1 = cancelled. */
const HELPER_JS = `'use strict'
const net = require('node:net')
const socket = net.connect(process.env.HACHI_ASKPASS_SOCKET)
let data = ''
socket.on('connect', () => {
  socket.write(JSON.stringify({ token: process.env.HACHI_ASKPASS_TOKEN, prompt: process.argv.slice(2).join(' ') }) + '\\n')
})
socket.on('data', (chunk) => { data += chunk })
socket.on('end', () => {
  try {
    const reply = JSON.parse(data)
    if (reply && typeof reply.value === 'string') {
      process.stdout.write(reply.value + '\\n')
      process.exit(0)
    }
  } catch {}
  process.exit(1)
})
socket.on('error', () => process.exit(1))
`

export type PromptHandler = (prompt: string) => Promise<string | null>

export class AskpassServer {
  private server: net.Server | null = null
  private dir: string | null = null
  private env: Record<string, string> | null = null
  private readonly token = randomBytes(24).toString('hex')

  constructor(
    private readonly onPrompt: PromptHandler,
    /** The program that runs the helper: this app's binary (with ELECTRON_RUN_AS_NODE) or node. */
    private readonly runtime: string = process.execPath
  ) {}

  /** Environment variables that make git (and ssh) ask through this app. */
  async start(): Promise<Record<string, string>> {
    if (this.env) return this.env
    // A private folder (0700) for the helper and, outside Windows, the socket.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-askpass-'))
    await chmod(dir, 0o700)
    const socket =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\hachi-askpass-${randomBytes(8).toString('hex')}`
        : path.join(dir, 's.sock')
    const helper = path.join(dir, 'askpass.js')
    await writeFile(helper, HELPER_JS, { mode: 0o600 })
    // A shell script on every platform: Git for Windows runs `#!/bin/sh` scripts with its
    // own sh (and its ssh does the same for SSH_ASKPASS), which also takes Windows paths.
    const script = path.join(dir, 'askpass.sh')
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    await writeFile(script, `#!/bin/sh\nexec ${quote(this.runtime)} ${quote(helper)} "$@"\n`, {
      mode: 0o700
    })

    this.server = net.createServer((conn) => {
      let data = ''
      conn.setEncoding('utf8')
      conn.on('data', (chunk) => {
        data += chunk
        if (!data.includes('\n')) return
        let request: { token?: unknown; prompt?: unknown }
        try {
          request = JSON.parse(data.slice(0, data.indexOf('\n'))) as typeof request
        } catch {
          conn.end('{}')
          return
        }
        if (request.token !== this.token || typeof request.prompt !== 'string') {
          conn.end('{}')
          return
        }
        this.onPrompt(request.prompt).then(
          (value) => conn.end(JSON.stringify(value === null ? {} : { value })),
          () => conn.end('{}')
        )
      })
      conn.on('error', () => undefined)
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(socket, () => resolve())
    })
    this.dir = dir
    this.env = {
      GIT_ASKPASS: script,
      SSH_ASKPASS: script,
      // OpenSSH 8.4+: use SSH_ASKPASS even with a terminal / without DISPLAY.
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY ?? ':0',
      ELECTRON_RUN_AS_NODE: '1',
      HACHI_ASKPASS_SOCKET: socket,
      HACHI_ASKPASS_TOKEN: this.token
    }
    return this.env
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.env = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (this.dir) await rm(this.dir, { recursive: true, force: true })
    this.dir = null
  }
}

/** What git is asking for, from its prompt (for the dialog's wording). */
export function promptKind(prompt: string): 'username' | 'password' | 'passphrase' | 'other' {
  if (/^username/i.test(prompt)) return 'username'
  if (/passphrase/i.test(prompt)) return 'passphrase'
  if (/password|token/i.test(prompt)) return 'password'
  return 'other'
}
