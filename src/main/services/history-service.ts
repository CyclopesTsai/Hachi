import { rename } from 'node:fs/promises'
import path from 'node:path'
import { isHachiError } from '@shared/errors'
import type { HistoryUsage } from '@shared/ipc/api'
import {
  HISTORY_INDEX_VERSION,
  emptyHistoryFile,
  historyFormat,
  historyIndexFormat,
  historyEntrySchema,
  type HistoryFile,
  type HistoryIndex,
  type HistoryIndexEntry,
  type HistoryEntry
} from '@shared/schemas/history'
import { WORKSPACE_LAYOUT } from '@shared/schemas/workspace'
import { updateJsonAtomic, writeJsonAtomic } from './fs/atomic-write'
import { readVersionedJson } from './fs/json-file'

function errorText(error: unknown): string {
  return isHachiError(error) ? error.message : String(error)
}

const byOldest = (a: HistoryIndexEntry, b: HistoryIndexEntry): number =>
  a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0

/**
 * Request history. Each Workspace keeps its own `history.json` (newest first), but
 * the entry limit is shared by all Workspaces: `<userData>/history-index.json` lists
 * every entry (Workspace path, id, time) so the oldest ones can be removed from
 * whichever Workspace holds them.
 */
export class HistoryService {
  private index: HistoryIndex | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly indexFile: string,
    private readonly getLimit: () => number,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (message: string) => void = console.warn
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Loads the index and drops entries of Workspaces whose history file is gone. */
  load(): Promise<void> {
    return this.run(async () => {
      const index = await this.requireIndex()
      const paths = [...new Set(index.entries.map((e) => e.workspacePath))]
      const missing = new Set<string>()
      for (const p of paths) {
        try {
          await readVersionedJson(this.historyFile(p), historyFormat)
        } catch (error) {
          if (isHachiError(error) && error.code === 'NOT_FOUND') missing.add(p)
        }
      }
      if (missing.size > 0) {
        index.entries = index.entries.filter((e) => !missing.has(e.workspacePath))
        await this.saveIndex()
      }
    })
  }

  /** Re-reads a Workspace's history file into the index (on open), then applies the limit. */
  sync(workspacePath: string): Promise<HistoryUsage> {
    const ws = path.resolve(workspacePath)
    return this.run(async () => {
      const file = await this.readFile(ws)
      const index = await this.requireIndex()
      index.entries = [
        ...index.entries.filter((e) => e.workspacePath !== ws),
        ...file.entries.map((e) => ({ workspacePath: ws, id: e.id, sentAt: e.sentAt }))
      ]
      await this.enforce()
      return this.usageOf(ws)
    })
  }

  list(workspacePath: string): Promise<HistoryEntry[]> {
    const ws = path.resolve(workspacePath)
    return this.run(async () => {
      const file = await this.readFile(ws)
      return file.entries.flatMap((raw) => {
        const parsed = historyEntrySchema.safeParse(raw)
        return parsed.success ? [parsed.data] : []
      })
    })
  }

  add(workspacePath: string, entry: HistoryEntry): Promise<HistoryUsage> {
    const ws = path.resolve(workspacePath)
    return this.run(async () => {
      await this.updateFile(ws, (file) => ({ ...file, entries: [entry, ...file.entries] }))
      ;(await this.requireIndex()).entries.push({
        workspacePath: ws,
        id: entry.id,
        sentAt: entry.sentAt
      })
      await this.enforce()
      return this.usageOf(ws)
    })
  }

  remove(workspacePath: string, id: string): Promise<HistoryUsage> {
    const ws = path.resolve(workspacePath)
    return this.run(async () => {
      await this.updateFile(ws, (file) => ({
        ...file,
        entries: file.entries.filter((e) => e.id !== id)
      }))
      const index = await this.requireIndex()
      index.entries = index.entries.filter((e) => !(e.workspacePath === ws && e.id === id))
      await this.saveIndex()
      return this.usageOf(ws)
    })
  }

  clear(workspacePath: string): Promise<HistoryUsage> {
    const ws = path.resolve(workspacePath)
    return this.run(async () => {
      await this.updateFile(ws, (file) => ({ ...file, entries: [] }))
      await this.dropWorkspace(ws)
      return this.usageOf(ws)
    })
  }

  /** Forgets a Workspace that was deleted (its files are already gone). */
  forget(workspacePath: string): Promise<void> {
    return this.run(() => this.dropWorkspace(path.resolve(workspacePath)))
  }

  /** Applies the current limit (after the setting changed). */
  applyLimit(workspacePath: string | null): Promise<HistoryUsage> {
    return this.run(async () => {
      await this.enforce()
      return this.usageOf(workspacePath ? path.resolve(workspacePath) : null)
    })
  }

  usage(workspacePath: string | null): Promise<HistoryUsage> {
    return this.run(async () => {
      await this.requireIndex()
      return this.usageOf(workspacePath ? path.resolve(workspacePath) : null)
    })
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private historyFile(ws: string): string {
    return path.join(ws, WORKSPACE_LAYOUT.historyFile)
  }

  private usageOf(ws: string | null): HistoryUsage {
    const entries = this.index?.entries ?? []
    return {
      total: entries.length,
      max: this.getLimit(),
      workspace: ws ? entries.filter((e) => e.workspacePath === ws).length : 0
    }
  }

  private async requireIndex(): Promise<HistoryIndex> {
    if (this.index) return this.index
    try {
      this.index = await readVersionedJson(this.indexFile, historyIndexFormat)
    } catch (error) {
      // The index can always be rebuilt from the Workspaces' files (sync on open).
      if (!(isHachiError(error) && error.code === 'NOT_FOUND')) {
        this.log(`[history] index unreadable, starting over: ${errorText(error)}`)
      }
      this.index = { version: HISTORY_INDEX_VERSION, entries: [] }
    }
    return this.index
  }

  private async saveIndex(): Promise<void> {
    await writeJsonAtomic(this.indexFile, await this.requireIndex())
    for (const listener of this.listeners) listener()
  }

  private async dropWorkspace(ws: string): Promise<void> {
    const index = await this.requireIndex()
    index.entries = index.entries.filter((e) => e.workspacePath !== ws)
    await this.saveIndex()
  }

  /**
   * Reads a Workspace's history. A missing file is empty; a corrupt one is moved
   * aside (history is disposable) so recording can continue.
   */
  private async readFile(ws: string): Promise<HistoryFile> {
    const file = this.historyFile(ws)
    try {
      return await readVersionedJson(file, historyFormat)
    } catch (error) {
      if (isHachiError(error) && error.code === 'NOT_FOUND') return emptyHistoryFile()
      if (isHachiError(error) && error.code === 'INVALID_FILE') {
        const stamp = this.now().toISOString().replace(/[:.]/g, '-')
        this.log(`[history] ${errorText(error)}; moved aside`)
        await rename(file, `${file}.corrupt-${stamp}`).catch(() => undefined)
        return emptyHistoryFile()
      }
      throw error
    }
  }

  private updateFile(ws: string, mutate: (file: HistoryFile) => HistoryFile): Promise<void> {
    return updateJsonAtomic(this.historyFile(ws), () => this.readFile(ws), mutate)
  }

  /** Removes the oldest entries (from any Workspace) until the total fits the limit. */
  private async enforce(): Promise<void> {
    const index = await this.requireIndex()
    const excess = index.entries.length - this.getLimit()
    if (excess > 0) {
      const evicted = [...index.entries].sort(byOldest).slice(0, excess)
      const byWorkspace = new Map<string, Set<string>>()
      for (const e of evicted) {
        const ids = byWorkspace.get(e.workspacePath) ?? new Set<string>()
        ids.add(e.id)
        byWorkspace.set(e.workspacePath, ids)
      }
      for (const [ws, ids] of byWorkspace) {
        try {
          await updateJsonAtomic(
            this.historyFile(ws),
            () => readVersionedJson(this.historyFile(ws), historyFormat),
            (file) => ({ ...file, entries: file.entries.filter((e) => !ids.has(e.id)) })
          )
        } catch (error) {
          // Missing or unreadable (e.g. the Workspace was moved): just forget the entries.
          this.log(`[history] cannot trim ${ws}: ${errorText(error)}`)
        }
      }
      const gone = new Set(evicted)
      index.entries = index.entries.filter((e) => !gone.has(e))
    }
    await this.saveIndex()
  }
}
