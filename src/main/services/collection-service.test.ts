import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeNode, WorkspaceTree } from '@shared/tree'
import { CollectionService, applyOrder } from './collection-service'
import { ConfigService } from './config-service'
import { WorkspaceService } from './workspace-service'

let tmp: string
let root: string
let trashed: string[]
let service: CollectionService
let counter: number

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
}

const col = (rel: string) => path.join(root, 'collections', rel)

type Shape = string | [string, Shape[]]

/** Compact view of the tree: names with nesting, e.g. ["API", ["Users", ["Get"]]]. */
function shape(tree: WorkspaceTree): Shape[] {
  const visit = (n: TreeNode): Shape => ('children' in n ? [n.name, n.children.map(visit)] : n.name)
  return tree.collections.map(visit)
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-col-'))
  const config = new ConfigService(path.join(tmp, 'app-config.json'), undefined, () => undefined)
  await config.load()
  const ws = await new WorkspaceService(config).create({ name: 'WS', parentDir: tmp })
  root = ws.path
  trashed = []
  counter = 0
  service = new CollectionService(
    async (p) => {
      trashed.push(p)
      await rm(p, { recursive: true, force: true })
    },
    () => undefined,
    () => `id-${++counter}`
  )
  await service.open(root, ws.id)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('create', () => {
  it('creates collections, folders and requests with slug file names', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'Users API' })
    const f = await service.create({ parentId: c.id, kind: 'folder', name: 'Admin Tools' })
    await service.create({
      parentId: f.id,
      kind: 'request',
      name: 'Get Users',
      requestType: 'http'
    })
    const { tree } = await service.create({
      parentId: c.id,
      kind: 'request',
      name: '即時 通知',
      requestType: 'websocket'
    })

    expect(shape(tree)).toEqual([['Users API', [['Admin Tools', ['Get Users']], '即時 通知']]])
    expect(await readJson(col('users-api/collection.json'))).toMatchObject({
      version: 1,
      id: c.id,
      name: 'Users API',
      headers: [],
      auth: { type: 'none' },
      variables: [],
      order: [f.id, 'id-4']
    })
    expect(await readJson(col('users-api/admin-tools/folder.json'))).toMatchObject({
      name: 'Admin Tools',
      auth: { type: 'inherit' }
    })
    expect(await readJson(col('users-api/admin-tools/get-users.json'))).toMatchObject({
      version: 1,
      type: 'http',
      name: 'Get Users',
      method: 'GET'
    })
    expect(await readJson(col('users-api/即時-通知.json'))).toMatchObject({ type: 'websocket' })
    expect(await readJson(path.join(root, 'workspace.json'))).toMatchObject({
      collectionOrder: [c.id]
    })
  })

  it('adds a numeric suffix when the file name is taken (case-insensitively)', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'A' })
    await service.create({ parentId: c.id, kind: 'request', name: 'Ping', requestType: 'http' })
    await service.create({ parentId: c.id, kind: 'request', name: 'PING', requestType: 'http' })
    await service.create({ parentId: c.id, kind: 'request', name: 'folder', requestType: 'http' })
    expect((await readdir(col('a'))).sort()).toEqual(
      ['collection.json', 'folder-2.json', 'ping-2.json', 'ping.json'].sort()
    )
  })

  it('rejects folders at the top level and children of requests', async () => {
    await expect(
      service.create({ parentId: null, kind: 'folder', name: 'x' })
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const r = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'R',
      requestType: 'http'
    })
    await expect(
      service.create({ parentId: r.id, kind: 'folder', name: 'x' })
    ).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
    await expect(
      service.create({ parentId: 'nope', kind: 'folder', name: 'x' })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('fails with NO_WORKSPACE when nothing is open', async () => {
    await service.open(null)
    await expect(
      service.create({ parentId: null, kind: 'collection', name: 'x' })
    ).rejects.toMatchObject({ code: 'NO_WORKSPACE' })
  })
})

describe('rename', () => {
  it('updates the name and renames the file, keeping the id and other fields', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const r = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'Old',
      requestType: 'http'
    })
    const file = col('c/old.json')
    await writeFile(file, JSON.stringify({ ...(await readJson(file)), custom: 'keep me' }))

    const tree = await service.rename(r.id, 'New Name')
    expect(shape(tree)).toEqual([['C', ['New Name']]])
    expect(await readdir(col('c'))).toContain('new-name.json')
    expect(await readJson(col('c/new-name.json'))).toMatchObject({
      id: r.id,
      name: 'New Name',
      custom: 'keep me'
    })
  })

  it('renames folders on disk and keeps their children', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const f = await service.create({ parentId: c.id, kind: 'folder', name: 'F' })
    await service.create({ parentId: f.id, kind: 'request', name: 'R', requestType: 'http' })
    const tree = await service.rename(f.id, 'Renamed')
    expect(shape(tree)).toEqual([['C', [['Renamed', ['R']]]]])
    expect(await readdir(col('c/renamed'))).toContain('r.json')
  })

  it('keeps the file name when only the case changes', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const r = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'abc',
      requestType: 'http'
    })
    await service.rename(r.id, 'ABC')
    expect((await readdir(col('c'))).sort()).toEqual(['abc.json', 'collection.json'])
  })
})

describe('duplicate', () => {
  it('copies a request next to the original with a new id and "copy" name', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const a = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'A',
      requestType: 'http'
    })
    await service.create({ parentId: c.id, kind: 'request', name: 'B', requestType: 'http' })

    const first = await service.duplicate(a.id)
    const second = await service.duplicate(a.id)
    expect(shape(second.tree)).toEqual([['C', ['A', 'A copy 2', 'A copy', 'B']]])
    expect(first.id).not.toBe(a.id)
    expect(await readJson(col('c/a-copy.json'))).toMatchObject({ id: first.id, name: 'A copy' })
  })

  it('deep-copies folders with new ids for every item and remapped order', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const f = await service.create({ parentId: c.id, kind: 'folder', name: 'F' })
    const r1 = await service.create({
      parentId: f.id,
      kind: 'request',
      name: 'One',
      requestType: 'http'
    })
    await service.create({ parentId: f.id, kind: 'request', name: 'Two', requestType: 'http' })
    await service.move(r1.id, f.id, 1) // F: Two, One

    const { id, tree } = await service.duplicate(f.id)
    expect(shape(tree)).toEqual([
      [
        'C',
        [
          ['F', ['Two', 'One']],
          ['F copy', ['Two', 'One']]
        ]
      ]
    ])
    const copy = await readJson(col('c/f-copy/folder.json'))
    const ids = [id, ...(copy.order as string[])]
    const originals = [f.id, r1.id]
    for (const original of originals) expect(ids).not.toContain(original)
    expect(new Set(ids).size).toBe(3)
  })

  it('duplicates whole collections', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    await service.create({ parentId: c.id, kind: 'request', name: 'R', requestType: 'websocket' })
    const { tree } = await service.duplicate(c.id)
    expect(shape(tree)).toEqual([
      ['C', ['R']],
      ['C copy', ['R']]
    ])
  })
})

describe('delete', () => {
  it('moves the item to the trash and removes it from the parent order', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const f = await service.create({ parentId: c.id, kind: 'folder', name: 'F' })
    await service.create({ parentId: f.id, kind: 'request', name: 'R', requestType: 'http' })
    const tree = await service.delete(f.id)
    expect(shape(tree)).toEqual([['C', []]])
    expect(trashed).toEqual([col('c/f')])
    expect((await readJson(col('c/collection.json'))).order).toEqual([])
  })

  it('can delete an unreadable item', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    await writeFile(col('c/broken.json'), '{ nope')
    const tree = await service.refresh()
    const broken = tree.collections[0]?.children[0]
    expect(broken).toMatchObject({ name: 'broken', error: expect.any(String) })
    await service.delete(broken!.id)
    expect(trashed).toEqual([col('c/broken.json')])
    expect(c.id).toBeTruthy()
  })
})

describe('move', () => {
  it('reorders siblings', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const a = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'A',
      requestType: 'http'
    })
    await service.create({ parentId: c.id, kind: 'request', name: 'B', requestType: 'http' })
    await service.create({ parentId: c.id, kind: 'request', name: 'C', requestType: 'http' })
    expect(shape(await service.move(a.id, c.id, 2))).toEqual([['C', ['B', 'C', 'A']]])
    expect(shape(await service.move(a.id, c.id, 0))).toEqual([['C', ['A', 'B', 'C']]])
  })

  it('reorders collections', async () => {
    const one = await service.create({ parentId: null, kind: 'collection', name: 'One' })
    await service.create({ parentId: null, kind: 'collection', name: 'Two' })
    expect(shape(await service.move(one.id, null, 1))).toEqual([
      ['Two', []],
      ['One', []]
    ])
  })

  it('moves items between folders and collections, renaming on clashes', async () => {
    const c1 = await service.create({ parentId: null, kind: 'collection', name: 'C1' })
    const c2 = await service.create({ parentId: null, kind: 'collection', name: 'C2' })
    const r = await service.create({
      parentId: c1.id,
      kind: 'request',
      name: 'R',
      requestType: 'http'
    })
    await service.create({ parentId: c2.id, kind: 'request', name: 'R', requestType: 'http' })

    const tree = await service.move(r.id, c2.id, 0)
    expect(shape(tree)).toEqual([
      ['C1', []],
      ['C2', ['R', 'R']]
    ])
    expect((await readdir(col('c2'))).sort()).toEqual(['collection.json', 'r-2.json', 'r.json'])
    expect((await readJson(col('c1/collection.json'))).order).toEqual([])
    expect((await readJson(col('c2/collection.json'))).order).toEqual([r.id, 'id-4'])
  })

  it('refuses to move a folder into itself or a descendant', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const f = await service.create({ parentId: c.id, kind: 'folder', name: 'F' })
    const inner = await service.create({ parentId: f.id, kind: 'folder', name: 'Inner' })
    await expect(service.move(f.id, f.id, 0)).rejects.toMatchObject({ code: 'INVALID_OPERATION' })
    await expect(service.move(f.id, inner.id, 0)).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
  })

  it('refuses invalid parents', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const r = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'R',
      requestType: 'http'
    })
    const other = await service.create({ parentId: null, kind: 'collection', name: 'D' })
    await expect(service.move(r.id, null, 0)).rejects.toMatchObject({ code: 'INVALID_OPERATION' })
    await expect(service.move(other.id, c.id, 0)).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
  })
})

describe('scanning files changed outside Hachi', () => {
  it('lists items missing from the order array last, by name', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    await service.create({ parentId: c.id, kind: 'request', name: 'Z', requestType: 'http' })
    const raw = { version: 1, type: 'http', name: 'Added by git' }
    await writeFile(col('c/b.json'), JSON.stringify({ ...raw, id: 'ext-b', name: 'B ext' }))
    await writeFile(col('c/a.json'), JSON.stringify({ ...raw, id: 'ext-a', name: 'A ext' }))
    expect(shape(await service.refresh())).toEqual([['C', ['Z', 'A ext', 'B ext']]])
  })

  it('adopts plain folders by writing their metadata file', async () => {
    await service.create({ parentId: null, kind: 'collection', name: 'C' })
    await mkdir(col('c/manual'))
    await mkdir(col('loose'))
    expect(shape(await service.refresh())).toEqual([
      ['C', [['manual', []]]],
      ['loose', []]
    ])
    expect(await readJson(col('c/manual/folder.json'))).toMatchObject({
      version: 1,
      name: 'manual'
    })
    expect(await readJson(col('loose/collection.json'))).toMatchObject({
      version: 1,
      name: 'loose'
    })
  })

  it('assigns a new id to a file copied outside the app', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const r = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'R',
      requestType: 'http'
    })
    await writeFile(col('c/r-copy.json'), await readFile(col('c/r.json')))
    const tree = await service.refresh()
    const ids = tree.collections[0]!.children.map((n) => n.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain(r.id)
    const copyId = (await readJson(col('c/r-copy.json'))).id
    expect(ids).toContain(copyId)
  })

  it('flags invalid files instead of failing, and refuses to edit them', async () => {
    await service.create({ parentId: null, kind: 'collection', name: 'C' })
    await mkdir(col('bad'))
    await writeFile(col('bad/collection.json'), '{"version": 1}')
    await writeFile(
      col('c/new.json'),
      JSON.stringify({ version: 99, id: 'x', type: 'http', name: 'n' })
    )
    const tree = await service.refresh()
    const bad = tree.collections.find((c) => c.name === 'bad')!
    expect(bad.error).toMatch(/invalid/i)
    expect(tree.collections[0]!.children[0]!.error).toMatch(/newer/)
    await expect(service.rename(bad.id, 'x')).rejects.toMatchObject({ code: 'INVALID_FILE' })
  })

  it('ignores hidden and temp files', async () => {
    await service.create({ parentId: null, kind: 'collection', name: 'C' })
    await writeFile(col('c/.DS_Store'), '')
    await writeFile(col('c/.r.json.1.abc.tmp'), '{}')
    await mkdir(col('.git'))
    expect(shape(await service.refresh())).toEqual([['C', []]])
  })

  it('follows a rename done in Finder (same id, new location)', async () => {
    const c = await service.create({ parentId: null, kind: 'collection', name: 'C' })
    const r = await service.create({
      parentId: c.id,
      kind: 'request',
      name: 'R',
      requestType: 'http'
    })
    await rename(col('c/r.json'), col('c/moved.json'))
    await service.refresh()
    const tree = await service.rename(r.id, 'Renamed')
    expect(shape(tree)).toEqual([['C', ['Renamed']]])
  })
})

describe('notifications', () => {
  it('notifies listeners only when the tree actually changes', async () => {
    const listener = vi.fn()
    service.onChange(listener)
    await service.create({ parentId: null, kind: 'collection', name: 'C' })
    expect(listener).toHaveBeenCalledTimes(1)
    await service.refresh()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('applyOrder', () => {
  const n = (id: string, name: string) =>
    ({ kind: 'request', id, name, relPath: name, requestType: 'http' }) as const
  it('puts listed ids first in order, then the rest by name', () => {
    const result = applyOrder([n('1', 'b'), n('2', 'a'), n('3', 'c')], ['3', 'missing', '1'])
    expect(result.map((x) => x.id)).toEqual(['3', '1', '2'])
  })
})
