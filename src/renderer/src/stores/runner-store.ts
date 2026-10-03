import { create } from 'zustand'
import type { RunnerDataFile } from '@shared/ipc/api'
import type {
  RunnerConfig,
  RunnerEvent,
  RunnerItem,
  RunnerProgress,
  RunnerRow,
  RunnerRowDetail
} from '@shared/runner'
import { hasScripts } from '@shared/scripts'
import { findNode, isContainer, type TreeNode } from '@shared/tree'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useEnvStore } from './env-store'
import { askScriptTrust, scriptsTrusted } from './tabs-store'
import { useTreeStore } from './tree-store'

export const RUNNER_PAGE_SIZE = 100

/** Settings of a Runner tab before it starts (decisions 74–77, 86–92). */
export interface RunnerForm {
  /** Unchecked request ids (everything else below the target runs). */
  excluded: string[]
  environmentId: string | null
  iterations: number
  concurrency: number
  delayMs: number
  stopOnFailure: boolean
  keepBodies: boolean
  data: RunnerDataFile | null
}

export interface RunnerRun {
  runId: string
  items: RunnerItem[]
  skipped: string[]
  progress: RunnerProgress
}

export interface RunnerSession {
  targetId: string
  form: RunnerForm
  run: RunnerRun | null
  starting: boolean
  error: string | null
  page: { offset: number; failedOnly: boolean; total: number; rows: RunnerRow[] }
  /** Row shown in the detail dialog; undefined = closed, null = details were not kept. */
  detail: RunnerRowDetail | null | undefined
}

/** HTTP and WebSocket requests below a container, in tree order. */
export function requestsBelow(node: TreeNode): TreeNode[] {
  if (!isContainer(node)) return [node]
  return node.children.flatMap(requestsBelow)
}

interface RunnerState {
  sessions: Record<string, RunnerSession>
  open(uid: string, targetId: string): void
  updateForm(uid: string, patch: Partial<RunnerForm>): void
  start(uid: string): Promise<void>
  cancel(uid: string): Promise<void>
  loadPage(uid: string, page?: { offset?: number; failedOnly?: boolean }): Promise<void>
  showDetail(uid: string, index: number | null): Promise<void>
  exportResults(uid: string): Promise<string | null>
  pickDataFile(uid: string): Promise<void>
  handleEvent(event: RunnerEvent): void
  /** Tab closed: stop and forget the run. */
  remove(uid: string): void
  reset(): void
}

const emptyPage = () => ({ offset: 0, failedOnly: false, total: 0, rows: [] as RunnerRow[] })

export const useRunnerStore = create<RunnerState>()((set, get) => {
  const patch = (uid: string, change: (s: RunnerSession) => Partial<RunnerSession>) =>
    set((state) => {
      const session = state.sessions[uid]
      if (!session) return state
      return { sessions: { ...state.sessions, [uid]: { ...session, ...change(session) } } }
    })

  const byRunId = (runId: string): string | undefined =>
    Object.keys(get().sessions).find((uid) => get().sessions[uid]?.run?.runId === runId)

  return {
    sessions: {},

    open(uid, targetId) {
      if (get().sessions[uid]) return
      set((s) => ({
        sessions: {
          ...s.sessions,
          [uid]: {
            targetId,
            form: {
              excluded: [],
              environmentId: useEnvStore.getState().activeId,
              iterations: 1,
              concurrency: 1,
              delayMs: 0,
              stopOnFailure: false,
              keepBodies: false,
              data: null
            },
            run: null,
            starting: false,
            error: null,
            page: emptyPage(),
            detail: undefined
          }
        }
      }))
    },

    updateForm(uid, change) {
      patch(uid, (s) => ({ form: { ...s.form, ...change } }))
    },

    async start(uid) {
      const session = get().sessions[uid]
      if (!session || session.starting || session.run?.progress.status === 'running') return
      const target = findNode(useTreeStore.getState().tree, session.targetId)?.node
      if (!target) return
      const excluded = new Set(session.form.excluded)
      const itemIds = requestsBelow(target)
        .filter((n) => n.kind === 'request' && !excluded.has(n.id))
        .map((n) => n.id)
      if (itemIds.length === 0) {
        patch(uid, () => ({ error: '請至少勾選一個請求' }))
        return
      }
      patch(uid, () => ({ starting: true, error: null }))
      try {
        // Scripts of the checked requests (read from the saved files) need trust (decision 84).
        let skipScripts = false
        if (!scriptsTrusted()) {
          const withScripts = await Promise.all(
            itemIds.map((id) =>
              unwrap(window.hachi.request.get({ id }))
                .then(({ request }) => request.type === 'http' && hasScripts(request.scripts))
                .catch(() => false)
            )
          )
          if (withScripts.some(Boolean)) {
            const choice = await askScriptTrust()
            if (choice === 'cancel') return
            skipScripts = choice === 'skip'
          }
        }
        const previous = get().sessions[uid]?.run?.runId
        if (previous) void window.hachi.runner.discard({ runId: previous })
        const f = session.form
        const config: RunnerConfig = {
          targetId: session.targetId,
          itemIds,
          environmentId: f.environmentId,
          iterations: f.iterations,
          concurrency: f.concurrency,
          delayMs: f.delayMs,
          stopOnFailure: f.stopOnFailure,
          keepBodies: f.keepBodies,
          data: f.data ? { fileName: f.data.fileName, rows: f.data.rows } : null,
          skipScripts
        }
        const runId = crypto.randomUUID()
        const started = await unwrap(window.hachi.runner.start({ runId, config }))
        patch(uid, () => ({
          run: {
            runId,
            items: started.items,
            skipped: started.skipped,
            progress: started.progress
          },
          page: emptyPage(),
          detail: undefined
        }))
      } catch (error) {
        patch(uid, () => ({ error: errorMessage(error) }))
      } finally {
        patch(uid, () => ({ starting: false }))
      }
    },

    async cancel(uid) {
      const runId = get().sessions[uid]?.run?.runId
      if (runId) await unwrap(window.hachi.runner.cancel({ runId })).catch(() => false)
    },

    async loadPage(uid, page = {}) {
      const session = get().sessions[uid]
      const runId = session?.run?.runId
      if (!session || !runId) return
      const offset = page.offset ?? session.page.offset
      const failedOnly = page.failedOnly ?? session.page.failedOnly
      try {
        const result = await unwrap(
          window.hachi.runner.rows({ runId, offset, limit: RUNNER_PAGE_SIZE, failedOnly })
        )
        if (get().sessions[uid]?.run?.runId !== runId) return
        patch(uid, () => ({ page: { offset, failedOnly, total: result.total, rows: result.rows } }))
      } catch (error) {
        patch(uid, () => ({ error: errorMessage(error) }))
      }
    },

    async showDetail(uid, index) {
      const runId = get().sessions[uid]?.run?.runId
      if (index === null || !runId) {
        patch(uid, () => ({ detail: undefined }))
        return
      }
      const detail = await unwrap(window.hachi.runner.row({ runId, index })).catch(() => null)
      patch(uid, () => ({ detail }))
    },

    async exportResults(uid) {
      const runId = get().sessions[uid]?.run?.runId
      if (!runId) return null
      return unwrap(window.hachi.runner.export({ runId }))
    },

    async pickDataFile(uid) {
      try {
        const data = await unwrap(window.hachi.runner.pickDataFile())
        if (data) get().updateForm(uid, { data })
        patch(uid, () => ({ error: null }))
      } catch (error) {
        patch(uid, () => ({ error: errorMessage(error) }))
      }
    },

    handleEvent(event) {
      const uid = byRunId(event.progress.runId)
      if (!uid) return
      patch(uid, (s) => (s.run ? { run: { ...s.run, progress: event.progress } } : {}))
      // Keep the visible page fresh (cheap: one page of rows).
      void get().loadPage(uid)
    },

    remove(uid) {
      const runId = get().sessions[uid]?.run?.runId
      if (runId) void window.hachi.runner.discard({ runId })
      set((s) => {
        const { [uid]: _removed, ...rest } = s.sessions
        return { sessions: rest }
      })
    },

    reset() {
      for (const uid of Object.keys(get().sessions)) get().remove(uid)
    }
  }
})
