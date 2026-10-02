import { execFile, spawnSync } from 'node:child_process'
import { openAsBlob } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHttpServer, type TestServer } from './test-servers'
import { generateCode, jsString, shellQuote, type CodegenRequest } from '@shared/codegen'

const run = promisify(execFile)

const base = (over: Partial<CodegenRequest> = {}): CodegenRequest => ({
  method: 'GET',
  url: 'https://api.test/users?q=1',
  headers: [],
  basicAuth: null,
  body: { kind: 'none' },
  options: { validateSSL: true, followRedirects: true, maxRedirects: 3, timeoutMs: 0 },
  ...over
})

const jsonPost = (url = 'https://api.test/users'): CodegenRequest =>
  base({
    method: 'POST',
    url,
    headers: [
      ['Content-Type', 'application/json'],
      ['X-Quote', "it's"]
    ],
    basicAuth: { username: 'me', password: 'p@ss' },
    body: { kind: 'text', text: '{"name":"Hachi","n":1,"ok":true,"none":null}', json: true }
  })

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>

/** Runs generated JS (imports stripped) with the given globals; returns console.log output. */
async function runJs(code: string, globals: Record<string, unknown>): Promise<unknown[]> {
  const logged: unknown[] = []
  const body = code
    .split('\n')
    .filter((l) => !l.startsWith('import '))
    .join('\n')
  const fn = new AsyncFunction(...Object.keys(globals), 'console', body)
  await fn(...Object.values(globals), { log: (v: unknown) => logged.push(v) })
  return logged
}

describe('quoting helpers', () => {
  it('quotes for POSIX shells and JS', () => {
    expect(shellQuote('plain-1.2/x')).toBe('plain-1.2/x')
    expect(shellQuote("it's here")).toBe(`'it'\\''s here'`)
    expect(jsString("a'b\\c\nd ")).toBe(`'a\\'b\\\\c\\nd\\u2028'`)
  })
})

describe('generateCode (text)', () => {
  it('cURL: method, headers, basic auth, body and options', () => {
    const code = generateCode('curl', {
      ...jsonPost(),
      options: { validateSSL: false, followRedirects: true, maxRedirects: 5, timeoutMs: 1500 }
    })
    expect(code).toBe(
      [
        'curl -X POST https://api.test/users',
        `-H 'Content-Type: application/json'`,
        `-H 'X-Quote: it'\\''s'`,
        '-u me:p@ss',
        `--data-raw '{"name":"Hachi","n":1,"ok":true,"none":null}'`,
        '--insecure',
        '-L --max-redirs 5',
        '--max-time 1.5'
      ].join(' \\\n  ')
    )
    expect(
      generateCode('curl', base({ options: { ...base().options, followRedirects: false } }))
    ).toBe(`curl 'https://api.test/users?q=1'`)
    expect(generateCode('curl', base({ method: 'HEAD' }))).toMatch(/^curl --head /)
  })

  it('cURL: urlencoded and multipart fields', () => {
    const urlencoded = generateCode(
      'curl',
      base({ method: 'POST', body: { kind: 'urlencoded', fields: [['a b', 'c&d']] } })
    )
    expect(urlencoded).toContain(`--data-urlencode 'a b=c&d'`)
    const form = generateCode(
      'curl',
      base({
        method: 'POST',
        body: {
          kind: 'formData',
          fields: [
            { type: 'text', key: 'title', value: '@not-a-file' },
            { type: 'file', key: 'file', path: '/tmp/my "cat".png' }
          ]
        }
      })
    )
    expect(form).toContain('--form-string title=@not-a-file')
    expect(form).toContain(`-F 'file=@"/tmp/my \\"cat\\".png"'`)
  })

  it('fetch / axios: JSON bodies become object literals; big integers stay text', () => {
    const fetchCode = generateCode('fetch', jsonPost())
    expect(fetchCode).toContain("'Authorization': 'Basic ' + btoa('me:p@ss')")
    expect(fetchCode).toContain('body: JSON.stringify({\n    "name": "Hachi",')
    const axiosCode = generateCode('axios', jsonPost())
    expect(axiosCode).toContain("auth: { username: 'me', password: 'p@ss' }")
    expect(axiosCode).toContain('validateStatus: () => true')
    const big = generateCode(
      'fetch',
      base({
        method: 'POST',
        body: { kind: 'text', text: '{"id":12345678901234567890}', json: true }
      })
    )
    expect(big).toContain(`body: '{"id":12345678901234567890}'`)
  })

  it('Python: payload literal, auth tuple, options', () => {
    const code = generateCode('python', {
      ...jsonPost(),
      options: { validateSSL: false, followRedirects: false, maxRedirects: 3, timeoutMs: 2000 }
    })
    expect(code).toContain(
      'payload = {\n    "name": "Hachi",\n    "n": 1,\n    "ok": True,\n    "none": None\n}'
    )
    expect(code).toContain('json=payload')
    expect(code).toContain('auth=("me", "p@ss")')
    expect(code).toContain('verify=False')
    expect(code).toContain('allow_redirects=False')
    expect(code).toContain('timeout=2')
  })

  it('joins repeated headers (cookies with "; ")', () => {
    const code = generateCode(
      'python',
      base({
        headers: [
          ['Cookie', 'a=1'],
          ['cookie', 'b=2'],
          ['X-A', '1'],
          ['x-a', '2']
        ]
      })
    )
    expect(code).toContain('"Cookie": "a=1; b=2"')
    expect(code).toContain('"X-A": "1, 2"')
  })
})

describe('generated code runs', () => {
  let server: TestServer
  let tmp: string
  beforeAll(async () => {
    server = await startHttpServer()
    tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-codegen-'))
  })
  afterAll(async () => {
    await server.close()
    await rm(tmp, { recursive: true, force: true })
  })

  const echoed = (raw: unknown) =>
    (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      method: string
      url: string
      headers: Record<string, string>
      body: string
    }

  it('cURL command sends what Hachi would send', async () => {
    const file = path.join(tmp, "up 'load'.txt")
    await writeFile(file, 'file-content')
    const json = generateCode('curl', jsonPost(`${server.url}/echo?x=1`))
    const out = echoed((await run('sh', ['-c', json])).stdout)
    expect(out.method).toBe('POST')
    expect(out.url).toBe('/echo?x=1')
    expect(out.headers['x-quote']).toBe("it's")
    expect(out.headers.authorization).toBe(`Basic ${Buffer.from('me:p@ss').toString('base64')}`)
    expect(JSON.parse(out.body)).toEqual({ name: 'Hachi', n: 1, ok: true, none: null })

    const form = generateCode(
      'curl',
      base({
        method: 'POST',
        url: `${server.url}/echo`,
        body: {
          kind: 'formData',
          fields: [
            { type: 'text', key: 'title', value: '@literal' },
            { type: 'file', key: 'file', path: file }
          ]
        }
      })
    )
    const formOut = echoed((await run('sh', ['-c', form])).stdout)
    expect(formOut.body).toContain('@literal')
    expect(formOut.body).toContain('file-content')
    expect(formOut.body).toContain(`filename="up 'load'.txt"`)
  })

  it('fetch code sends JSON, urlencoded and multipart bodies', async () => {
    const json = await runJs(generateCode('fetch', jsonPost(`${server.url}/echo`)), { fetch })
    const out = echoed(json[1])
    expect(out.headers['content-type']).toBe('application/json')
    expect(JSON.parse(out.body)).toEqual({ name: 'Hachi', n: 1, ok: true, none: null })

    const urlencoded = await runJs(
      generateCode(
        'fetch',
        base({
          method: 'POST',
          url: `${server.url}/echo`,
          headers: [['Content-Type', 'application/x-www-form-urlencoded']],
          body: {
            kind: 'urlencoded',
            fields: [
              ['a', '1'],
              ['a', '2 3']
            ]
          }
        })
      ),
      { fetch }
    )
    expect(echoed(urlencoded[1]).body).toBe('a=1&a=2+3')

    const file = path.join(tmp, 'pic.bin')
    await writeFile(file, 'binary!')
    const multipart = await runJs(
      generateCode(
        'fetch',
        base({
          method: 'PUT',
          url: `${server.url}/echo`,
          body: { kind: 'formData', fields: [{ type: 'file', key: 'f', path: file }] }
        })
      ),
      { fetch, openAsBlob }
    )
    expect(echoed(multipart[1]).body).toContain('binary!')
  })

  it('axios code is valid JavaScript', () => {
    const body = generateCode('axios', jsonPost())
      .split('\n')
      .filter((l) => !l.startsWith('import '))
      .join('\n')
    expect(() => new AsyncFunction('axios', 'https', 'console', body)).not.toThrow()
  })

  const python = spawnSync('python3', ['--version']).status === 0
  it.runIf(python)('Python code is valid Python', () => {
    for (const request of [
      jsonPost(),
      base({
        method: 'POST',
        body: {
          kind: 'urlencoded',
          fields: [
            ['a', '1'],
            ['a', '2']
          ]
        }
      }),
      base({
        method: 'POST',
        body: {
          kind: 'formData',
          fields: [
            { type: 'text', key: 't', value: 'x' },
            { type: 'file', key: 'f', path: '/tmp/a "b".png' }
          ]
        }
      }),
      base({ method: 'POST', body: { kind: 'text', text: 'line1\nline2 "q"', json: false } })
    ]) {
      const check = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
        input: generateCode('python', request)
      })
      expect(check.stderr.toString()).toBe('')
      expect(check.status).toBe(0)
    }
  })
})
