import { create } from 'zustand'
import type { GitBranch, GitIdentity, GitStatus } from '@shared/git'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from './app-store'
import { useTabsStore } from './tabs-store'

/** Git of the current Workspace (decisions 111–115). */
interface GitState {
  status: GitStatus | null
  branches: GitBranch[]
  /** Commit message being written. */
  message: string
  /** Changed files left out of the next commit (everything else is included). */
  unchecked: ReadonlySet<string>
  busy: boolean
  /** Shown in the Git panel until the next successful operation. */
  error: string | null
  /** user.name / email missing: the identity dialog is open, then the commit continues. */
  askIdentity: boolean

  refresh(): Promise<void>
  reset(): void
  setMessage(message: string): void
  toggle(path: string): void
  setAll(checked: boolean): void
  init(): Promise<void>
  commit(): Promise<void>
  saveIdentity(identity: GitIdentity, global: boolean): Promise<void>
  cancelIdentity(): void
  discard(path: string, itemId: string | null): Promise<void>
  loadBranches(): Promise<void>
  /** Asks about unsaved tabs, switches, then re-reads the Workspace. */
  switchBranch(name: string, remote: boolean): Promise<void>
  createBranch(name: string): Promise<boolean>
}

export const useGitStore = create<GitState>()((set, get) => {
  /** Runs an operation that returns the new status; errors are shown in the panel. */
  async function operate(run: () => Promise<GitStatus | void>): Promise<boolean> {
    if (get().busy) return false
    set({ busy: true })
    try {
      const status = await run()
      if (status) set({ status })
      set({ error: null })
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    } finally {
      set({ busy: false })
    }
  }

  return {
    status: null,
    branches: [],
    message: '',
    unchecked: new Set(),
    busy: false,
    error: null,
    askIdentity: false,

    async refresh() {
      if (!useAppStore.getState().currentWorkspace) return
      try {
        const status = await unwrap(window.hachi.git.status())
        // Forget unchecked files that are no longer changed.
        const paths = new Set(status.state === 'repo' ? status.files.map((f) => f.path) : [])
        const unchecked = [...get().unchecked].filter((p) => paths.has(p))
        set({
          status,
          ...(unchecked.length !== get().unchecked.size ? { unchecked: new Set(unchecked) } : {})
        })
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    reset() {
      set({
        status: null,
        branches: [],
        message: '',
        unchecked: new Set(),
        error: null,
        askIdentity: false
      })
    },

    setMessage(message) {
      set({ message })
    },

    toggle(path) {
      const unchecked = new Set(get().unchecked)
      if (unchecked.has(path)) unchecked.delete(path)
      else unchecked.add(path)
      set({ unchecked })
    },

    setAll(checked) {
      const status = get().status
      const all = status?.state === 'repo' ? status.files.map((f) => f.path) : []
      set({ unchecked: new Set(checked ? [] : all) })
    },

    async init() {
      await operate(() => unwrap(window.hachi.git.init()))
    },

    async commit() {
      const { status, unchecked, message } = get()
      if (status?.state !== 'repo' || message.trim() === '') return
      const paths = status.files.map((f) => f.path).filter((p) => !unchecked.has(p))
      if (paths.length === 0) return
      try {
        if (!(await unwrap(window.hachi.git.identity()))) {
          set({ askIdentity: true })
          return
        }
      } catch (error) {
        set({ error: errorMessage(error) })
        return
      }
      const ok = await operate(() => unwrap(window.hachi.git.commit({ paths, message })))
      if (ok) set({ message: '', unchecked: new Set() })
    },

    async saveIdentity(identity, global) {
      const ok = await operate(() => unwrap(window.hachi.git.setIdentity({ ...identity, global })))
      if (!ok) return
      set({ askIdentity: false })
      await get().commit()
    },

    cancelIdentity() {
      set({ askIdentity: false })
    },

    async discard(path, itemId) {
      const ok = await operate(() => unwrap(window.hachi.git.discard({ path })))
      // The file changed on disk: its open tab re-reads it.
      if (ok && itemId) await useTabsStore.getState().reload({ scope: 'item', id: itemId })
    },

    async loadBranches() {
      try {
        set({ branches: await unwrap(window.hachi.git.branches()) })
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    async switchBranch(name, remote) {
      if (!(await useTabsStore.getState().askSaveUnsaved())) return
      const ok = await operate(() => unwrap(window.hachi.git.switch({ name, remote })))
      if (ok) {
        // Files of the other branch: re-read the tree and every open tab.
        await useTabsStore.getState().reload({ scope: 'workspace' }, { keepUnsaved: true })
      } else {
        useAppStore.getState().setNotice(get().error ?? '切換分支失敗')
      }
    },

    async createBranch(name) {
      const ok = await operate(() => unwrap(window.hachi.git.createBranch({ name })))
      if (!ok) useAppStore.getState().setNotice(get().error ?? '建立分支失敗')
      return ok
    }
  }
})
