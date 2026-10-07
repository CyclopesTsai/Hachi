import { create } from 'zustand'
import type {
  GitBranch,
  GitCommitDetail,
  GitCommitSummary,
  GitFileDiff,
  GitIdentity,
  GitPrompt,
  GitRemote,
  GitResolution,
  GitStatus
} from '@shared/git'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from './app-store'
import { useTabsStore } from './tabs-store'

/** The Git screen that replaces the sidebar and tabs (decision 119); null = closed. */
export type GitView = 'commit' | 'history'

/** Git of the current Workspace (decisions 111–119). */
interface GitState {
  status: GitStatus | null
  view: GitView | null
  /** File shown in the Commit screen's diff. */
  selected: string | null
  diff: GitFileDiff | null
  branches: GitBranch[]
  /** Commit message being written. */
  message: string
  /** Changed files left out of the next commit (everything else is included). */
  unchecked: ReadonlySet<string>
  busy: boolean
  /** A network operation in progress (its button shows it). */
  running: 'fetch' | 'pull' | 'push' | null
  remote: GitRemote | null
  /** History tab (decision 116). */
  log: { commits: GitCommitSummary[]; more: boolean } | null
  logLoading: boolean
  commitDetail: GitCommitDetail | null
  /** Repository path of the commit's file shown in the diff. */
  commitFile: string | null
  commitDiff: GitFileDiff | null
  /** Credential prompts from git, oldest first (decision 113). */
  prompts: GitPrompt[]
  /** Shown in the Git panel until the next successful operation. */
  error: string | null
  /** user.name / email missing: the identity dialog is open, then the commit continues. */
  askIdentity: boolean

  refresh(): Promise<void>
  reset(): void
  openView(view: GitView): void
  closeView(): void
  select(path: string | null): Promise<void>
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
  loadRemote(): Promise<void>
  setRemote(url: string): Promise<boolean>
  fetch(options?: { quiet?: boolean }): Promise<void>
  /** Asks about unsaved tabs, pulls, re-reads the Workspace; conflicts open the Git screen. */
  pull(): Promise<void>
  push(): Promise<void>
  resolve(path: string, how: GitResolution): Promise<void>
  abortMerge(): Promise<void>
  finishMerge(): Promise<void>
  openFile(path: string): Promise<void>
  /** First page (reset) or the next page of the History. */
  loadLog(reset: boolean): Promise<void>
  selectCommit(hash: string | null): Promise<void>
  selectCommitFile(repoPath: string | null): Promise<void>
  /** git asked for a credential (`git:prompt` event). */
  prompted(prompt: GitPrompt): void
  answerPrompt(value: string | null): Promise<void>
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
      // Commits, pulls, branches… change the History: reload it now, or when it opens.
      if (get().view === 'history') void get().loadLog(true)
      else set({ log: null })
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
    view: null,
    selected: null,
    diff: null,
    branches: [],
    message: '',
    unchecked: new Set(),
    busy: false,
    running: null,
    remote: null,
    log: null,
    logLoading: false,
    commitDetail: null,
    commitFile: null,
    commitDiff: null,
    prompts: [],
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
        // The shown file may have changed again, or be committed / discarded by now.
        const selected = get().selected
        if (selected && get().view) await get().select(paths.has(selected) ? selected : null)
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    reset() {
      set({
        status: null,
        view: null,
        selected: null,
        diff: null,
        branches: [],
        message: '',
        unchecked: new Set(),
        error: null,
        askIdentity: false,
        running: null,
        remote: null,
        log: null,
        commitDetail: null,
        commitFile: null,
        commitDiff: null
      })
    },

    openView(view) {
      set({ view })
      void get().refresh()
      if (view === 'history') void get().loadLog(true)
    },

    closeView() {
      set({ view: null, selected: null, diff: null, commitFile: null, commitDiff: null })
    },

    async select(path) {
      if (path === null) {
        set({ selected: null, diff: null })
        return
      }
      if (path !== get().selected) set({ selected: path, diff: null })
      try {
        const diff = await unwrap(window.hachi.git.diff({ path }))
        // Ignore an answer for a file that is no longer selected.
        if (get().selected === path) set({ diff })
      } catch (error) {
        if (get().selected === path) set({ diff: null, error: errorMessage(error) })
      }
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

    async loadRemote() {
      try {
        set({ remote: await unwrap(window.hachi.git.remote()) })
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    async setRemote(url) {
      const ok = await operate(() => unwrap(window.hachi.git.setRemote({ url })))
      if (ok) await get().loadRemote()
      else useAppStore.getState().setNotice(get().error ?? '設定遠端失敗')
      return ok
    },

    async fetch(options) {
      set({ running: 'fetch' })
      const ok = await operate(() => unwrap(window.hachi.git.fetch()))
      set({ running: null })
      if (!ok && !options?.quiet) useAppStore.getState().setNotice(get().error ?? 'Fetch 失敗')
    },

    async pull() {
      if (!(await useTabsStore.getState().askSaveUnsaved())) return
      set({ running: 'pull' })
      const ok = await operate(() => unwrap(window.hachi.git.pull()))
      set({ running: null })
      if (!ok) {
        useAppStore.getState().setNotice(get().error ?? 'Pull 失敗')
        return
      }
      await useTabsStore.getState().reload({ scope: 'workspace' }, { keepUnsaved: true })
      const status = get().status
      if (status?.state === 'repo' && status.merging) {
        // Conflicts: settle them in the Git screen, which explains what to do (decision 114).
        get().openView('commit')
      }
    },

    async push() {
      set({ running: 'push' })
      const ok = await operate(() => unwrap(window.hachi.git.push()))
      set({ running: null })
      if (!ok) useAppStore.getState().setNotice(get().error ?? 'Push 失敗')
    },

    async resolve(path, how) {
      const ok = await operate(() => unwrap(window.hachi.git.resolve({ path, how })))
      if (ok) await useTabsStore.getState().reload({ scope: 'workspace' }, { keepUnsaved: true })
    },

    async abortMerge() {
      const ok = await operate(() => unwrap(window.hachi.git.abortMerge()))
      if (ok) await useTabsStore.getState().reload({ scope: 'workspace' }, { keepUnsaved: true })
    },

    async finishMerge() {
      await operate(() => unwrap(window.hachi.git.finishMerge()))
    },

    async openFile(path) {
      try {
        await unwrap(window.hachi.git.openFile({ path }))
      } catch (error) {
        useAppStore.getState().setNotice(errorMessage(error))
      }
    },

    async loadLog(reset) {
      if (get().logLoading) return
      set({ logLoading: true })
      try {
        const skip = reset ? 0 : (get().log?.commits.length ?? 0)
        const page = await unwrap(window.hachi.git.log({ skip }))
        const commits = reset ? page.commits : [...(get().log?.commits ?? []), ...page.commits]
        set({ log: { commits, more: page.more } })
        // The selected commit may be gone (e.g. after switching branches it stays listed).
        if (
          reset &&
          get().commitDetail &&
          !commits.some((c) => c.hash === get().commitDetail?.hash)
        ) {
          set({ commitDetail: null, commitFile: null, commitDiff: null })
        }
      } catch (error) {
        set({ error: errorMessage(error) })
      } finally {
        set({ logLoading: false })
      }
    },

    async selectCommit(hash) {
      set({ commitFile: null, commitDiff: null })
      if (hash === null) {
        set({ commitDetail: null })
        return
      }
      try {
        set({ commitDetail: await unwrap(window.hachi.git.commitDetail({ hash })) })
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    async selectCommitFile(repoPath) {
      const commit = get().commitDetail
      set({ commitFile: repoPath, commitDiff: null })
      if (!commit || repoPath === null) return
      try {
        const diff = await unwrap(
          window.hachi.git.commitDiff({ hash: commit.hash, path: repoPath })
        )
        if (get().commitFile === repoPath) set({ commitDiff: diff })
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    prompted(prompt) {
      set({ prompts: [...get().prompts, prompt] })
    },

    async answerPrompt(value) {
      const [first, ...rest] = get().prompts
      if (!first) return
      set({ prompts: rest })
      await window.hachi.git.answerPrompt({ id: first.id, value })
    },

    async createBranch(name) {
      const ok = await operate(() => unwrap(window.hachi.git.createBranch({ name })))
      if (!ok) useAppStore.getState().setNotice(get().error ?? '建立分支失敗')
      return ok
    }
  }
})
