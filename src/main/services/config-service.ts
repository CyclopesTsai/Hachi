import { rename } from 'node:fs/promises'
import path from 'node:path'
import { isHachiError } from '@shared/errors'
import {
  MAX_RECENT_WORKSPACES,
  appConfigFormat,
  appConfigSchema,
  defaultAppConfig,
  type AppConfig,
  type HistorySettings,
  type WebsocketSettings,
  type ProxySettings,
  type Theme,
  type UiSettings,
  type WindowState
} from '@shared/schemas/app-config'
import { writeJsonAtomic } from './fs/atomic-write'
import { readVersionedJson } from './fs/json-file'

export const APP_CONFIG_FILE = 'app-config.json'

type Listener = (config: AppConfig) => void

/**
 * Owns `<userData>/app-config.json`. All reads come from memory; every change is
 * validated and persisted with an atomic write.
 */
export class ConfigService {
  private config: AppConfig = defaultAppConfig()
  private readonly listeners = new Set<Listener>()

  constructor(
    readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (message: string) => void = console.warn
  ) {}

  /**
   * Loads the config from disk. A missing file yields defaults; a corrupt or
   * too-new file is moved aside as `app-config.json.<reason>-<timestamp>` and
   * replaced with defaults so the app can always start.
   */
  async load(): Promise<AppConfig> {
    try {
      this.config = await readVersionedJson(this.filePath, appConfigFormat)
    } catch (error) {
      if (isHachiError(error) && error.code === 'NOT_FOUND') {
        this.config = defaultAppConfig()
        await this.persist()
      } else if (
        isHachiError(error) &&
        (error.code === 'INVALID_FILE' || error.code === 'UNSUPPORTED_VERSION')
      ) {
        const reason = error.code === 'INVALID_FILE' ? 'corrupt' : 'newer'
        const stamp = this.now().toISOString().replace(/[:.]/g, '-')
        const backup = `${this.filePath}.${reason}-${stamp}`
        this.log(`[config] ${error.message}; moved to ${path.basename(backup)} and reset`)
        await rename(this.filePath, backup).catch(() => undefined)
        this.config = defaultAppConfig()
        await this.persist()
      } else {
        throw error
      }
    }
    return this.get()
  }

  get(): AppConfig {
    return structuredClone(this.config)
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Applies `mutate` to a copy, validates the result, persists and notifies listeners. */
  async update(mutate: (draft: AppConfig) => void): Promise<AppConfig> {
    const draft = this.get()
    mutate(draft)
    this.config = appConfigSchema.parse(draft)
    await this.persist()
    const snapshot = this.get()
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
  }

  setTheme(theme: Theme): Promise<AppConfig> {
    return this.update((c) => {
      c.theme = theme
    })
  }

  setProxy(proxy: ProxySettings): Promise<AppConfig> {
    return this.update((c) => {
      c.proxy = proxy
    })
  }

  setUi(ui: Partial<UiSettings>): Promise<AppConfig> {
    return this.update((c) => {
      c.ui = { ...c.ui, ...ui }
    })
  }

  setHistory(history: HistorySettings): Promise<AppConfig> {
    return this.update((c) => {
      c.history = history
    })
  }

  setWebsocket(websocket: WebsocketSettings): Promise<AppConfig> {
    return this.update((c) => {
      c.websocket = websocket
    })
  }

  setWindowState(window: WindowState): Promise<AppConfig> {
    return this.update((c) => {
      c.window = window
    })
  }

  /** Moves (or adds) a Workspace to the top of the recent list and marks it as last opened. */
  touchRecentWorkspace(workspacePath: string, name: string): Promise<AppConfig> {
    const resolved = path.resolve(workspacePath)
    return this.update((c) => {
      const others = c.recentWorkspaces.filter((r) => path.resolve(r.path) !== resolved)
      c.recentWorkspaces = [
        { path: resolved, name, lastOpenedAt: this.now().toISOString() },
        ...others
      ].slice(0, MAX_RECENT_WORKSPACES)
      c.lastWorkspacePath = resolved
    })
  }

  removeRecentWorkspace(workspacePath: string): Promise<AppConfig> {
    const resolved = path.resolve(workspacePath)
    return this.update((c) => {
      c.recentWorkspaces = c.recentWorkspaces.filter((r) => path.resolve(r.path) !== resolved)
      if (c.lastWorkspacePath && path.resolve(c.lastWorkspacePath) === resolved) {
        c.lastWorkspacePath = null
      }
    })
  }

  clearRecentWorkspaces(): Promise<AppConfig> {
    return this.update((c) => {
      c.recentWorkspaces = []
    })
  }

  private persist(): Promise<void> {
    return writeJsonAtomic(this.filePath, this.config)
  }
}
