/**
 * Mock Servers of the Workspace (decision 133): the list, which ones are running and
 * their request logs. The settings being edited live in the Mock tab (tabs store).
 */
import { create } from 'zustand'
import type { MockEvent, MockLogEntry, MockStatus, MockSummary } from '@shared/mock'
import type { MockFile } from '@shared/schemas/mock'
import { unwrap } from '@renderer/lib/ipc'

/** Log lines kept per Mock Server. */
export const MOCK_LOG_MAX = 500

interface MockState {
  list: MockSummary[]
  loaded: boolean
  statuses: Record<string, MockStatus>
  logs: Record<string, MockLogEntry[]>
  loadList(): Promise<MockSummary[]>
  create(name: string, fromCollectionId: string | null): Promise<MockFile>
  rename(id: string, name: string): Promise<void>
  duplicate(id: string): Promise<MockFile>
  remove(id: string): Promise<void>
  start(id: string): Promise<MockStatus>
  stop(id: string): Promise<void>
  clearLog(id: string): void
  /** Applies `mock:event` pushes (status changes, batched log lines). */
  handleEvent(event: MockEvent): void
  /** Workspace switched: forget everything (main stops the servers). */
  reset(): void
}

export const useMockStore = create<MockState>()((set, get) => ({
  list: [],
  loaded: false,
  statuses: {},
  logs: {},

  async loadList() {
    const list = await unwrap(window.hachi.mock.list())
    set({ list, loaded: true })
    return list
  },

  async create(name, fromCollectionId) {
    const mock = await unwrap(window.hachi.mock.create({ name, fromCollectionId }))
    await get().loadList()
    return mock
  },

  async rename(id, name) {
    await unwrap(window.hachi.mock.rename({ id, name }))
    await get().loadList()
  },

  async duplicate(id) {
    const mock = await unwrap(window.hachi.mock.duplicate({ id }))
    await get().loadList()
    return mock
  },

  async remove(id) {
    await unwrap(window.hachi.mock.delete({ id }))
    set((s) => {
      const statuses = { ...s.statuses }
      const logs = { ...s.logs }
      delete statuses[id]
      delete logs[id]
      return { statuses, logs }
    })
    await get().loadList()
  },

  async start(id) {
    const status = await unwrap(window.hachi.mock.start({ id }))
    set((s) => ({ statuses: { ...s.statuses, [id]: status } }))
    return status
  },

  async stop(id) {
    const status = await unwrap(window.hachi.mock.stop({ id }))
    set((s) => ({ statuses: { ...s.statuses, [id]: status } }))
  },

  clearLog(id) {
    set((s) => ({ logs: { ...s.logs, [id]: [] } }))
  },

  handleEvent(event) {
    if ('status' in event) {
      set((s) => ({ statuses: { ...s.statuses, [event.status.id]: event.status } }))
      return
    }
    set((s) => {
      const logs = { ...s.logs }
      for (const entry of event.log) {
        const list = [...(logs[entry.mockId] ?? []), entry]
        logs[entry.mockId] = list.length > MOCK_LOG_MAX ? list.slice(-MOCK_LOG_MAX) : list
      }
      return { logs }
    })
  },

  reset() {
    set({ list: [], loaded: false, statuses: {}, logs: {} })
  }
}))
