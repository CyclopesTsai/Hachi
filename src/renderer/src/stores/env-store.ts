import { create } from 'zustand'
import type { EnvironmentData, EnvironmentSummary } from '@shared/ipc/api'
import type { Variable } from '@shared/schemas/collection'
import { errorMessage, unwrap } from '@renderer/lib/ipc'

interface EnvState {
  list: EnvironmentSummary[]
  /** Environment used for `{{variables}}` when sending; null = none. */
  activeId: string | null
  /** Content of the active environment (secret values included). */
  active: EnvironmentData | null
  /** Variables of collections that open tabs belong to, by collection id. */
  collectionVariables: Record<string, Variable[]>
  error: string | null

  reset(): void
  loadList(): Promise<EnvironmentSummary[]>
  setActive(id: string | null): Promise<void>
  /** Called after an environment was saved / renamed / deleted in the manager. */
  environmentChanged(env: EnvironmentData | null, list?: EnvironmentSummary[]): void
  setList(list: EnvironmentSummary[]): void
  ensureCollectionVariables(collectionId: string): Promise<void>
  setCollectionVariables(collectionId: string, variables: Variable[]): void
  /** Forgets cached collection variables (after re-reading files). */
  clearCollectionVariables(): void
}

/** Collection variables are loaded once per collection; requests in flight are shared. */
const inflight = new Map<string, Promise<void>>()

export const useEnvStore = create<EnvState>()((set, get) => ({
  list: [],
  activeId: null,
  active: null,
  collectionVariables: {},
  error: null,

  reset() {
    inflight.clear()
    set({ list: [], activeId: null, active: null, collectionVariables: {}, error: null })
  },

  async loadList() {
    try {
      const list = await unwrap(window.hachi.env.list())
      set({ list, error: null })
      return list
    } catch (error) {
      set({ error: errorMessage(error) })
      return get().list
    }
  },

  async setActive(id) {
    if (id === null) {
      set({ activeId: null, active: null })
      return
    }
    set({ activeId: id })
    try {
      const env = await unwrap(window.hachi.env.get({ id }))
      if (get().activeId === id) set({ active: env, error: null })
    } catch (error) {
      if (get().activeId === id) set({ activeId: null, active: null, error: errorMessage(error) })
    }
  },

  environmentChanged(env, list) {
    if (list) set({ list })
    if (env && env.id === get().activeId) set({ active: env })
    const activeId = get().activeId
    if (activeId && list && !list.some((e) => e.id === activeId)) {
      set({ activeId: null, active: null })
    }
  },

  setList(list) {
    get().environmentChanged(null, list)
  },

  async ensureCollectionVariables(collectionId) {
    if (get().collectionVariables[collectionId]) return
    const running = inflight.get(collectionId)
    if (running) return running
    const task = (async () => {
      try {
        const data = await unwrap(window.hachi.container.get({ id: collectionId }))
        get().setCollectionVariables(collectionId, data.variables)
      } catch {
        // Unreadable collection: highlighting just treats its variables as missing.
      } finally {
        inflight.delete(collectionId)
      }
    })()
    inflight.set(collectionId, task)
    return task
  },

  setCollectionVariables(collectionId, variables) {
    set((s) => ({ collectionVariables: { ...s.collectionVariables, [collectionId]: variables } }))
  },

  clearCollectionVariables() {
    inflight.clear()
    set({ collectionVariables: {} })
  }
}))
