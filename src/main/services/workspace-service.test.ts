import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_GITIGNORE } from '@shared/schemas/workspace'
import { ConfigService } from './config-service'
import { WorkspaceService } from './workspace-service'

let root: string
let config: ConfigService
let service: WorkspaceService
const now = () => new Date('2026-01-02T03:04:05.000Z')

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'hachi-ws-'))
  config = new ConfigService(path.join(root, 'userData', 'app-config.json'), now, () => undefined)
  await config.load()
  service = new WorkspaceService(config, now)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('WorkspaceService.create', () => {
  it('creates the folder skeleton and opens it', async () => {
    const parent = path.join(root, 'Documents', 'Hachi')
    const listener = vi.fn()
    service.onChange(listener)

    const ws = await service.create({ name: '  My API  ', parentDir: parent })

    const dir = path.join(parent, 'My API')
    expect(ws).toMatchObject({ name: 'My API', path: dir })
    expect((await readdir(dir)).sort()).toEqual(
      ['.gitignore', 'collections', 'environments', 'history.json', 'workspace.json'].sort()
    )
    const file = JSON.parse(await readFile(path.join(dir, 'workspace.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(file).toMatchObject({
      version: 1,
      id: ws.id,
      name: 'My API',
      createdAt: '2026-01-02T03:04:05.000Z',
      settings: { timeoutMs: 30000, validateSSL: true },
      collectionOrder: []
    })
    expect(JSON.parse(await readFile(path.join(dir, 'history.json'), 'utf8'))).toEqual({
      version: 1,
      entries: []
    })
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe(WORKSPACE_GITIGNORE)
    expect(service.getCurrent()).toEqual(ws)
    expect(listener).toHaveBeenCalledWith(ws)
    expect(config.get()).toMatchObject({
      lastWorkspacePath: dir,
      recentWorkspaces: [{ path: dir, name: 'My API' }]
    })
  })

  it('sanitizes the folder name but keeps the display name', async () => {
    const ws = await service.create({ name: 'a/b: 測試?', parentDir: root })
    expect(path.basename(ws.path)).toBe('a-b- 測試-')
    expect(ws.name).toBe('a/b: 測試?')
  })

  it('accepts an existing empty folder', async () => {
    await mkdir(path.join(root, 'Empty'))
    await expect(service.create({ name: 'Empty', parentDir: root })).resolves.toBeTruthy()
  })

  it('refuses a non-empty folder', async () => {
    await mkdir(path.join(root, 'Busy'))
    await writeFile(path.join(root, 'Busy', 'notes.txt'), 'hi')
    await expect(service.create({ name: 'Busy', parentDir: root })).rejects.toMatchObject({
      code: 'DIR_NOT_EMPTY'
    })
  })

  it('refuses to overwrite an existing workspace', async () => {
    await service.create({ name: 'Dup', parentDir: root })
    await expect(service.create({ name: 'Dup', parentDir: root })).rejects.toMatchObject({
      code: 'ALREADY_EXISTS'
    })
  })
})

describe('WorkspaceService.open', () => {
  it('reports NOT_A_WORKSPACE for a plain folder', async () => {
    await mkdir(path.join(root, 'plain'))
    await expect(service.open(path.join(root, 'plain'))).rejects.toMatchObject({
      code: 'NOT_A_WORKSPACE'
    })
    expect(service.getCurrent()).toBeNull()
  })

  it('reports INVALID_FILE for a corrupt workspace.json', async () => {
    await mkdir(path.join(root, 'broken'))
    await writeFile(path.join(root, 'broken', 'workspace.json'), '{oops')
    await expect(service.open(path.join(root, 'broken'))).rejects.toMatchObject({
      code: 'INVALID_FILE'
    })
  })

  it('re-creates missing sub-folders', async () => {
    const ws = await service.create({ name: 'Heal', parentDir: root })
    await rm(path.join(ws.path, 'collections'), { recursive: true })
    await service.open(ws.path)
    expect(await readdir(ws.path)).toContain('collections')
  })

  it('switches the current workspace', async () => {
    const a = await service.create({ name: 'A', parentDir: root })
    const b = await service.create({ name: 'B', parentDir: root })
    expect(service.getCurrent()?.id).toBe(b.id)
    await service.open(a.path)
    expect(service.getCurrent()?.id).toBe(a.id)
    expect(config.get().recentWorkspaces.map((r) => r.name)).toEqual(['A', 'B'])
  })
})

describe('WorkspaceService.restoreLast / listRecent', () => {
  it('restores the last workspace in a fresh session', async () => {
    const ws = await service.create({ name: 'Last', parentDir: root })
    const next = new WorkspaceService(config, now)
    expect(await next.restoreLast()).toEqual(ws)
  })

  it('returns null when the last workspace was deleted, and flags it in the recent list', async () => {
    const ws = await service.create({ name: 'Gone', parentDir: root })
    await rm(ws.path, { recursive: true })
    const next = new WorkspaceService(config, now)
    expect(await next.restoreLast()).toBeNull()
    expect(await next.listRecent()).toEqual([
      expect.objectContaining({ path: ws.path, exists: false })
    ])
  })

  it('removes an entry from the recent list', async () => {
    const ws = await service.create({ name: 'R', parentDir: root })
    expect(await service.removeRecent(ws.path)).toEqual([])
  })
})

describe('WorkspaceService.rename / delete', () => {
  it('renames the display name only and updates the recent list', async () => {
    const ws = await service.create({ name: 'Before', parentDir: root })
    const listener = vi.fn()
    service.onChange(listener)
    const renamed = await service.rename('  After  ')
    expect(renamed).toEqual({ ...ws, name: 'After' })
    expect(path.basename(renamed.path)).toBe('Before')
    const file = JSON.parse(await readFile(path.join(ws.path, 'workspace.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(file).toMatchObject({ name: 'After', id: ws.id, version: 1 })
    expect(config.get().recentWorkspaces[0]?.name).toBe('After')
    expect(listener).toHaveBeenCalledWith(renamed)
  })

  it('picks up a name changed outside the app', async () => {
    const ws = await service.create({ name: 'Disk', parentDir: root })
    const file = path.join(ws.path, 'workspace.json')
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...raw, name: 'Edited' }))
    await service.reloadCurrent()
    expect(service.getCurrent()?.name).toBe('Edited')
  })

  it('moves the current Workspace to the trash, closes it and forgets it', async () => {
    const trashed: string[] = []
    const svc = new WorkspaceService(config, now, async (p) => {
      trashed.push(p)
      await rm(p, { recursive: true })
    })
    const ws = await svc.create({ name: 'Doomed', parentDir: root })
    const listener = vi.fn()
    svc.onChange(listener)
    expect(await svc.delete(ws.path)).toEqual([])
    expect(trashed).toEqual([ws.path])
    expect(svc.getCurrent()).toBeNull()
    expect(listener).toHaveBeenCalledWith(null)
    expect(config.get().lastWorkspacePath).toBeNull()
  })

  it('refuses to delete unknown folders or folders without workspace.json', async () => {
    const trash = vi.fn()
    const svc = new WorkspaceService(config, now, trash)
    await mkdir(path.join(root, 'random'))
    await expect(svc.delete(path.join(root, 'random'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const ws = await svc.create({ name: 'Known', parentDir: root })
    await rm(path.join(ws.path, 'workspace.json'))
    await expect(svc.delete(ws.path)).rejects.toMatchObject({ code: 'NOT_A_WORKSPACE' })
    expect(trash).not.toHaveBeenCalled()
  })

  it('requires an open Workspace to rename', async () => {
    await expect(service.rename('x')).rejects.toMatchObject({ code: 'NO_WORKSPACE' })
  })
})
