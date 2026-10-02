import { create } from 'zustand'
import type { RequestType } from '@shared/schemas/collection'
import { findNode, type ItemKind, type WorkspaceTree } from '@shared/tree'
import { ancestorIds } from '@renderer/features/collections/tree-model'
import { errorMessage, unwrap } from '@renderer/lib/ipc'

const EMPTY: WorkspaceTree = { workspaceId: null, collections: [] }

/** Default names for new items; the row immediately enters rename mode. */
const DEFAULT_NAMES: Record<ItemKind | 'websocket', string> = {
  collection: 'New Collection',
  folder: 'New Folder',
  request: 'New Request',
  websocket: 'New WebSocket'
}

interface TreeState {
  tree: WorkspaceTree
  loaded: boolean
  selectedId: string | null
  /** Ids of expanded collections / folders. */
  expanded: ReadonlySet<string>
  /** Id of the row showing the inline rename field. */
  editingId: string | null
  /** Last failed operation, shown in the sidebar until dismissed. */
  error: string | null

  load(): Promise<void>
  /** Applies a tree pushed by main (`tree:changed`) or returned by an operation. */
  applyTree(tree: WorkspaceTree): void
  reset(): void
  select(id: string | null): void
  /** Selects an item and expands its collection / folders so it is visible. */
  reveal(id: string): void
  toggle(id: string): void
  setEditing(id: string | null): void
  dismissError(): void

  /** Creates an item (in rename mode). Resolves its id, or null on failure. */
  create(parentId: string | null, kind: ItemKind, requestType?: RequestType): Promise<string | null>
  rename(id: string, name: string): Promise<void>
  /** Resolves the id of the copy, or null on failure. */
  duplicate(id: string): Promise<string | null>
  remove(id: string): Promise<void>
  move(id: string, parentId: string | null, index: number): Promise<void>
}

export const useTreeStore = create<TreeState>()((set, get) => {
  /** Runs an IPC operation, recording its error instead of throwing. */
  async function attempt(operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
      set({ error: null })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  }

  function expandAll(ids: string[]): void {
    if (ids.length === 0) return
    set((s) => ({ expanded: new Set([...s.expanded, ...ids]) }))
  }

  return {
    tree: EMPTY,
    loaded: false,
    selectedId: null,
    expanded: new Set(),
    editingId: null,
    error: null,

    async load() {
      await attempt(async () => {
        get().applyTree(await unwrap(window.hachi.tree.get()))
      })
    },

    applyTree(tree) {
      set((s) => {
        const workspaceChanged = tree.workspaceId !== s.tree.workspaceId
        const keep = (id: string | null) =>
          id && !workspaceChanged && findNode(tree, id) ? id : null
        return {
          tree,
          loaded: true,
          selectedId: keep(s.selectedId),
          editingId: keep(s.editingId),
          expanded: workspaceChanged ? new Set() : s.expanded
        }
      })
    },

    reset() {
      set({
        tree: EMPTY,
        loaded: false,
        selectedId: null,
        editingId: null,
        expanded: new Set(),
        error: null
      })
    },

    select(id) {
      if (id !== get().selectedId) set({ selectedId: id })
    },

    reveal(id) {
      expandAll(ancestorIds(get().tree, id))
      get().select(id)
    },

    toggle(id) {
      set((s) => {
        const expanded = new Set(s.expanded)
        if (expanded.has(id)) expanded.delete(id)
        else expanded.add(id)
        return { expanded }
      })
    },

    setEditing(id) {
      set({ editingId: id })
    },

    dismissError() {
      set({ error: null })
    },

    async create(parentId, kind, requestType) {
      let created: string | null = null
      await attempt(async () => {
        const name =
          DEFAULT_NAMES[kind === 'request' && requestType === 'websocket' ? 'websocket' : kind]
        const result = await unwrap(
          window.hachi.item.create({
            parentId,
            kind,
            name,
            ...(requestType ? { requestType } : {})
          })
        )
        get().applyTree(result.tree)
        expandAll(ancestorIds(result.tree, result.id))
        get().select(result.id)
        set({ editingId: result.id })
        created = result.id
      })
      return created
    },

    async rename(id, name) {
      set({ editingId: null })
      const current = findNode(get().tree, id)?.node
      if (!current || current.name === name.trim() || name.trim() === '') return
      await attempt(async () => {
        get().applyTree(await unwrap(window.hachi.item.rename({ id, name })))
      })
    },

    async duplicate(id) {
      let copy: string | null = null
      await attempt(async () => {
        const result = await unwrap(window.hachi.item.duplicate({ id }))
        get().applyTree(result.tree)
        get().select(result.id)
        copy = result.id
      })
      return copy
    },

    async remove(id) {
      await attempt(async () => {
        get().applyTree(await unwrap(window.hachi.item.delete({ id })))
      })
    },

    async move(id, parentId, index) {
      await attempt(async () => {
        const tree = await unwrap(window.hachi.item.move({ id, parentId, index }))
        get().applyTree(tree)
        if (parentId) expandAll([...ancestorIds(tree, parentId), parentId])
      })
    }
  }
})
