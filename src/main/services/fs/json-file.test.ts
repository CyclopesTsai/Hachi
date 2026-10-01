import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { VersionedFormat } from '@shared/schemas/versioned'
import { readJsonFile, readVersionedJson } from './json-file'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-json-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const format: VersionedFormat<z.ZodObject<{ version: z.ZodLiteral<2>; title: z.ZodString }>> = {
  name: 'thing.json',
  currentVersion: 2,
  schema: z.object({ version: z.literal(2), title: z.string() }),
  migrations: {
    1: ({ name, ...rest }) => ({ ...rest, title: name })
  }
}

describe('readJsonFile', () => {
  it('throws NOT_FOUND for a missing file', async () => {
    await expect(readJsonFile(path.join(dir, 'nope.json'))).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('throws INVALID_FILE for malformed JSON', async () => {
    const file = path.join(dir, 'bad.json')
    await writeFile(file, '{ "version": 1, ')
    await expect(readJsonFile(file)).rejects.toMatchObject({ code: 'INVALID_FILE' })
  })

  it('accepts a UTF-8 BOM', async () => {
    const file = path.join(dir, 'bom.json')
    await writeFile(file, '\uFEFF{"version":1}')
    expect(await readJsonFile(file)).toEqual({ version: 1 })
  })
})

describe('readVersionedJson', () => {
  it('runs migrations up to the current version', async () => {
    const file = path.join(dir, 'old.json')
    await writeFile(file, JSON.stringify({ version: 1, name: 'legacy' }))
    expect(await readVersionedJson(file, format)).toEqual({ version: 2, title: 'legacy' })
  })

  it('rejects files from a newer version', async () => {
    const file = path.join(dir, 'new.json')
    await writeFile(file, JSON.stringify({ version: 3, title: 'x' }))
    await expect(readVersionedJson(file, format)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION'
    })
  })

  it('rejects files without a version', async () => {
    const file = path.join(dir, 'nover.json')
    await writeFile(file, JSON.stringify({ title: 'x' }))
    await expect(readVersionedJson(file, format)).rejects.toMatchObject({ code: 'INVALID_FILE' })
  })

  it('reports the failing field on schema mismatch', async () => {
    const file = path.join(dir, 'wrong.json')
    await writeFile(file, JSON.stringify({ version: 2, title: 42 }))
    await expect(readVersionedJson(file, format)).rejects.toThrow(/at "title"/)
  })
})
