import { create } from 'zustand'
import type { ContainerSettingsData, HttpResult, InheritedSettings } from '@shared/http'
import type { Auth, KeyValue } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import { findNode, isSelfOrDescendant } from '@shared/tree'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { setSelectGuard, useTreeStore } from './tree-store'

export interface RequestDoc {
  kind: 'request'
  id: string
  saved: HttpRequest
  draft: HttpRequest
  inherited: InheritedSettings
}

export interface ContainerContent {
  headers: KeyValue[]
  auth: Auth
}

export interface ContainerDoc {
  kind: 'container'
  id: string
  containerKind: 'collection' | 'folder'
  saved: ContainerContent
  draft: ContainerContent
  inherited: InheritedSettings
}

export type EditorDoc = RequestDoc | ContainerDoc

export type ReloadScope = { scope: 'workspace' } | { scope: 'item'; id: string }

/** Something the user asked for that would throw away unsaved changes. */
export type PendingAction =
  { type: 'select'; id: string | null } | { type: 'reload'; target: ReloadScope }

export interface RunState {
  runId: string
  requestId: string
}

interface EditorState {
  doc: EditorDoc | null
  /** Bumped every time a document is (re)loaded from disk; used to remount editors. */
  docVersion: number
  loading: boolean
  loadError: string | null
  saving: boolean
  saveError: string | null
  pending: PendingAction | null
  /** Running HTTP request (one at a time in Phase 2). */
  run: RunState | null
  /** Last result per request id (kept in memory while the app runs). */
  results: Record<string, HttpResult>
  /** Full text of "large" bodies the user chose to display, by run id. */
  fullBodies: Record<string, string>

  openRequest(id: string): Promise<void>
  openContainer(id: string): Promise<void>
  close(): void
  updateRequest(change: (draft: HttpRequest) => HttpRequest): void
  updateContainer(change: (draft: ContainerContent) => ContainerContent): void
  /** Saves the open document. Returns false if saving failed. */
  save(): Promise<boolean>
  /** Drops unsaved changes. */
  discard(): void

  send(): Promise<void>
  cancel(): Promise<void>
  showFullBody(runId: string): Promise<void>
  downloadResponse(runId: string): Promise<string | null>

  /** Re-reads files from disk (whole Workspace or one item), asking first if that loses edits. */
  reload(target: ReloadScope): Promise<void>
  /** Resolves the unsaved-changes prompt. */
  resolvePending(choice: 'save' | 'discard' | 'cancel'): Promise<void>
}

export function isDirty(doc: EditorDoc | null): boolean {
  return doc !== null && JSON.stringify(doc.draft) !== JSON.stringify(doc.saved)
}

/** True if reloading `target` re-reads the document that is open in the editor. */
function affectsDoc(target: ReloadScope, doc: EditorDoc | null): boolean {
  if (!doc) return false
  if (target.scope === 'workspace') return true
  const node = findNode(useTreeStore.getState().tree, target.id)?.node
  return node ? isSelfOrDescendant(node, doc.id) : target.id === doc.id
}

export const useEditorStore = create<EditorState>()((set, get) => {
  async function performReload(target: ReloadScope): Promise<void> {
    const tree = useTreeStore.getState()
    const reopen = affectsDoc(target, get().doc) ? get().doc : null
    try {
      tree.applyTree(await unwrap(window.hachi.tree.reload(target)))
    } catch (error) {
      useTreeStore.setState({ error: errorMessage(error) })
      return
    }
    // The editor re-reads its file if it was part of the reload (and still exists).
    if (reopen && findNode(useTreeStore.getState().tree, reopen.id)) {
      if (reopen.kind === 'request') await get().openRequest(reopen.id)
      else await get().openContainer(reopen.id)
    }
  }

  return {
    doc: null,
    docVersion: 0,
    loading: false,
    loadError: null,
    saving: false,
    saveError: null,
    pending: null,
    run: null,
    results: {},
    fullBodies: {},

    async openRequest(id) {
      set({ loading: true, loadError: null, saveError: null })
      try {
        const { request, inherited } = await unwrap(window.hachi.request.get({ id }))
        set({
          doc: { kind: 'request', id, saved: request, draft: request, inherited },
          loading: false
        })
      } catch (error) {
        set({ doc: null, loading: false, loadError: errorMessage(error) })
      }
    },

    async openContainer(id) {
      set({ loading: true, loadError: null, saveError: null })
      try {
        const data: ContainerSettingsData = await unwrap(window.hachi.container.get({ id }))
        const content = { headers: data.headers, auth: data.auth }
        set((s) => ({
          doc: {
            kind: 'container',
            id,
            containerKind: data.kind,
            saved: content,
            draft: content,
            inherited: data.inherited
          },
          docVersion: s.docVersion + 1,
          loading: false
        }))
      } catch (error) {
        set({ doc: null, loading: false, loadError: errorMessage(error) })
      }
    },

    close() {
      set({ doc: null, loadError: null, saveError: null, loading: false })
    },

    updateRequest(change) {
      const doc = get().doc
      if (doc?.kind !== 'request') return
      set({ doc: { ...doc, draft: change(doc.draft) } })
    },

    updateContainer(change) {
      const doc = get().doc
      if (doc?.kind !== 'container') return
      set({ doc: { ...doc, draft: change(doc.draft) } })
    },

    async save() {
      const doc = get().doc
      if (!doc) return true
      set({ saving: true, saveError: null })
      try {
        if (doc.kind === 'request') {
          const { request, tree } = await unwrap(
            window.hachi.request.save({ id: doc.id, request: doc.draft })
          )
          useTreeStore.getState().applyTree(tree)
          const current = get().doc
          // Keep edits typed while saving; only the saved snapshot moves forward.
          if (current?.id === doc.id && current.kind === 'request') {
            const unchanged = JSON.stringify(current.draft) === JSON.stringify(doc.draft)
            set({ doc: { ...current, saved: request, draft: unchanged ? request : current.draft } })
          }
        } else {
          const data = await unwrap(
            window.hachi.container.save({
              id: doc.id,
              headers: doc.draft.headers,
              auth: doc.draft.auth
            })
          )
          const current = get().doc
          if (current?.id === doc.id && current.kind === 'container') {
            const saved = { headers: data.headers, auth: data.auth }
            const unchanged = JSON.stringify(current.draft) === JSON.stringify(doc.draft)
            set({ doc: { ...current, saved, draft: unchanged ? saved : current.draft } })
          }
        }
        set({ saving: false })
        return true
      } catch (error) {
        set({ saving: false, saveError: errorMessage(error) })
        return false
      }
    },

    discard() {
      const doc = get().doc
      if (doc) set({ doc: { ...doc, draft: doc.saved } as EditorDoc })
    },

    async send() {
      const doc = get().doc
      if (doc?.kind !== 'request' || get().run) return
      const runId = crypto.randomUUID()
      set({ run: { runId, requestId: doc.id } })
      let result: HttpResult
      try {
        result = await unwrap(
          window.hachi.http.send({ runId, requestId: doc.id, request: doc.draft })
        )
      } catch (error) {
        result = {
          kind: 'error',
          runId,
          code: 'UNKNOWN',
          message: errorMessage(error),
          url: doc.draft.url,
          timings: { totalMs: 0 }
        }
      }
      set((s) => ({ run: null, results: { ...s.results, [doc.id]: result } }))
    },

    async cancel() {
      const run = get().run
      if (run) await window.hachi.http.cancel({ runId: run.runId })
    },

    async showFullBody(runId) {
      try {
        const text = await unwrap(window.hachi.http.getBody({ runId }))
        set((s) => ({ fullBodies: { ...s.fullBodies, [runId]: text } }))
      } catch (error) {
        set({ saveError: errorMessage(error) })
      }
    },

    async downloadResponse(runId) {
      try {
        return await unwrap(window.hachi.http.saveResponse({ runId }))
      } catch (error) {
        set({ saveError: errorMessage(error) })
        return null
      }
    },

    async reload(target) {
      if (isDirty(get().doc) && affectsDoc(target, get().doc)) {
        set({ pending: { type: 'reload', target } })
        return
      }
      await performReload(target)
    },

    async resolvePending(choice) {
      const pending = get().pending
      set({ pending: null })
      if (!pending || choice === 'cancel') return
      if (choice === 'save' && !(await get().save())) return
      if (choice === 'discard') get().discard()
      if (pending.type === 'select') useTreeStore.getState().select(pending.id)
      else await performReload(pending.target)
    }
  }
})

// Selecting another item while the open document has unsaved changes asks first.
setSelectGuard((id) => {
  const { doc } = useEditorStore.getState()
  if (!isDirty(doc) || id === doc?.id) return true
  useEditorStore.setState({ pending: { type: 'select', id } })
  return false
})
