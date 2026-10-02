/**
 * Pure helpers for the tab list (no store access, unit-tested).
 */
import type { HttpResult, InheritedSettings } from '@shared/http'
import type { EnvironmentData } from '@shared/ipc/api'
import type { Auth, KeyValue, Variable } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import type { AnyRequest } from '@shared/schemas/request'
import type { WsMessageFormat, WsRequest } from '@shared/schemas/ws-request'
import type { SessionData, SessionTab } from '@shared/schemas/session'
import { findNode, isContainer, type TreeNode, type WorkspaceTree } from '@shared/tree'

export type TabKey = string
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface TabBase {
  key: TabKey
  /** Never changes, even when an unsaved request is saved (its key changes then). */
  uid: string
  /** Preview tabs (italic) are replaced by the next single-clicked item. */
  preview: boolean
  status: LoadStatus
  loadError: string | null
  saving: boolean
  saveError: string | null
  /** Bumped whenever content is (re)loaded from disk; editors remount on change. */
  version: number
}

export interface RequestTab extends TabBase {
  kind: 'request'
  /** Saved request item; null for an unsaved request (new tab, history, deleted item). */
  itemId: string | null
  /** For unsaved requests: where inherited settings / collection variables come from. */
  draftParentId: string | null
  /** For unsaved requests: tab title and default name when saving. */
  draftName: string
  /** Last saved content; null = never saved (always counts as unsaved). */
  saved: HttpRequest | null
  draft: HttpRequest | null
  inherited: InheritedSettings
  runId: string | null
  result: HttpResult | null
}

export interface ContainerContent {
  headers: KeyValue[]
  auth: Auth
  variables: Variable[]
}

export interface ContainerTab extends TabBase {
  kind: 'container'
  itemId: string
  containerKind: 'collection' | 'folder'
  saved: ContainerContent | null
  draft: ContainerContent | null
  inherited: InheritedSettings
}

export interface EnvironmentsTab extends TabBase {
  kind: 'environments'
  /** Environment shown in the editor. */
  selectedId: string | null
  saved: EnvironmentData | null
  draft: EnvironmentData | null
}

export interface WsComposer {
  format: WsMessageFormat
  content: string
}

/**
 * A WebSocket request. The connection and its message log live in the ws store
 * (keyed by `uid`), so streaming messages don't re-render the tab list.
 */
export interface WsTab extends TabBase {
  kind: 'websocket'
  itemId: string | null
  draftParentId: string | null
  draftName: string
  saved: WsRequest | null
  draft: WsRequest | null
  inherited: InheritedSettings
  /** The message being written (not saved, never makes the tab dirty). */
  composer: WsComposer
}

/** Unreadable items: nothing to edit, the view comes from the tree. */
export interface StaticTab extends TabBase {
  kind: 'static'
  itemId: string
}

export type Tab = RequestTab | ContainerTab | EnvironmentsTab | StaticTab | WsTab

/** Tabs that edit a request file (HTTP or WebSocket), saved or not. */
export type RequestLikeTab = RequestTab | WsTab

export function isRequestLike(tab: Tab): tab is RequestLikeTab {
  return tab.kind === 'request' || tab.kind === 'websocket'
}

export const ENVIRONMENTS_TAB_KEY = 'environments'
export const EMPTY_INHERITED: InheritedSettings = { headers: [], auth: null }

export const itemTabKey = (id: string): TabKey => `item:${id}`

export function tabItemId(tab: Tab): string | null {
  return tab.kind === 'environments' ? null : tab.itemId
}

const tabBase = (key: TabKey, preview: boolean): TabBase => ({
  key,
  uid: crypto.randomUUID(),
  preview,
  status: 'idle',
  loadError: null,
  saving: false,
  saveError: null,
  version: 0
})

/** A tab for a tree item, not loaded yet. */
export function createItemTab(node: TreeNode, preview: boolean): Tab {
  const key = itemTabKey(node.id)
  if (node.error) {
    return { ...tabBase(key, preview), kind: 'static', itemId: node.id, status: 'ready' }
  }
  if (node.kind === 'request' && node.requestType === 'websocket') {
    return {
      ...tabBase(key, preview),
      kind: 'websocket',
      itemId: node.id,
      draftParentId: null,
      draftName: node.name,
      saved: null,
      draft: null,
      inherited: EMPTY_INHERITED,
      composer: { format: 'text', content: '' }
    }
  }
  if (node.kind === 'request') {
    return {
      ...tabBase(key, preview),
      kind: 'request',
      itemId: node.id,
      draftParentId: null,
      draftName: node.name,
      saved: null,
      draft: null,
      inherited: EMPTY_INHERITED,
      runId: null,
      result: null
    }
  }
  return {
    ...tabBase(key, preview),
    kind: 'container',
    itemId: node.id,
    containerKind: node.kind,
    saved: null,
    draft: null,
    inherited: EMPTY_INHERITED
  }
}

/** An unsaved request (from the "+" button or a history entry). */
export function createDraftTab(
  request: HttpRequest,
  options: { parentId: string | null; inherited?: InheritedSettings }
): RequestTab
export function createDraftTab(
  request: WsRequest,
  options: { parentId: string | null; inherited?: InheritedSettings }
): WsTab
export function createDraftTab(
  request: AnyRequest,
  options: { parentId: string | null; inherited?: InheritedSettings }
): RequestLikeTab
export function createDraftTab(
  request: AnyRequest,
  options: { parentId: string | null; inherited?: InheritedSettings }
): RequestLikeTab {
  const common = {
    ...tabBase(`draft:${crypto.randomUUID()}`, false),
    itemId: null,
    draftParentId: options.parentId,
    draftName: request.name,
    status: 'ready' as const,
    inherited: options.inherited ?? EMPTY_INHERITED
  }
  if (request.type === 'websocket') {
    return {
      ...common,
      kind: 'websocket',
      saved: request,
      draft: request,
      composer: { format: 'text', content: '' }
    }
  }
  return { ...common, kind: 'request', saved: request, draft: request, runId: null, result: null }
}

export function createEnvironmentsTab(): EnvironmentsTab {
  return {
    ...tabBase(ENVIRONMENTS_TAB_KEY, false),
    kind: 'environments',
    selectedId: null,
    saved: null,
    draft: null
  }
}

export function isTabDirty(tab: Tab): boolean {
  if (tab.kind === 'static' || tab.status !== 'ready') return false
  if (isRequestLike(tab) && tab.saved === null) return true
  if (tab.draft === null) return false
  return JSON.stringify(tab.draft) !== JSON.stringify(tab.saved)
}

/** An unsaved request (not a type guard: saved request tabs are RequestTabs too). */
export function isDraftTab(tab: Tab): boolean {
  return isRequestLike(tab) && tab.itemId === null
}

export function tabTitle(tab: Tab, tree: WorkspaceTree): string {
  if (tab.kind === 'environments') return '環境'
  if (isRequestLike(tab) && tab.itemId === null) return tab.draftName
  const id = tabItemId(tab)
  return (id && findNode(tree, id)?.node.name) ?? (isRequestLike(tab) ? tab.draftName : '')
}

/** Parent container of a tree item (null for collections and unknown ids). */
export function parentIdOf(tree: WorkspaceTree, id: string): string | null {
  return findNode(tree, id)?.parent?.id ?? null
}

/** The collection an item (or container) belongs to. */
export function collectionIdOf(tree: WorkspaceTree, id: string | null): string | null {
  if (!id) return null
  for (const collection of tree.collections) {
    if (collection.id === id || findNode({ ...tree, collections: [collection] }, id)) {
      return collection.id
    }
  }
  return null
}

/** Container providing inherited settings and collection variables to a tab. */
export function contextParentId(tab: Tab, tree: WorkspaceTree): string | null {
  if (isRequestLike(tab)) {
    return tab.itemId ? parentIdOf(tree, tab.itemId) : tab.draftParentId
  }
  if (tab.kind === 'container') return parentIdOf(tree, tab.itemId)
  return null
}

/**
 * Adds a tab after the active one. A new preview tab takes the place of the
 * existing preview tab (which is never dirty: any change pins it).
 */
export function insertTab(tabs: readonly Tab[], tab: Tab, activeKey: TabKey | null): Tab[] {
  if (tab.preview) {
    const previewIndex = tabs.findIndex((t) => t.preview)
    if (previewIndex >= 0) return tabs.map((t, i) => (i === previewIndex ? tab : t))
  }
  const activeIndex = tabs.findIndex((t) => t.key === activeKey)
  const at = activeIndex >= 0 ? activeIndex + 1 : tabs.length
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)]
}

/** Which tab becomes active after closing `key` (the right neighbour, else the left). */
export function nextActiveKey(tabs: readonly Tab[], key: TabKey, activeKey: TabKey | null) {
  if (activeKey !== key) return activeKey
  const index = tabs.findIndex((t) => t.key === key)
  return (tabs[index + 1] ?? tabs[index - 1])?.key ?? null
}

/**
 * Follows the tree after a change: tabs of deleted items close, or become unsaved
 * requests if they had changes. Kinds that changed (e.g. an unreadable file that
 * was fixed) are replaced by a fresh tab.
 */
export function syncTabsWithTree(tabs: readonly Tab[], tree: WorkspaceTree): Tab[] {
  return tabs.flatMap((tab): Tab[] => {
    const id = tabItemId(tab)
    if (!id) return [tab]
    const node = findNode(tree, id)?.node
    if (!node) {
      if (isRequestLike(tab) && isTabDirty(tab)) {
        return [{ ...tab, itemId: null, draftParentId: null, saved: null, preview: false }]
      }
      return []
    }
    const fresh = createItemTab(node, tab.preview)
    if (fresh.kind !== tab.kind) return [fresh]
    if (tab.kind === 'container' && isContainer(node) && tab.containerKind !== node.kind) {
      return [fresh]
    }
    if (isRequestLike(tab) && tab.draftName !== node.name) {
      return [{ ...tab, draftName: node.name }]
    }
    return [tab]
  })
}

/** What is remembered between launches: saved items and the environments tab. */
export function toSession(
  tabs: readonly Tab[],
  activeKey: TabKey | null,
  activeEnvironmentId: string | null
): SessionData {
  const kept = tabs.filter((t) => !isDraftTab(t))
  const sessionTabs = kept.map((t): SessionTab =>
    t.kind === 'environments' ? { kind: 'environments' } : { kind: 'item', id: t.itemId as string }
  )
  const active = kept.findIndex((t) => t.key === activeKey)
  return { tabs: sessionTabs, activeTab: active >= 0 ? active : null, activeEnvironmentId }
}

/** Rebuilds tabs from a saved session, skipping items that no longer exist. */
export function fromSession(
  session: SessionData,
  tree: WorkspaceTree
): { tabs: Tab[]; activeKey: TabKey | null } {
  const tabs: Tab[] = []
  let activeKey: TabKey | null = null
  session.tabs.forEach((saved, i) => {
    let tab: Tab | null = null
    if (saved.kind === 'environments') tab = createEnvironmentsTab()
    else {
      const node = findNode(tree, saved.id)?.node
      if (node) tab = createItemTab(node, false)
    }
    if (!tab || tabs.some((t) => t.key === tab.key)) return
    tabs.push(tab)
    if (i === session.activeTab) activeKey = tab.key
  })
  return { tabs, activeKey: activeKey ?? tabs[0]?.key ?? null }
}

export interface ContainerOption {
  id: string
  /** "Collection / Folder / Sub" */
  label: string
}

/** Every collection and folder, depth-first, for "Save As" location pickers. */
export function containerOptions(tree: WorkspaceTree): ContainerOption[] {
  const options: ContainerOption[] = []
  const visit = (node: TreeNode, trail: string[]): void => {
    if (!isContainer(node) || node.error) return
    const label = [...trail, node.name]
    options.push({ id: node.id, label: label.join(' / ') })
    for (const child of node.children) visit(child, label)
  }
  for (const c of tree.collections) visit(c, [])
  return options
}
