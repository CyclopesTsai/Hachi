import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceWatcher, classifyPath, isIgnoredPath, type ChangeArea } from './workspace-watcher'

describe('path helpers', () => {
  const root = path.join(path.sep, 'ws')
  it('classifies changed paths', () => {
    expect(classifyPath(root, path.join(root, 'collections', 'a', 'b.json'))).toBe('collections')
    expect(classifyPath(root, path.join(root, 'environments', 'dev.json'))).toBe('environments')
    expect(classifyPath(root, path.join(root, 'workspace.json'))).toBe('workspace')
    expect(classifyPath(root, path.join(root, 'history.json'))).toBe('other')
  })

  it('ignores VCS folders and atomic-write temp files', () => {
    expect(isIgnoredPath(root, path.join(root, '.git', 'index'))).toBe(true)
    expect(isIgnoredPath(root, path.join(root, 'collections', '.x.json.1.ab.tmp'))).toBe(true)
    expect(isIgnoredPath(root, path.join(root, 'collections', 'x.json'))).toBe(false)
    expect(isIgnoredPath(root, root)).toBe(false)
  })
})

describe('WorkspaceWatcher', () => {
  let dir: string
  let batches: Set<ChangeArea>[]
  let watcher: WorkspaceWatcher

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-watch-'))
    await mkdir(path.join(dir, 'collections'))
    batches = []
    watcher = new WorkspaceWatcher((areas) => batches.push(areas), 100)
  })

  afterEach(async () => {
    await watcher.stop()
    await rm(dir, { recursive: true, force: true })
  })

  async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 25))
    }
  }

  it('batches a burst of changes into one notification', async () => {
    await watcher.start(dir)
    await writeFile(path.join(dir, 'collections', 'a.json'), '{}')
    await writeFile(path.join(dir, 'collections', 'b.json'), '{}')
    await writeFile(path.join(dir, 'workspace.json'), '{}')
    await waitFor(() => batches.length > 0)
    await new Promise((r) => setTimeout(r, 300))
    expect(batches).toHaveLength(1)
    expect([...batches[0]!].sort()).toEqual(['collections', 'workspace'])
  })

  it('does not report temp files or .git changes', async () => {
    await watcher.start(dir)
    await mkdir(path.join(dir, '.git'))
    await writeFile(path.join(dir, '.git', 'HEAD'), 'x')
    await writeFile(path.join(dir, 'collections', '.a.json.1.ff.tmp'), '{}')
    await new Promise((r) => setTimeout(r, 500))
    expect(batches).toEqual([])
  })

  it('stops reporting after stop()', async () => {
    await watcher.start(dir)
    await watcher.stop()
    await writeFile(path.join(dir, 'collections', 'a.json'), '{}')
    await new Promise((r) => setTimeout(r, 400))
    expect(batches).toEqual([])
  })
})
