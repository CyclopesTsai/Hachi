import { AlertTriangle, Loader2, MousePointerClick, Radio } from 'lucide-react'
import { useEffect } from 'react'
import { findNode } from '@shared/tree'
import { useEditorStore } from '@renderer/stores/editor-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { ContainerEditor } from './ContainerEditor'
import { RequestEditor } from './RequestEditor'

function Placeholder({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}

/** Right-hand side: the editor for the item selected in the tree. */
export function EditorHost() {
  const selectedId = useTreeStore((s) => s.selectedId)
  const node = useTreeStore((s) =>
    s.selectedId ? findNode(s.tree, s.selectedId)?.node : undefined
  )
  const doc = useEditorStore((s) => s.doc)
  const docVersion = useEditorStore((s) => s.docVersion)
  const loading = useEditorStore((s) => s.loading)
  const loadError = useEditorStore((s) => s.loadError)

  const editable =
    node && !node.error && (node.kind !== 'request' || node.requestType === 'http')
      ? node.kind
      : null

  // Open the selected item. Re-runs only when the selection (or its kind) changes,
  // not when the tree is re-read, so unsaved edits are never replaced silently.
  useEffect(() => {
    const editor = useEditorStore.getState()
    if (!selectedId || !editable) editor.close()
    else if (editable === 'request') void editor.openRequest(selectedId)
    else void editor.openContainer(selectedId)
  }, [selectedId, editable])

  if (!node) {
    return (
      <Placeholder icon={<MousePointerClick className="size-6" />}>
        從左側選擇一個請求，或按右鍵新增項目。
      </Placeholder>
    )
  }
  if (node.error) {
    return (
      <div className="flex flex-col gap-3 p-6" data-testid="item-details">
        <h2 className="text-lg font-semibold">{node.name}</h2>
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            無法讀取這個檔案：{node.error}
            <br />
            請修正 JSON 內容後按「重新讀取」，或從左側刪除。
          </span>
        </p>
        <p className="font-mono text-xs text-muted-foreground">{node.relPath}</p>
      </div>
    )
  }
  if (node.kind === 'request' && node.requestType === 'websocket') {
    return (
      <Placeholder icon={<Radio className="size-6" />}>
        WebSocket 連線「{node.name}」的設定與訊息功能將於 Phase 4 加入。
      </Placeholder>
    )
  }
  if (loadError) {
    return (
      <Placeholder icon={<AlertTriangle className="size-6 text-destructive" />}>
        無法開啟：{loadError}
      </Placeholder>
    )
  }
  if (loading || !doc || doc.id !== node.id) {
    return <Placeholder icon={<Loader2 className="size-5 animate-spin" />}>載入中…</Placeholder>
  }
  // A fresh editor per loaded document: no undo history leaking between requests.
  const key = `${doc.id}:${docVersion}`
  return doc.kind === 'request' ? (
    <RequestEditor key={key} doc={doc} name={node.name} />
  ) : (
    <ContainerEditor key={key} doc={doc} name={node.name} />
  )
}
