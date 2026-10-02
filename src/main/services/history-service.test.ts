import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HttpHistoryEntry } from '@shared/schemas/history'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { HistoryService } from './history-service'

let tmp: string
let wsA: string
let wsB: string
let limit: number
let clock: number
let service: HistoryService

const indexFile = () => path.join(tmp, 'userData', 'history-index.json')
const historyIds = async (ws: string) =>
  (
    JSON.parse(await readFile(path.join(ws, 'history.json'), 'utf8')) as {
      entries: { id: string }[]
    }
  ).entries.map((e) => e.id)

function entry(id: string): HttpHistoryEntry {
  clock += 1000
  return {
    id,
    type: 'http',
    sentAt: new Date(clock).toISOString(),
    requestId: null,
    environmentName: null,
    request: httpRequestSchema.parse({ version: 1, id: 'r', type: 'http', name: 'R' }),
    result: { kind: 'response', status: 200, statusText: 'OK', timeMs: 5, sizeBytes: 2 }
  }
}

function newService() {
  return new HistoryService(
    indexFile(),
    () => limit,
    () => new Date(0),
    () => undefined
  )
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-hist-'))
  wsA = path.join(tmp, 'A')
  wsB = path.join(tmp, 'B')
  for (const ws of [wsA, wsB]) {
    await mkdir(ws)
    await writeFile(path.join(ws, 'history.json'), '{"version":1,"entries":[]}')
  }
  limit = 3
  clock = 0
  service = newService()
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('HistoryService', () => {
  it('records newest first and reports usage', async () => {
    await service.add(wsA, entry('a1'))
    const usage = await service.add(wsA, entry('a2'))
    expect(usage).toEqual({ total: 2, max: 3, workspace: 2 })
    expect((await service.list(wsA)).map((e) => e.id)).toEqual(['a2', 'a1'])
  })

  it('shares one limit across Workspaces, removing the oldest anywhere', async () => {
    await service.add(wsA, entry('a1'))
    await service.add(wsB, entry('b1'))
    await service.add(wsA, entry('a2'))
    const usage = await service.add(wsB, entry('b2'))
    expect(usage).toEqual({ total: 3, max: 3, workspace: 2 })
    expect(await historyIds(wsA)).toEqual(['a2'])
    expect(await historyIds(wsB)).toEqual(['b2', 'b1'])
  })

  it('applies a lowered limit on demand', async () => {
    for (const id of ['a1', 'a2', 'a3']) await service.add(wsA, entry(id))
    limit = 1
    expect(await service.applyLimit(wsA)).toEqual({ total: 1, max: 1, workspace: 1 })
    expect(await historyIds(wsA)).toEqual(['a3'])
  })

  it('removes and clears entries of one Workspace', async () => {
    await service.add(wsA, entry('a1'))
    await service.add(wsA, entry('a2'))
    await service.add(wsB, entry('b1'))
    expect(await service.remove(wsA, 'a1')).toEqual({ total: 2, max: 3, workspace: 1 })
    expect(await service.clear(wsA)).toEqual({ total: 1, max: 3, workspace: 0 })
    expect(await historyIds(wsA)).toEqual([])
    expect(await historyIds(wsB)).toEqual(['b1'])
  })

  it('persists the index and rebuilds a Workspace from its file on sync', async () => {
    await service.add(wsA, entry('a1'))
    const reloaded = newService()
    await reloaded.load()
    expect(await reloaded.usage(wsA)).toEqual({ total: 1, max: 3, workspace: 1 })

    // Entries added to the file elsewhere (e.g. another computer syncing the folder).
    const file = JSON.parse(await readFile(path.join(wsB, 'history.json'), 'utf8'))
    file.entries = [entry('x2'), entry('x1')]
    await writeFile(path.join(wsB, 'history.json'), JSON.stringify(file))
    expect(await reloaded.sync(wsB)).toEqual({ total: 3, max: 3, workspace: 2 })
  })

  it('forgets Workspaces whose history file disappeared', async () => {
    await service.add(wsA, entry('a1'))
    await service.add(wsB, entry('b1'))
    await rm(wsB, { recursive: true })
    const reloaded = newService()
    await reloaded.load()
    expect(await reloaded.usage(wsA)).toEqual({ total: 1, max: 3, workspace: 1 })
  })

  it('evicts entries of a missing Workspace without failing', async () => {
    await service.add(wsB, entry('b1'))
    await rm(wsB, { recursive: true })
    for (const id of ['a1', 'a2', 'a3']) await service.add(wsA, entry(id))
    expect(await service.usage(wsA)).toEqual({ total: 3, max: 3, workspace: 3 })
  })

  it('moves a corrupt history file aside and keeps recording', async () => {
    await writeFile(path.join(wsA, 'history.json'), '{ broken')
    await service.add(wsA, entry('a1'))
    expect(await historyIds(wsA)).toEqual(['a1'])
    expect(
      await readFile(path.join(wsA, 'history.json.corrupt-1970-01-01T00-00-00-000Z'), 'utf8')
    ).toBe('{ broken')
  })

  it('starts over when the index is corrupt and skips unknown entry types in lists', async () => {
    await mkdir(path.dirname(indexFile()), { recursive: true })
    await writeFile(indexFile(), 'nope')
    const file = { version: 1, entries: [{ id: 'w', type: 'websocket', sentAt: 'x' }] }
    await writeFile(path.join(wsA, 'history.json'), JSON.stringify(file))
    expect(await service.sync(wsA)).toEqual({ total: 1, max: 3, workspace: 1 })
    expect(await service.list(wsA)).toEqual([])
    await service.add(wsA, entry('a1'))
    expect(await historyIds(wsA)).toEqual(['a1', 'w']) // the unknown entry is kept
  })
})
