import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { proxySettingsSchema } from '@shared/schemas/app-config'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { workspaceSettingsSchema } from '@shared/schemas/workspace'
import { parseFileVariable, VariableResolver } from '@shared/variables'
import { resolveInherited } from './build-request'
import { isInside, loadFileVariables, resolveFilePath } from './file-variables'
import { HttpService } from './http-service'
import { startHttpServer, type TestServer } from './test-servers'

let root: string
let outside: string
let server: TestServer
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'hachi-ws-'))
  outside = await mkdtemp(path.join(os.tmpdir(), 'hachi-out-'))
  await mkdir(path.join(root, 'files'))
  await writeFile(path.join(root, 'files', 'img.bin'), Buffer.from([0, 1, 2, 250, 255]))
  await writeFile(path.join(outside, 'secret.txt'), 'top secret')
  server = await startHttpServer()
})
afterEach(async () => {
  server.close()
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('{{$file:base64:…}} (decision 134)', () => {
  it('parses the variable', () => {
    expect(parseFileVariable('$file:base64:/a b/c.jpg')).toEqual({
      format: 'base64',
      path: '/a b/c.jpg',
      supported: true
    })
    expect(parseFileVariable('$file:hex:x')?.supported).toBe(false)
    expect(parseFileVariable('$file:base64:')).toBeNull()
    expect(parseFileVariable('token')).toBeNull()
    // Without contents the token stays as it is and is not "unresolved" (generated code).
    const r = new VariableResolver(new Map())
    expect(r.resolve('{{$file:base64:a.jpg}}')).toBe('{{$file:base64:a.jpg}}')
    expect([...r.unresolved]).toEqual([])
  })

  it('resolves paths: relative = Workspace, ~ = home', () => {
    expect(resolveFilePath('files/a.jpg', root)).toBe(path.join(root, 'files', 'a.jpg'))
    expect(resolveFilePath('~/x.jpg', root)).toBe(path.join(os.homedir(), 'x.jpg'))
    expect(resolveFilePath('rel.jpg', null)).toBeNull()
    expect(isInside(root, path.join(root, 'files', 'a.jpg'))).toBe(true)
    expect(isInside(root, path.join(root, '..', 'other'))).toBe(false)
  })

  it('reads files inside the Workspace; outside ones need the trust', async () => {
    const inside = await loadFileVariables(['$file:base64:files/img.bin'], {
      root,
      trustedOutside: false
    })
    expect(inside).toEqual({
      ok: true,
      files: new Map([['$file:base64:files/img.bin', 'AAEC+v8=']])
    })
    const abs = path.join(outside, 'secret.txt')
    const refused = await loadFileVariables([`$file:base64:${abs}`], {
      root,
      trustedOutside: false
    })
    expect(refused).toMatchObject({ ok: false, code: 'FILE_ACCESS', untrusted: [abs] })
    const allowed = await loadFileVariables([`$file:base64:${abs}`], { root, trustedOutside: true })
    expect(allowed.ok && allowed.files.get(`$file:base64:${abs}`)).toBe(
      Buffer.from('top secret').toString('base64')
    )
    expect(
      await loadFileVariables(['$file:base64:files/none.jpg'], { root, trustedOutside: true })
    ).toMatchObject({ ok: false, code: 'FILE_NOT_FOUND' })
    expect(
      await loadFileVariables(['$file:hex:files/img.bin'], { root, trustedOutside: true })
    ).toMatchObject({ ok: false, code: 'FILE_ACCESS' })
  })

  it('sends the file as base64 in the body, and reports untrusted files', async () => {
    let trusted = false
    const http = new HttpService({
      getContainerChain: async () => [],
      resolveInherited,
      getVariableLayers: async () => [],
      getWorkspaceSettings: async () => workspaceSettingsSchema.parse({}),
      getProxySettings: () => proxySettingsSchema.parse({}),
      resolveSystemProxy: async () => 'DIRECT',
      userAgent: 'Hachi/test',
      fileAccess: () => ({ root, trustedOutside: trusted })
    })
    const send = (json: string) =>
      http.send({
        runId: crypto.randomUUID(),
        parentId: null,
        environmentId: null,
        request: httpRequestSchema.parse({
          version: 1,
          id: 'r',
          type: 'http',
          name: 'R',
          method: 'POST',
          url: `${server.url}/echo`,
          body: { mode: 'json', json }
        })
      })
    const ok = await send('{"img":"{{$file:base64:files/img.bin}}"}')
    if (ok.kind !== 'response' || ok.body.kind !== 'text') throw new Error(JSON.stringify(ok))
    expect(JSON.parse(ok.body.text).body).toBe('{"img":"AAEC+v8="}')

    const abs = path.join(outside, 'secret.txt')
    // A path with backslashes (Windows) is found as written, not JSON-escaped.
    const backslashed = await send('{"s":"{{$file:base64:files\\img.bin}}"}')
    if (process.platform === 'win32') {
      if (backslashed.kind !== 'response' || backslashed.body.kind !== 'text') throw new Error()
      expect(JSON.parse(backslashed.body.text).body).toBe('{"s":"AAEC+v8="}')
    } else {
      expect(backslashed).toMatchObject({ kind: 'error', code: 'FILE_NOT_FOUND' })
    }
    const refused = await send(`{"s":"{{$file:base64:${abs}}}"}`)
    expect(refused).toMatchObject({ kind: 'error', code: 'FILE_ACCESS', untrustedFiles: [abs] })
    trusted = true
    expect((await send(`{"s":"{{$file:base64:${abs}}}"}`)).kind).toBe('response')
  })
})
