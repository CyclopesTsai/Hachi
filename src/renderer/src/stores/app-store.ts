import { create } from 'zustand'
import type { AppConfig } from '@shared/schemas/app-config'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import type {
  AppInfo,
  ConfigUpdateInput,
  RecentWorkspaceEntry,
  WorkspaceCreateInput,
  WorkspaceInfo
} from '@shared/ipc/api'
import { errorMessage, unwrap } from '@renderer/lib/ipc'

export type BootStatus = 'loading' | 'ready' | 'error'

interface AppState {
  status: BootStatus
  bootError: string | null
  info: AppInfo | null
  config: AppConfig | null
  currentWorkspace: WorkspaceInfo | null
  recent: RecentWorkspaceEntry[]
  defaultWorkspaceDir: string
  /** Show the welcome screen even though a Workspace is open (used for switching). */
  welcomeRequested: boolean
  /** Incremented to ask the create form to focus its name field. */
  createFocusNonce: number
  /** Request defaults of the current Workspace. */
  workspaceSettings: WorkspaceSettings | null
  appSettingsOpen: boolean

  bootstrap(): Promise<void>
  loadWorkspaceSettings(): Promise<void>
  saveWorkspaceSettings(settings: WorkspaceSettings): Promise<void>
  updateConfig(input: ConfigUpdateInput): Promise<void>
  setAppSettingsOpen(open: boolean): void
  refreshRecent(): Promise<void>
  createWorkspace(input: WorkspaceCreateInput): Promise<WorkspaceInfo>
  openWorkspace(path: string): Promise<WorkspaceInfo>
  openWorkspaceWithDialog(): Promise<WorkspaceInfo | null>
  removeRecent(path: string): Promise<void>
  /** Renames the current Workspace (display name only). */
  renameWorkspace(name: string): Promise<void>
  /** Moves a Workspace folder to the system trash. */
  deleteWorkspace(path: string): Promise<void>
  /** Applies a `workspace:changed` push event from main. */
  workspaceChanged(workspace: WorkspaceInfo | null): void
  configChanged(config: AppConfig): void
  showWelcome(options?: { focusCreate?: boolean }): void
  hideWelcome(): void
}

export const useAppStore = create<AppState>()((set, get) => ({
  status: 'loading',
  bootError: null,
  info: null,
  config: null,
  currentWorkspace: null,
  recent: [],
  defaultWorkspaceDir: '',
  welcomeRequested: false,
  createFocusNonce: 0,
  workspaceSettings: null,
  appSettingsOpen: false,

  async loadWorkspaceSettings() {
    if (!get().currentWorkspace) {
      set({ workspaceSettings: null })
      return
    }
    try {
      set({ workspaceSettings: await unwrap(window.hachi.workspace.getSettings()) })
    } catch {
      set({ workspaceSettings: null })
    }
  },

  async saveWorkspaceSettings(settings) {
    set({ workspaceSettings: await unwrap(window.hachi.workspace.saveSettings(settings)) })
  },

  async updateConfig(input) {
    set({ config: await unwrap(window.hachi.config.update(input)) })
  },

  setAppSettingsOpen(open) {
    set({ appSettingsOpen: open })
  },

  async bootstrap() {
    try {
      const api = window.hachi
      const [info, config, currentWorkspace, recent, defaultWorkspaceDir] = await Promise.all([
        unwrap(api.app.getInfo()),
        unwrap(api.config.get()),
        unwrap(api.workspace.getCurrent()),
        unwrap(api.workspace.listRecent()),
        unwrap(api.app.getDefaultWorkspaceDir())
      ])
      set({ status: 'ready', info, config, currentWorkspace, recent, defaultWorkspaceDir })
    } catch (error) {
      set({ status: 'error', bootError: errorMessage(error) })
    }
  },

  async refreshRecent() {
    set({ recent: await unwrap(window.hachi.workspace.listRecent()) })
  },

  async createWorkspace(input) {
    const workspace = await unwrap(window.hachi.workspace.create(input))
    set({ currentWorkspace: workspace, welcomeRequested: false })
    await get().refreshRecent()
    return workspace
  },

  async openWorkspace(path) {
    const workspace = await unwrap(window.hachi.workspace.open({ path }))
    set({ currentWorkspace: workspace, welcomeRequested: false })
    await get().refreshRecent()
    return workspace
  },

  async openWorkspaceWithDialog() {
    const workspace = await unwrap(window.hachi.workspace.openWithDialog())
    if (workspace) {
      set({ currentWorkspace: workspace, welcomeRequested: false })
      await get().refreshRecent()
    }
    return workspace
  },

  async removeRecent(path) {
    set({ recent: await unwrap(window.hachi.workspace.removeRecent({ path })) })
  },

  async renameWorkspace(name) {
    const workspace = await unwrap(window.hachi.workspace.rename({ name }))
    set({ currentWorkspace: workspace })
    await get().refreshRecent()
  },

  async deleteWorkspace(path) {
    const recent = await unwrap(window.hachi.workspace.delete({ path }))
    set((s) => ({
      recent,
      currentWorkspace: s.currentWorkspace?.path === path ? null : s.currentWorkspace
    }))
  },

  workspaceChanged(workspace) {
    set({ currentWorkspace: workspace, welcomeRequested: false })
    void get().refreshRecent()
  },

  configChanged(config) {
    set({ config })
  },

  showWelcome(options) {
    set((s) => ({
      welcomeRequested: true,
      createFocusNonce: options?.focusCreate ? s.createFocusNonce + 1 : s.createFocusNonce
    }))
    void get().refreshRecent()
  },

  hideWelcome() {
    set({ welcomeRequested: false })
  }
}))
