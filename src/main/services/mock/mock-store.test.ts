import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockStore } from './mock-store'

let root: string
let trashed: string[]
let store: MockStore
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'hachi-mock-'))
  trashed = []
  store = new MockStore(async (p) => {
    trashed.push(path.basename(p))
    await rm(p)
  })
  store.open(root)
})
afterEach(() => rm(root, { recursive: true, force: true }))

const files = () => readdir(path.join(root, 'mocks'))

describe('MockStore (decision 133)', () => {
  it('creates, saves, renames, duplicates and deletes mocks/<slug>.json', async () => {
    const created = await store.create('Shop API')
    expect(created).toMatchObject({
      version: 1,
      name: 'Shop API',
      port: 4010,
      lan: false,
      cors: true
    })
    expect(await files()).toEqual(['shop-api.json'])

    const saved = await store.save(created.id, {
      ...created,
      port: 5000,
      routes: [{ id: 'r', method: 'GET', path: '/x', body: 'hi' } as never]
    })
    expect(saved.routes[0]).toMatchObject({ status: 200, enabled: true, delayMs: 0 })
    const onDisk = JSON.parse(await readFile(path.join(root, 'mocks', 'shop-api.json'), 'utf8'))
    expect(onDisk.port).toBe(5000)

    await store.rename(created.id, 'Store')
    expect(await files()).toEqual(['store.json'])
    const copy = await store.duplicate(created.id)
    expect(copy.name).toBe('Store copy')
    expect(copy.id).not.toBe(created.id)
    expect((await store.list()).map((m) => m.name)).toEqual(['Store', 'Store copy'])

    await store.delete(copy.id)
    expect(trashed).toEqual(['store-copy.json'])
    expect((await store.list()).map((m) => m.name)).toEqual(['Store'])
  })

  it('lists unreadable files and gives copied files their own id', async () => {
    const a = await store.create('A')
    const raw = await readFile(path.join(root, 'mocks', 'a.json'), 'utf8')
    await writeFile(path.join(root, 'mocks', 'b.json'), raw)
    await writeFile(path.join(root, 'mocks', 'broken.json'), '{')
    const list = await store.list()
    expect(list).toHaveLength(3)
    expect(new Set(list.map((m) => m.id)).size).toBe(3)
    expect(list.find((m) => m.name === 'broken.json')?.error).toBeTruthy()
    expect(list.some((m) => m.id === a.id)).toBe(true)
  })

  it('lists nothing without a Workspace', async () => {
    store.open(null)
    expect(await store.list()).toEqual([])
  })
})
