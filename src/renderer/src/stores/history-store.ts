import { create } from 'zustand'
import type { HistoryUsage } from '@shared/ipc/api'
import type { HttpHistoryEntry } from '@shared/schemas/history'
import { errorMessage, unwrap } from '@renderer/lib/ipc'

export type SidebarMode = 'collections' | 'history'

interface HistoryState {
  entries: HttpHistoryEntry[]
  usage: HistoryUsage | null
  loaded: boolean
  error: string | null
  sidebarMode: SidebarMode

  reset(): void
  load(): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  /** `history:changed` from main (after a send, a deletion or a limit change). */
  usageChanged(usage: HistoryUsage): void
  setSidebarMode(mode: SidebarMode): void
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  entries: [],
  usage: null,
  loaded: false,
  error: null,
  sidebarMode: 'collections',

  reset() {
    set({ entries: [], usage: null, loaded: false, error: null, sidebarMode: 'collections' })
  },

  async load() {
    try {
      const { entries, usage } = await unwrap(window.hachi.history.list())
      set({ entries, usage, loaded: true, error: null })
    } catch (error) {
      set({ error: errorMessage(error), loaded: true })
    }
  },

  async remove(id) {
    try {
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
      set({ usage: await unwrap(window.hachi.history.delete({ id })) })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  async clear() {
    try {
      set({ usage: await unwrap(window.hachi.history.clear()), entries: [] })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  usageChanged(usage) {
    set({ usage })
    // The list is re-read lazily: only while the History panel is showing.
    if (get().sidebarMode === 'history') void get().load()
    else set({ loaded: false })
  },

  setSidebarMode(mode) {
    set({ sidebarMode: mode })
    if (mode === 'history' && !get().loaded) void get().load()
  }
}))
