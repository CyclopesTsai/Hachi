import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECENT_WORKSPACES } from '@shared/schemas/app-config'
import { APP_CONFIG_FILE, ConfigService } from './config-service'

let dir: string
let file: string
const fixedNow = () => new Date('2026-01-02T03:04:05.000Z')
const silent = () => undefined

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-config-'))
  file = path.join(dir, APP_CONFIG_FILE)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readDisk(): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'))
}

describe('ConfigService', () => {
  it('creates a default config file on first launch', async () => {
    const service = new ConfigService(file, fixedNow, silent)
    const config = await service.load()
    expect(config).toEqual({
      version: 1,
      theme: 'system',
      recentWorkspaces: [],
      lastWorkspacePath: null,
      window: null,
      proxy: {
        mode: 'none',
        url: '',
        bypass: ['localhost', '127.0.0.1', '::1'],
        username: '',
        password: ''
      },
      ui: { requestBodyWrap: false, responseBodyWrap: false }
    })
    expect(await readDisk()).toEqual(config)
  })

  it('fills in defaults for fields missing from an older file', async () => {
    await writeFile(file, JSON.stringify({ version: 1, theme: 'dark' }))
    const config = await new ConfigService(file, fixedNow, silent).load()
    expect(config.theme).toBe('dark')
    expect(config.recentWorkspaces).toEqual([])
  })

  it('backs up a corrupt file and starts from defaults', async () => {
    await writeFile(file, 'not json at all')
    const log = vi.fn()
    const config = await new ConfigService(file, fixedNow, log).load()
    expect(config.theme).toBe('system')
    const files = await readdir(dir)
    expect(files).toContain(APP_CONFIG_FILE)
    expect(files.some((f) => f.startsWith(`${APP_CONFIG_FILE}.corrupt-`))).toBe(true)
    expect(log).toHaveBeenCalledOnce()
  })

  it('backs up a file written by a newer Hachi instead of misreading it', async () => {
    await writeFile(file, JSON.stringify({ version: 99 }))
    await new ConfigService(file, fixedNow, silent).load()
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith(`${APP_CONFIG_FILE}.newer-`))).toBe(true)
  })

  it('persists updates and notifies listeners', async () => {
    const service = new ConfigService(file, fixedNow, silent)
    await service.load()
    const listener = vi.fn()
    service.onChange(listener)
    await service.setTheme('light')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }))
    expect(await readDisk()).toMatchObject({ theme: 'light' })
  })

  it('rejects invalid updates without touching disk', async () => {
    const service = new ConfigService(file, fixedNow, silent)
    await service.load()
    await expect(
      service.update((c) => {
        ;(c as { theme: string }).theme = 'neon'
      })
    ).rejects.toThrow()
    expect(service.get().theme).toBe('system')
    expect(await readDisk()).toMatchObject({ theme: 'system' })
  })

  it('returns copies so callers cannot mutate internal state', async () => {
    const service = new ConfigService(file, fixedNow, silent)
    await service.load()
    service.get().recentWorkspaces.push({ path: '/x', name: 'x', lastOpenedAt: '' })
    expect(service.get().recentWorkspaces).toEqual([])
  })

  describe('recent workspaces', () => {
    it('moves a re-opened workspace to the top without duplicates', async () => {
      const service = new ConfigService(file, fixedNow, silent)
      await service.load()
      await service.touchRecentWorkspace('/ws/a', 'A')
      await service.touchRecentWorkspace('/ws/b', 'B')
      await service.touchRecentWorkspace('/ws/a/', 'A2')
      const { recentWorkspaces, lastWorkspacePath } = service.get()
      expect(recentWorkspaces.map((r) => r.name)).toEqual(['A2', 'B'])
      expect(lastWorkspacePath).toBe(path.resolve('/ws/a'))
    })

    it(`keeps at most ${MAX_RECENT_WORKSPACES} entries`, async () => {
      const service = new ConfigService(file, fixedNow, silent)
      await service.load()
      for (let i = 0; i < MAX_RECENT_WORKSPACES + 3; i++) {
        await service.touchRecentWorkspace(`/ws/${i}`, `W${i}`)
      }
      const recent = service.get().recentWorkspaces
      expect(recent).toHaveLength(MAX_RECENT_WORKSPACES)
      expect(recent[0]?.name).toBe(`W${MAX_RECENT_WORKSPACES + 2}`)
    })

    it('clears lastWorkspacePath when that workspace is removed', async () => {
      const service = new ConfigService(file, fixedNow, silent)
      await service.load()
      await service.touchRecentWorkspace('/ws/a', 'A')
      await service.removeRecentWorkspace('/ws/a')
      expect(service.get()).toMatchObject({ recentWorkspaces: [], lastWorkspacePath: null })
    })
  })
})
