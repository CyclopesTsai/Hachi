import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTempFileName, writeFileAtomic, writeJsonAtomic } from './atomic-write'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-atomic-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('creates missing parent folders and writes the content', async () => {
    const file = path.join(dir, 'a', 'b', 'c.txt')
    await writeFileAtomic(file, 'hello')
    expect(await readFile(file, 'utf8')).toBe('hello')
  })

  it('replaces existing content and leaves no temp files behind', async () => {
    const file = path.join(dir, 'data.json')
    await writeFile(file, 'old')
    await writeFileAtomic(file, 'new')
    expect(await readFile(file, 'utf8')).toBe('new')
    expect(await readdir(dir)).toEqual(['data.json'])
  })

  it('applies concurrent writes to the same file in call order', async () => {
    const file = path.join(dir, 'race.txt')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, `v${i}`)))
    expect(await readFile(file, 'utf8')).toBe('v19')
    expect(await readdir(dir)).toEqual(['race.txt'])
  })

  it('cleans up the temp file and keeps the original when the rename fails', async () => {
    // Renaming a file onto an existing non-empty directory fails on every platform.
    const target = path.join(dir, 'target')
    await writeFileAtomic(path.join(target, 'inner.txt'), 'x')
    await expect(writeFileAtomic(target, 'data')).rejects.toThrow()
    expect((await readdir(dir)).filter(isTempFileName)).toEqual([])
    expect(await readFile(path.join(target, 'inner.txt'), 'utf8')).toBe('x')
  })

  it('keeps the queue usable after a failed write', async () => {
    const target = path.join(dir, 'target')
    await writeFileAtomic(path.join(target, 'inner.txt'), 'x')
    await expect(writeFileAtomic(target, 'data')).rejects.toThrow()
    const ok = path.join(dir, 'ok.txt')
    await writeFileAtomic(ok, 'fine')
    expect(await readFile(ok, 'utf8')).toBe('fine')
  })
})

describe('writeJsonAtomic', () => {
  it('writes pretty JSON with a trailing newline', async () => {
    const file = path.join(dir, 'x.json')
    await writeJsonAtomic(file, { version: 1, list: [1] })
    expect(await readFile(file, 'utf8')).toBe('{\n  "version": 1,\n  "list": [\n    1\n  ]\n}\n')
  })
})

describe('isTempFileName', () => {
  it('recognises temp files produced by atomic writes', () => {
    expect(isTempFileName('.workspace.json.123.abcdef.tmp')).toBe(true)
    expect(isTempFileName('workspace.json')).toBe(false)
    expect(isTempFileName('.gitignore')).toBe(false)
  })
})
