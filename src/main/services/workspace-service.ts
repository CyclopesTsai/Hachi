import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { HachiError, isHachiError } from '@shared/errors'
import { sanitizeFileName } from '@shared/file-names'
import type { RecentWorkspaceEntry, WorkspaceInfo } from '@shared/ipc/api'
import {
  WORKSPACE_FILE,
  WORKSPACE_GITIGNORE,
  WORKSPACE_LAYOUT,
  WORKSPACE_VERSION,
  workspaceFileSchema,
  workspaceFormat,
  workspaceSettingsSchema,
  type WorkspaceFile,
  type WorkspaceSettings
} from '@shared/schemas/workspace'
import { emptyHistoryFile } from '@shared/schemas/history'
import type { ConfigService } from './config-service'
import type { TrashFn } from './collection-service'
import { updateJsonAtomic, writeFileAtomic, writeJsonAtomic } from './fs/atomic-write'
import { readJsonFile, readVersionedJson } from './fs/json-file'

type Listener = (workspace: WorkspaceInfo | null) => void

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Creates, opens and tracks the current Workspace. */
export class WorkspaceService {
  private current: WorkspaceInfo | null = null
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly config: ConfigService,
    private readonly now: () => Date = () => new Date(),
    private readonly trash: TrashFn = () => Promise.reject(new Error('Trash is not available'))
  ) {}

  getCurrent(): WorkspaceInfo | null {
    return this.current ? { ...this.current } : null
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Path of the folder that `create` would use, for previews. */
  static targetDir(parentDir: string, name: string): string {
    return path.join(path.resolve(parentDir), sanitizeFileName(name.trim()))
  }

  /**
   * Creates `<parentDir>/<sanitized name>/` with the Workspace skeleton and opens it.
   * The target folder may already exist only if it is empty.
   */
  async create(input: { name: string; parentDir: string }): Promise<WorkspaceInfo> {
    const name = input.name.trim()
    const dir = WorkspaceService.targetDir(input.parentDir, name)

    if (await pathExists(path.join(dir, WORKSPACE_FILE))) {
      throw new HachiError('ALREADY_EXISTS', `A Workspace already exists at ${dir}`)
    }
    if (await pathExists(dir)) {
      const info = await stat(dir)
      if (!info.isDirectory()) {
        throw new HachiError('ALREADY_EXISTS', `A file already exists at ${dir}`)
      }
      const entries = (await readdir(dir)).filter((e) => e !== '.DS_Store')
      if (entries.length > 0) {
        throw new HachiError('DIR_NOT_EMPTY', `Folder is not empty: ${dir}`)
      }
    }

    const file: WorkspaceFile = workspaceFileSchema.parse({
      version: WORKSPACE_VERSION,
      id: randomUUID(),
      name,
      createdAt: this.now().toISOString()
    })

    try {
      await mkdir(path.join(dir, WORKSPACE_LAYOUT.collectionsDir), { recursive: true })
      await mkdir(path.join(dir, WORKSPACE_LAYOUT.environmentsDir), { recursive: true })
      await writeJsonAtomic(path.join(dir, WORKSPACE_LAYOUT.historyFile), emptyHistoryFile())
      await writeFileAtomic(path.join(dir, WORKSPACE_LAYOUT.gitignoreFile), WORKSPACE_GITIGNORE)
      // workspace.json last: its presence marks the folder as a complete Workspace.
      await writeJsonAtomic(path.join(dir, WORKSPACE_FILE), file)
    } catch (error) {
      throw new HachiError('IO_ERROR', `Cannot create Workspace at ${dir}: ${String(error)}`, {
        cause: error
      })
    }
    return this.open(dir)
  }

  /** Opens an existing Workspace folder and makes it current. */
  async open(dirInput: string): Promise<WorkspaceInfo> {
    const dir = path.resolve(dirInput)
    let file: WorkspaceFile
    try {
      file = await readVersionedJson(path.join(dir, WORKSPACE_FILE), workspaceFormat)
    } catch (error) {
      if (isHachiError(error) && error.code === 'NOT_FOUND') {
        throw new HachiError(
          'NOT_A_WORKSPACE',
          `${dir} is not a Hachi Workspace (no ${WORKSPACE_FILE})`
        )
      }
      throw error
    }
    // Self-heal folders that may have been removed outside the app.
    await mkdir(path.join(dir, WORKSPACE_LAYOUT.collectionsDir), { recursive: true })
    await mkdir(path.join(dir, WORKSPACE_LAYOUT.environmentsDir), { recursive: true })

    this.current = { id: file.id, name: file.name, path: dir }
    await this.config.touchRecentWorkspace(dir, file.name)
    this.emit()
    return this.getCurrent() as WorkspaceInfo
  }

  /** Re-opens the last Workspace on startup. Returns null (and keeps going) on any failure. */
  async restoreLast(): Promise<WorkspaceInfo | null> {
    const last = this.config.get().lastWorkspacePath
    if (!last) return null
    try {
      return await this.open(last)
    } catch {
      return null
    }
  }

  async listRecent(): Promise<RecentWorkspaceEntry[]> {
    const recent = this.config.get().recentWorkspaces
    return Promise.all(
      recent.map(async (r) => ({
        ...r,
        exists: await pathExists(path.join(r.path, WORKSPACE_FILE))
      }))
    )
  }

  async removeRecent(dir: string): Promise<RecentWorkspaceEntry[]> {
    await this.config.removeRecentWorkspace(dir)
    return this.listRecent()
  }

  /** Renames the current Workspace. Only the display name changes; the folder stays put. */
  async rename(nameInput: string): Promise<WorkspaceInfo> {
    const current = this.current
    if (!current) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    const name = nameInput.trim()
    const file = path.join(current.path, WORKSPACE_FILE)
    await updateJsonAtomic(
      file,
      async () => {
        await readVersionedJson(file, workspaceFormat) // validate before touching it
        return (await readJsonFile(file)) as Record<string, unknown>
      },
      (raw) => ({ ...raw, name })
    )
    if (this.current?.path !== current.path) return current
    this.current = { ...current, name }
    await this.config.touchRecentWorkspace(current.path, name)
    this.emit()
    return this.getCurrent() as WorkspaceInfo
  }

  /** Request defaults of the current Workspace (timeout, SSL, redirects). */
  async getSettings(): Promise<WorkspaceSettings> {
    const current = this.current
    if (!current) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    const file = await readVersionedJson(path.join(current.path, WORKSPACE_FILE), workspaceFormat)
    return file.settings
  }

  async saveSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
    const current = this.current
    if (!current) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    const valid = workspaceSettingsSchema.parse(settings)
    const file = path.join(current.path, WORKSPACE_FILE)
    await updateJsonAtomic(
      file,
      async () => {
        await readVersionedJson(file, workspaceFormat)
        return (await readJsonFile(file)) as Record<string, unknown>
      },
      (raw) => ({ ...raw, settings: { ...(raw.settings as object), ...valid } })
    )
    return this.getSettings()
  }

  /**
   * Re-reads the current workspace.json (after an external edit) and emits if the
   * name changed. Errors are ignored: the file may be mid-edit.
   */
  async reloadCurrent(): Promise<void> {
    const current = this.current
    if (!current) return
    try {
      const file = await readVersionedJson(path.join(current.path, WORKSPACE_FILE), workspaceFormat)
      if (file.name !== current.name && this.current?.path === current.path) {
        this.current = { ...current, name: file.name }
        await this.config.touchRecentWorkspace(current.path, file.name)
        this.emit()
      }
    } catch {
      // keep the last known good state
    }
  }

  /**
   * Moves a Workspace folder to the system trash and forgets it.
   * Only Workspaces Hachi knows about (current or in the recent list) and only
   * folders that really contain a workspace.json can be deleted.
   */
  async delete(dirInput: string): Promise<RecentWorkspaceEntry[]> {
    const dir = path.resolve(dirInput)
    const known =
      this.current?.path === dir ||
      this.config.get().recentWorkspaces.some((r) => path.resolve(r.path) === dir)
    if (!known) throw new HachiError('FORBIDDEN', 'Only known Workspaces can be deleted')
    if (!(await pathExists(path.join(dir, WORKSPACE_FILE)))) {
      throw new HachiError('NOT_A_WORKSPACE', `${dir} is not a Hachi Workspace`)
    }
    if (this.current?.path === dir) {
      // Close first so the collection tree lets go of the folder.
      this.current = null
      this.emit()
    }
    try {
      await this.trash(dir)
    } catch (error) {
      throw new HachiError('IO_ERROR', `Cannot move ${dir} to the trash: ${String(error)}`, {
        cause: error
      })
    }
    await this.config.removeRecentWorkspace(dir)
    return this.listRecent()
  }

  private emit(): void {
    const snapshot = this.getCurrent()
    for (const listener of this.listeners) listener(snapshot)
  }
}
