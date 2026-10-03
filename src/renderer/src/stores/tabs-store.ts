import { create } from 'zustand'
import type { HttpResult } from '@shared/http'
import type { VariablesChangedEvent } from '@shared/ipc/api'
import type { HistoryEntry } from '@shared/schemas/history'
import { httpRequestSchema, type HttpRequest } from '@shared/schemas/http-request'
import { wsRequestSchema, type WsRequest } from '@shared/schemas/ws-request'
import type { SessionData } from '@shared/schemas/session'
import { findNode, isSelfOrDescendant, type WorkspaceTree } from '@shared/tree'
import {
  ENVIRONMENTS_TAB_KEY,
  collectionIdOf,
  contextParentId,
  createDraftTab,
  createEnvironmentsTab,
  createItemTab,
  createRunnerTab,
  fromSession,
  insertTab,
  isDraftTab,
  isRequestLike,
  isTabDirty,
  itemTabKey,
  nextActiveKey,
  parentIdOf,
  runnerTabKey,
  syncTabsWithTree,
  tabItemId,
  type ContainerContent,
  type ContainerTab,
  type EnvironmentsTab,
  type RequestLikeTab,
  type RequestTab,
  type Tab,
  type TabKey,
  type WsComposer,
  type WsTab
} from '@renderer/features/tabs/tab-model'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { hasScripts } from '@shared/scripts'
import { useAppStore } from './app-store'
import { useRunnerStore } from './runner-store'
import { useEnvStore } from './env-store'
import { useTreeStore } from './tree-store'
import { isLive, useWsStore } from './ws-store'

export type ReloadScope = { scope: 'workspace' } | { scope: 'item'; id: string }

/** "Save / Don't save / Cancel" (or "Discard / Cancel") about some unsaved tabs. */
export interface UnsavedPrompt {
  keys: TabKey[]
  /** save: closing / leaving. discard: re-reading files replaces the edits. */
  mode: 'save' | 'discard'
  resolve(proceed: boolean): void
}

/** "信任這個 Workspace 的腳本？" before the first script runs (decision 84). */
export type TrustChoice = 'trust' | 'skip' | 'cancel'
export interface TrustPrompt {
  resolve(choice: TrustChoice): void
}

/** The "Save As" dialog for an unsaved request. */
export interface SaveAsRequest {
  key: TabKey
  resolve(saved: boolean): void
}

interface TabsState {
  tabs: Tab[]
  activeKey: TabKey | null
  prompt: UnsavedPrompt | null
  saveAs: SaveAsRequest | null
  trustPrompt: TrustPrompt | null
  /** Full text of "large" bodies the user chose to display, by run id. */
  fullBodies: Record<string, string>
  /** Set once the session of the current Workspace was restored (enables saving it). */
  sessionReady: boolean

  reset(): void
  restore(session: SessionData): void
  activate(key: TabKey): void
  /** Opens a tree item; `preview` (single click) reuses the preview tab. */
  openItem(id: string, options?: { preview?: boolean }): void
  openEnvironments(): void
  /** New unsaved HTTP or WebSocket request ("+" button). */
  newRequest(type?: 'http' | 'websocket'): void
  /** Opens the Collection Runner for a Collection / folder (Phase 5c). */
  openRunner(targetId: string): void
  /** Opens a request (e.g. from a cURL import) as a new unsaved tab. */
  openDraft(request: HttpRequest): void
  /** Opens a history entry as a new unsaved request. */
  openHistoryEntry(entry: HistoryEntry): Promise<void>
  pin(key: TabKey): void
  /** Closes a tab, asking first if it has unsaved changes. Resolves false if cancelled. */
  close(key: TabKey): Promise<boolean>
  closeOthers(key: TabKey): Promise<void>
  closeAll(): Promise<boolean>
  /** CmdOrCtrl+W: the active tab, or the window when no tab is open. */
  closeActive(): Promise<void>

  updateRequest(key: TabKey, change: (draft: HttpRequest) => HttpRequest): void
  updateWs(key: TabKey, change: (draft: WsRequest) => WsRequest): void
  /** The message being written in a WebSocket tab (does not make the tab dirty). */
  updateComposer(key: TabKey, composer: WsComposer): void
  updateContainer(key: TabKey, change: (draft: ContainerContent) => ContainerContent): void
  updateEnvironment(
    key: TabKey,
    change: (draft: NonNullable<EnvironmentsTab['draft']>) => NonNullable<EnvironmentsTab['draft']>
  ): void
  /** Shows another environment in the manager tab (asks about unsaved edits first). */
  selectEnvironment(id: string | null): Promise<void>
  createEnvironment(name: string): Promise<void>
  duplicateEnvironment(id: string): Promise<void>
  deleteEnvironment(id: string): Promise<void>

  /** Saves a tab (the active one by default). Unsaved requests open "Save As". */
  save(key?: TabKey | null): Promise<boolean>
  requestSaveAs(key: TabKey): Promise<boolean>
  /** Called by the Save As dialog; throws so the dialog can show the error. */
  commitSaveAs(parentId: string, name: string): Promise<void>
  cancelSaveAs(): void

  send(key: TabKey): Promise<void>
  resolveTrust(choice: TrustChoice): void
  cancel(key: TabKey): Promise<void>
  showFullBody(key: TabKey, runId: string): Promise<void>
  downloadResponse(key: TabKey, runId: string): Promise<string | null>

  /** Re-reads files from disk, asking first if that replaces unsaved edits. */
  reload(target: ReloadScope): Promise<void>
  /** Before switching / closing the Workspace or the window. Resolves false if cancelled. */
  guardLeave(): Promise<boolean>
  resolvePrompt(choice: 'save' | 'discard' | 'cancel'): Promise<void>
  /** Re-reads inherited headers / auth of every open tab (after containers changed). */
  refreshInherited(): Promise<void>
  /** Re-reads environment / Collection tabs (without unsaved edits) a script changed. */
  variablesChanged(event: VariablesChangedEvent): void
  /** Applies a tree change (deleted / renamed items). */
  treeChanged(tree: WorkspaceTree): void
}

const tree = () => useTreeStore.getState().tree

/** Whether the current Workspace's scripts are trusted on this computer (decision 84). */
export function scriptsTrusted(): boolean {
  const { config, currentWorkspace } = useAppStore.getState()
  return !!currentWorkspace && !!config?.scripts.trustedWorkspaces.includes(currentWorkspace.path)
}

function newHttpRequest(): HttpRequest {
  return httpRequestSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    type: 'http',
    name: 'New Request'
  })
}

function newWsRequest(): WsRequest {
  return wsRequestSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    type: 'websocket',
    name: 'New WebSocket'
  })
}

/** A connected (or connecting) WebSocket tab: closing it drops the connection and its log. */
function isLiveTab(tab: Tab): boolean {
  return tab.kind === 'websocket' && isLive(useWsStore.getState().sessions[tab.uid])
}

/** Tabs that need a confirmation before they go away: unsaved or connected. */
const attentionKeys = (tabs: readonly Tab[]) =>
  tabs.filter((t) => isTabDirty(t) || isLiveTab(t)).map((t) => t.key)

export const useTabsStore = create<TabsState>()((set, get) => {
  const find = (key: TabKey) => get().tabs.find((t) => t.key === key)

  /** Replaces a tab (looked up by key) with `change(tab)`. */
  function patch<T extends Tab>(key: TabKey, change: (tab: T) => T): void {
    set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? change(t as T) : t)) }))
  }

  function setActive(key: TabKey | null): void {
    set({ activeKey: key })
    const tab = key ? find(key) : undefined
    const itemId = tab ? tabItemId(tab) : null
    // Keep the tree selection in step with the active tab (without opening anything).
    if (itemId && useTreeStore.getState().selectedId !== itemId) {
      useTreeStore.getState().reveal(itemId)
    }
    if (tab && tab.status === 'idle') void load(tab.key)
  }

  function ensureCollectionVariables(tab: Tab): void {
    const id = tab.kind === 'container' ? tab.itemId : contextParentId(tab, tree())
    const collectionId = collectionIdOf(tree(), id)
    if (collectionId) void useEnvStore.getState().ensureCollectionVariables(collectionId)
  }

  async function load(key: TabKey): Promise<void> {
    const tab = find(key)
    if (!tab || tab.kind === 'static' || tab.kind === 'runner') return
    if (isRequestLike(tab) && !tab.itemId) return
    patch(key, (t) => ({ ...t, status: 'loading', loadError: null }))
    try {
      if (isRequestLike(tab)) {
        const id = tab.itemId as string
        const { request, inherited } = await unwrap(window.hachi.request.get({ id }))
        if (request.type !== (tab.kind === 'request' ? 'http' : 'websocket')) {
          throw new Error('The request type changed; reload the Workspace')
        }
        patch<RequestLikeTab>(
          key,
          (t) =>
            ({
              ...t,
              status: 'ready',
              saved: request,
              draft: request,
              inherited,
              version: t.version + 1
            }) as RequestLikeTab
        )
      } else if (tab.kind === 'container') {
        const data = await unwrap(window.hachi.container.get({ id: tab.itemId }))
        const content = { headers: data.headers, auth: data.auth, variables: data.variables }
        if (data.kind === 'collection') {
          useEnvStore.getState().setCollectionVariables(tab.itemId, data.variables)
        }
        patch<ContainerTab>(key, (t) => ({
          ...t,
          status: 'ready',
          containerKind: data.kind,
          saved: content,
          draft: content,
          inherited: data.inherited,
          version: t.version + 1
        }))
      } else {
        const list = await useEnvStore.getState().loadList()
        const valid = list.filter((e) => !e.error)
        const keep = valid.find((e) => e.id === tab.selectedId)
        const activeId = useEnvStore.getState().activeId
        const selectedId =
          keep?.id ?? valid.find((e) => e.id === activeId)?.id ?? valid[0]?.id ?? null
        const env = selectedId ? await unwrap(window.hachi.env.get({ id: selectedId })) : null
        patch<EnvironmentsTab>(key, (t) => ({
          ...t,
          status: 'ready',
          selectedId,
          saved: env,
          draft: env,
          version: t.version + 1
        }))
      }
      const loaded = find(key)
      if (loaded) ensureCollectionVariables(loaded)
    } catch (error) {
      patch(key, (t) => ({ ...t, status: 'error', loadError: errorMessage(error) }))
    }
  }

  function addTab(tab: Tab): void {
    set((s) => ({ tabs: insertTab(s.tabs, tab, s.activeKey) }))
    setActive(tab.key)
  }

  function removeTab(key: TabKey): void {
    const tab = find(key)
    if (tab?.kind === 'request' && tab.runId) void window.hachi.http.cancel({ runId: tab.runId })
    if (tab?.kind === 'websocket') useWsStore.getState().remove(tab.uid)
    if (tab?.kind === 'runner') useRunnerStore.getState().remove(tab.uid)
    const next = nextActiveKey(get().tabs, key, get().activeKey)
    set((s) => ({ tabs: s.tabs.filter((t) => t.key !== key) }))
    setActive(next)
  }

  /** Shows the unsaved-changes prompt. Resolves true to go ahead. */
  function ask(keys: TabKey[], mode: UnsavedPrompt['mode']): Promise<boolean> {
    if (keys.length === 0) return Promise.resolve(true)
    if (get().prompt || get().saveAs) return Promise.resolve(false)
    if (!keys.includes(get().activeKey ?? '')) setActive(keys[0] as TabKey)
    return new Promise((resolve) => set({ prompt: { keys, mode, resolve } }))
  }

  const dirtyKeys = (tabs: readonly Tab[]) => tabs.filter(isTabDirty).map((t) => t.key)

  /** After saving, keep edits typed meanwhile: only the saved snapshot moves forward. */
  function afterSave<T extends Tab & { saved: unknown; draft: unknown }>(
    key: TabKey,
    sent: unknown,
    saved: T['saved']
  ): void {
    patch<T>(key, (t) => {
      const unchanged = JSON.stringify(t.draft) === JSON.stringify(sent)
      return { ...t, saving: false, saved, draft: unchanged ? saved : t.draft }
    })
  }

  return {
    tabs: [],
    activeKey: null,
    prompt: null,
    saveAs: null,
    trustPrompt: null,
    fullBodies: {},
    sessionReady: false,

    reset() {
      get().prompt?.resolve(false)
      get().saveAs?.resolve(false)
      get().trustPrompt?.resolve('cancel')
      set({
        tabs: [],
        activeKey: null,
        prompt: null,
        saveAs: null,
        trustPrompt: null,
        fullBodies: {},
        sessionReady: false
      })
    },

    restore(session) {
      const { tabs, activeKey } = fromSession(session, tree())
      set({ tabs, activeKey: null, sessionReady: true })
      setActive(activeKey)
    },

    activate(key) {
      if (find(key)) setActive(key)
    },

    openItem(id, options = {}) {
      const preview = options.preview ?? true
      const node = findNode(tree(), id)?.node
      if (!node) return
      const existing = find(itemTabKey(id))
      if (existing) {
        if (!preview) get().pin(existing.key)
        setActive(existing.key)
        return
      }
      addTab(createItemTab(node, preview))
    },

    openEnvironments() {
      const existing = find(ENVIRONMENTS_TAB_KEY)
      if (existing) setActive(existing.key)
      else addTab(createEnvironmentsTab())
    },

    newRequest(type = 'http') {
      addTab(
        type === 'websocket'
          ? createDraftTab(newWsRequest(), { parentId: null })
          : createDraftTab(newHttpRequest(), { parentId: null })
      )
    },

    openRunner(targetId) {
      const existing = find(runnerTabKey(targetId))
      if (existing) {
        setActive(existing.key)
        return
      }
      const tab = createRunnerTab(targetId)
      useRunnerStore.getState().open(tab.uid, targetId)
      addTab(tab)
    },

    openDraft(request) {
      addTab(createDraftTab(request, { parentId: null }))
    },

    async openHistoryEntry(entry) {
      const source = entry.requestId ? findNode(tree(), entry.requestId) : undefined
      const parentId = source ? parentIdOf(tree(), entry.requestId as string) : null
      const inherited = await unwrap(window.hachi.request.getInherited({ parentId })).catch(
        () => undefined
      )
      const request = { ...entry.request, id: crypto.randomUUID() }
      addTab(createDraftTab(request, { parentId, inherited }))
    },

    pin(key) {
      if (find(key)?.preview) patch(key, (t) => ({ ...t, preview: false }))
    },

    async close(key) {
      const tab = find(key)
      if (!tab) return true
      if ((isTabDirty(tab) || isLiveTab(tab)) && !(await ask([key], 'save'))) return false
      removeTab(key)
      return true
    },

    async closeOthers(key) {
      const others = get().tabs.filter((t) => t.key !== key)
      if (!(await ask(attentionKeys(others), 'save'))) return
      for (const t of others) removeTab(t.key)
      setActive(key)
    },

    async closeAll() {
      if (!(await ask(attentionKeys(get().tabs), 'save'))) return false
      for (const t of get().tabs) removeTab(t.key)
      return true
    },

    async closeActive() {
      const key = get().activeKey
      if (key) await get().close(key)
      else window.close()
    },

    updateRequest(key, change) {
      patch<RequestTab>(key, (t) =>
        t.kind === 'request' && t.draft ? { ...t, preview: false, draft: change(t.draft) } : t
      )
    },

    updateWs(key, change) {
      patch<WsTab>(key, (t) =>
        t.kind === 'websocket' && t.draft ? { ...t, preview: false, draft: change(t.draft) } : t
      )
    },

    updateComposer(key, composer) {
      patch<WsTab>(key, (t) => (t.kind === 'websocket' ? { ...t, composer } : t))
    },

    updateContainer(key, change) {
      patch<ContainerTab>(key, (t) =>
        t.kind === 'container' && t.draft ? { ...t, preview: false, draft: change(t.draft) } : t
      )
    },

    updateEnvironment(key, change) {
      patch<EnvironmentsTab>(key, (t) =>
        t.kind === 'environments' && t.draft ? { ...t, draft: change(t.draft) } : t
      )
    },

    async selectEnvironment(id) {
      const tab = find(ENVIRONMENTS_TAB_KEY)
      if (!tab || tab.kind !== 'environments' || tab.selectedId === id) return
      if (isTabDirty(tab) && !(await ask([tab.key], 'save'))) return
      patch<EnvironmentsTab>(tab.key, (t) => ({ ...t, selectedId: id }))
      await load(tab.key)
    },

    async createEnvironment(name) {
      const { id, list } = await unwrap(window.hachi.env.create({ name }))
      useEnvStore.getState().setList(list)
      await get().selectEnvironment(id)
    },

    async duplicateEnvironment(id) {
      const result = await unwrap(window.hachi.env.duplicate({ id }))
      useEnvStore.getState().setList(result.list)
      await get().selectEnvironment(result.id)
    },

    async deleteEnvironment(id) {
      const list = await unwrap(window.hachi.env.delete({ id }))
      useEnvStore.getState().setList(list)
      const tab = find(ENVIRONMENTS_TAB_KEY)
      if (tab?.kind === 'environments' && tab.selectedId === id) {
        // The deleted environment's edits are gone with it.
        patch<EnvironmentsTab>(tab.key, (t) => ({
          ...t,
          selectedId: null,
          saved: null,
          draft: null
        }))
        await load(tab.key)
      }
    },

    async save(keyInput) {
      const key = keyInput ?? get().activeKey
      const tab = key ? find(key) : undefined
      if (!tab || tab.kind === 'static' || tab.status !== 'ready') return true
      if (isDraftTab(tab)) return get().requestSaveAs(tab.key)
      patch(tab.key, (t) => ({ ...t, saving: true, saveError: null, preview: false }))
      try {
        if (isRequestLike(tab) && tab.draft && tab.itemId) {
          const sent = tab.draft
          const { request, tree: next } = await unwrap(
            window.hachi.request.save({ id: tab.itemId, request: sent })
          )
          useTreeStore.getState().applyTree(next)
          afterSave<RequestLikeTab>(tab.key, sent, request as RequestLikeTab['saved'])
        } else if (tab.kind === 'container' && tab.draft) {
          const sent = tab.draft
          const data = await unwrap(window.hachi.container.save({ id: tab.itemId, ...sent }))
          const saved = { headers: data.headers, auth: data.auth, variables: data.variables }
          afterSave<ContainerTab>(tab.key, sent, saved)
          if (data.kind === 'collection') {
            useEnvStore.getState().setCollectionVariables(tab.itemId, data.variables)
          }
          void get().refreshInherited()
        } else if (tab.kind === 'environments' && tab.draft) {
          const sent = tab.draft
          const saved = await unwrap(window.hachi.env.save(sent))
          afterSave<EnvironmentsTab>(tab.key, sent, saved)
          const list = await useEnvStore.getState().loadList()
          useEnvStore.getState().environmentChanged(saved, list)
        } else {
          patch(tab.key, (t) => ({ ...t, saving: false }))
        }
        return true
      } catch (error) {
        patch(tab.key, (t) => ({ ...t, saving: false, saveError: errorMessage(error) }))
        return false
      }
    },

    requestSaveAs(key) {
      if (get().saveAs) return Promise.resolve(false)
      setActive(key)
      return new Promise((resolve) => set({ saveAs: { key, resolve } }))
    },

    async commitSaveAs(parentId, name) {
      const pending = get().saveAs
      const tab = pending ? find(pending.key) : undefined
      if (!pending || !tab || !isRequestLike(tab) || !tab.draft) return
      const sent = tab.draft
      const result = await unwrap(window.hachi.request.saveAs({ parentId, name, request: sent }))
      useTreeStore.getState().applyTree(result.tree)
      const inherited = await unwrap(window.hachi.request.getInherited({ parentId })).catch(
        () => tab.inherited
      )
      const newKey = itemTabKey(result.id)
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.key !== pending.key || !isRequestLike(t)) return t
          const unchanged = JSON.stringify(t.draft) === JSON.stringify(sent)
          return {
            ...t,
            key: newKey,
            itemId: result.id,
            draftParentId: null,
            draftName: result.request.name,
            preview: false,
            saved: result.request,
            draft: unchanged ? result.request : t.draft,
            inherited
          } as RequestLikeTab
        }),
        activeKey: s.activeKey === pending.key ? newKey : s.activeKey,
        saveAs: null
      }))
      useTreeStore.getState().reveal(result.id)
      pending.resolve(true)
    },

    cancelSaveAs() {
      const pending = get().saveAs
      set({ saveAs: null })
      pending?.resolve(false)
    },

    async send(key) {
      const tab = find(key)
      if (tab?.kind !== 'request' || !tab.draft || tab.runId) return
      const request = tab.draft
      let skipScripts = false
      if (hasScripts(request.scripts) && !scriptsTrusted()) {
        const choice = await askScriptTrust()
        if (choice === 'cancel') return
        skipScripts = choice === 'skip'
      }
      const current = find(key)
      if (current?.kind !== 'request' || current.runId) return
      const runId = crypto.randomUUID()
      patch<RequestTab>(key, (t) => ({ ...t, runId, preview: false }))
      let result: HttpResult
      try {
        result = await unwrap(
          window.hachi.http.send({
            runId,
            requestId: tab.itemId,
            parentId: contextParentId(tab, tree()),
            environmentId: useEnvStore.getState().activeId,
            request,
            skipScripts
          })
        )
      } catch (error) {
        result = {
          kind: 'error',
          runId,
          code: 'UNKNOWN',
          message: errorMessage(error),
          url: request.url,
          timings: { totalMs: 0 },
          unresolvedVariables: []
        }
      }
      // The tab may have been renamed (Save As) or closed while the request ran.
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.kind === 'request' && t.runId === runId ? { ...t, runId: null, result } : t
        )
      }))
    },

    variablesChanged(event) {
      for (const t of get().tabs) {
        if (isTabDirty(t)) continue
        if (
          t.kind === 'environments' &&
          event.environmentId &&
          t.selectedId === event.environmentId
        ) {
          void load(t.key)
        }
        if (t.kind === 'container' && event.collectionId && t.itemId === event.collectionId) {
          void load(t.key)
        }
      }
    },

    resolveTrust(choice) {
      get().trustPrompt?.resolve(choice)
    },

    async cancel(key) {
      const tab = find(key)
      if (tab?.kind === 'request' && tab.runId) {
        await window.hachi.http.cancel({ runId: tab.runId })
      }
    },

    async showFullBody(key, runId) {
      try {
        const text = await unwrap(window.hachi.http.getBody({ runId }))
        set((s) => ({ fullBodies: { ...s.fullBodies, [runId]: text } }))
      } catch (error) {
        patch(key, (t) => ({ ...t, saveError: errorMessage(error) }))
      }
    },

    async downloadResponse(key, runId) {
      try {
        return await unwrap(window.hachi.http.saveResponse({ runId }))
      } catch (error) {
        patch(key, (t) => ({ ...t, saveError: errorMessage(error) }))
        return null
      }
    },

    async reload(target) {
      const node = target.scope === 'item' ? findNode(tree(), target.id)?.node : undefined
      const affected = get().tabs.filter((t) => {
        if (target.scope === 'workspace') return !isDraftTab(t)
        const id = tabItemId(t)
        return id !== null && (node ? isSelfOrDescendant(node, id) : id === target.id)
      })
      if (!(await ask(dirtyKeys(affected), 'discard'))) return
      try {
        useTreeStore.getState().applyTree(await unwrap(window.hachi.tree.reload(target)))
      } catch (error) {
        useTreeStore.setState({ error: errorMessage(error) })
        return
      }
      if (target.scope === 'workspace') {
        const env = useEnvStore.getState()
        env.clearCollectionVariables()
        await env.loadList()
        await env.setActive(env.activeId)
      }
      // Tabs of items that still exist re-read their files.
      for (const t of affected) {
        const current = find(t.key)
        if (!current) continue
        patch(t.key, (x) => ({ ...x, status: 'idle' }))
        if (get().activeKey === t.key || current.status !== 'idle') await load(t.key)
      }
    },

    guardLeave() {
      return ask(attentionKeys(get().tabs), 'save')
    },

    async resolvePrompt(choice) {
      const prompt = get().prompt
      if (!prompt) return
      set({ prompt: null })
      if (choice === 'cancel') return prompt.resolve(false)
      if (choice === 'discard') return prompt.resolve(true)
      // Connected-but-saved tabs only need the confirmation, not a save.
      for (const key of prompt.keys) {
        const tab = find(key)
        if (tab && isTabDirty(tab) && !(await get().save(key))) return prompt.resolve(false)
      }
      prompt.resolve(true)
    },

    async refreshInherited() {
      for (const tab of get().tabs) {
        if ((tab.kind !== 'request' && tab.kind !== 'container') || tab.status !== 'ready') continue
        const parentId = contextParentId(tab, tree())
        try {
          const inherited = await unwrap(window.hachi.request.getInherited({ parentId }))
          patch<RequestTab | ContainerTab>(tab.key, (t) => ({ ...t, inherited }))
        } catch {
          // The parent may have just been deleted; the next tree change syncs the tab.
        }
      }
    },

    treeChanged(next) {
      const before = get().tabs
      const tabs = syncTabsWithTree(before, next)
      const keys = new Set(tabs.map((t) => t.key))
      let activeKey = get().activeKey
      if (activeKey && !keys.has(activeKey)) {
        const index = before.findIndex((t) => t.key === activeKey)
        const survivor = [...before.slice(index + 1), ...before.slice(0, index).reverse()].find(
          (t) => keys.has(t.key)
        )
        activeKey = survivor?.key ?? null
      }
      set({ tabs })
      if (activeKey !== get().activeKey) setActive(activeKey)
      else if (activeKey && find(activeKey)?.status === 'idle') void load(activeKey)
      void get().refreshInherited()
    }
  }
})

// Follow tree changes (renames, deletions, moves) of the current Workspace.
useTreeStore.subscribe((state, prev) => {
  if (state.tree === prev.tree || !state.loaded) return
  if (state.tree.workspaceId !== prev.tree.workspaceId) return
  useTabsStore.getState().treeChanged(state.tree)
})

export { isTabDirty }

/**
 * "信任這個 Workspace 的腳本？" (decision 84). "trust" stores the trust before resolving;
 * resolves "cancel" if storing it failed.
 */
export async function askScriptTrust(): Promise<TrustChoice> {
  const choice = await new Promise<TrustChoice>((resolve) =>
    useTabsStore.setState({ trustPrompt: { resolve } })
  )
  useTabsStore.setState({ trustPrompt: null })
  if (choice !== 'trust') return choice
  try {
    const config = await unwrap(window.hachi.workspace.setScriptTrust({ trusted: true }))
    useAppStore.getState().configChanged(config)
    return 'trust'
  } catch (error) {
    useAppStore.getState().setNotice(errorMessage(error))
    return 'cancel'
  }
}
