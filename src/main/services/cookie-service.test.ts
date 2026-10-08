import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CookieService } from './cookie-service'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-cookies-'))
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

describe('CookieService (decision 129)', () => {
  it('keeps one jar per Workspace in userData', async () => {
    const service = new CookieService(tmp)
    await service.open('ws-1')
    service.current()?.store('https://a.test/', ['a=1; Max-Age=3600'])
    expect(service.dirty()).toBe(true)
    await service.open('ws-2') // saves ws-1 first
    expect(service.current()?.list()).toEqual([])
    service.current()?.store('https://b.test/', ['b=2'])
    await service.flush()
    expect(service.dirty()).toBe(false)

    const file = JSON.parse(await readFile(path.join(tmp, 'cookies', 'ws-1.json'), 'utf8')) as {
      version: number
      cookies: { name: string }[]
    }
    expect(file.version).toBe(1)
    expect(file.cookies.map((c) => c.name)).toEqual(['a'])

    const again = new CookieService(tmp)
    await again.open('ws-2')
    expect(again.current()?.header('https://b.test/')).toBe('b=2')
    await again.open(null)
    expect(again.current()).toBeNull()
  })

  it('starts empty when the file is broken, and reports it', async () => {
    await mkdir(path.join(tmp, 'cookies'))
    await writeFile(path.join(tmp, 'cookies', 'w.json'), '{ nope')
    const errors: unknown[] = []
    const service = new CookieService(tmp, (e) => errors.push(e))
    await service.open('w')
    expect(service.current()?.list()).toEqual([])
    expect(errors).toHaveLength(1)
  })
})
