import { create } from 'zustand'
import type { WsMessageFormat, WsRequest } from '@shared/schemas/ws-request'
import type { WsConnState, WsEventPayload, WsLogEntry } from '@shared/ws'
import { errorMessage, unwrap } from '@renderer/lib/ipc'

/** A log entry with a key unique across the tab's connections. */
export type WsLogItem = WsLogEntry & { key: string }

/** Connection and message log of one WebSocket tab (by tab uid). Memory only. */
export interface WsSession {
  /** Current or last connection. */
  connectionId: string | null
  state: WsConnState | null
  /** Oldest first, at most `messageLimit` (decision 56). */
  entries: WsLogItem[]
  /** Entries dropped because of the limit since the log was last cleared. */
  dropped: number
  /** Variables that had no value in the last connect / send. */
  unresolved: string[]
  /** Last failed send / ping. */
  error: string | null
}

export interface WsContext {
  parentId: string | null
  environmentId: string | null
}

interface WsState {
  sessions: Record<string, WsSession>
  /** connectionId → tab uid */
  owners: Record<string, string>
  messageLimit: number

  setMessageLimit(limit: number): void
  connect(
    uid: string,
    input: WsContext & { requestId: string | null; request: WsRequest }
  ): Promise<void>
  disconnect(uid: string, code?: number, reason?: string): Promise<void>
  send(
    uid: string,
    input: WsContext & { format: WsMessageFormat; content: string }
  ): Promise<boolean>
  ping(uid: string): Promise<void>
  clear(uid: string): void
  /** Disconnects and forgets a tab's session (tab closed). */
  remove(uid: string): void
  reset(): void
  /** `ws:event` from main. */
  handleEvent(payload: WsEventPayload): void
}

const EMPTY: WsSession = {
  connectionId: null,
  state: null,
  entries: [],
  dropped: 0,
  unresolved: [],
  error: null
}

export function isLive(session: WsSession | undefined): boolean {
  const status = session?.state?.status
  return status === 'connecting' || status === 'open' || status === 'closing'
}

export const useWsStore = create<WsState>()((set, get) => {
  function patch(uid: string, change: (s: WsSession) => Partial<WsSession>): void {
    set((state) => {
      const current = state.sessions[uid] ?? EMPTY
      return { sessions: { ...state.sessions, [uid]: { ...current, ...change(current) } } }
    })
  }

  return {
    sessions: {},
    owners: {},
    messageLimit: 100,

    setMessageLimit(limit) {
      set({ messageLimit: limit })
    },

    async connect(uid, input) {
      if (isLive(get().sessions[uid])) return
      const connectionId = crypto.randomUUID()
      set((s) => ({ owners: { ...s.owners, [connectionId]: uid } }))
      patch(uid, () => ({
        connectionId,
        state: { status: 'connecting', url: input.request.url },
        error: null
      }))
      try {
        const { unresolvedVariables } = await unwrap(
          window.hachi.ws.connect({ connectionId, ...input })
        )
        patch(uid, () => ({ unresolved: unresolvedVariables }))
      } catch (error) {
        patch(uid, (s) => ({
          state: { status: 'error', url: s.state?.url ?? '', error: errorMessage(error) }
        }))
      }
    },

    async disconnect(uid, code, reason) {
      const connectionId = get().sessions[uid]?.connectionId
      if (!connectionId) return
      await window.hachi.ws.disconnect({
        connectionId,
        ...(code !== undefined ? { code } : {}),
        ...(reason ? { reason } : {})
      })
    },

    async send(uid, input) {
      const connectionId = get().sessions[uid]?.connectionId
      if (!connectionId) return false
      try {
        const { unresolvedVariables } = await unwrap(
          window.hachi.ws.send({ connectionId, ...input })
        )
        patch(uid, () => ({ unresolved: unresolvedVariables, error: null }))
        return true
      } catch (error) {
        patch(uid, () => ({ error: errorMessage(error) }))
        return false
      }
    },

    async ping(uid) {
      const connectionId = get().sessions[uid]?.connectionId
      if (!connectionId) return
      try {
        await unwrap(window.hachi.ws.ping({ connectionId }))
        patch(uid, () => ({ error: null }))
      } catch (error) {
        patch(uid, () => ({ error: errorMessage(error) }))
      }
    },

    clear(uid) {
      patch(uid, () => ({ entries: [], dropped: 0 }))
    },

    remove(uid) {
      const session = get().sessions[uid]
      if (session?.connectionId && isLive(session)) {
        void window.hachi.ws.disconnect({ connectionId: session.connectionId })
      }
      set((s) => {
        const sessions = { ...s.sessions }
        delete sessions[uid]
        return { sessions }
      })
    },

    reset() {
      // Main closes every connection when the Workspace changes.
      set({ sessions: {}, owners: {} })
    },

    handleEvent(payload) {
      const uid = get().owners[payload.connectionId]
      if (!uid || !get().sessions[uid]) return
      const limit = get().messageLimit
      patch(uid, (s) => {
        // Events of an older connection (the tab reconnected since) only add log lines.
        const current = s.connectionId === payload.connectionId
        const added = payload.entries.map((e) => ({
          ...e,
          key: `${payload.connectionId}:${e.seq}`
        }))
        let entries = added.length > 0 ? [...s.entries, ...added] : s.entries
        let dropped = s.dropped
        if (entries.length > limit) {
          dropped += entries.length - limit
          entries = entries.slice(entries.length - limit)
        }
        return {
          entries,
          dropped,
          ...(payload.state && current ? { state: payload.state } : {})
        }
      })
    }
  }
})
