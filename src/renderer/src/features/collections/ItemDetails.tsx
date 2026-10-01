import { AlertTriangle, MousePointerClick } from 'lucide-react'
import { findNode } from '@shared/tree'
import { useTreeStore } from '@renderer/stores/tree-store'
import { RequestBadge } from './RequestBadge'

/**
 * Right-hand panel for the selected item. Phase 1 shows basic information only;
 * the HTTP editor (Phase 2) and WebSocket client (Phase 4) replace it.
 */
export function ItemDetails() {
  const node = useTreeStore((s) =>
    s.selectedId ? findNode(s.tree, s.selectedId)?.node : undefined
  )

  if (!node) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <MousePointerClick className="size-6" />
        從左側選擇一個請求，或按右鍵新增項目。
      </div>
    )
  }

  const kindLabel = node.error
    ? '無法讀取的檔案'
    : node.kind === 'collection'
      ? 'Collection'
      : node.kind === 'folder'
        ? '資料夾'
        : node.requestType === 'websocket'
          ? 'WebSocket 連線'
          : 'HTTP 請求'

  return (
    <div className="flex flex-1 flex-col gap-4 p-6" data-testid="item-details">
      <div className="flex items-center gap-2">
        {node.kind === 'request' && !node.error && (
          <RequestBadge node={node} className="w-auto text-xs" />
        )}
        <h2 className="truncate text-lg font-semibold" data-testid="item-details-name">
          {node.name}
        </h2>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">類型</dt>
        <dd>{kindLabel}</dd>
        <dt className="text-muted-foreground">檔案位置</dt>
        <dd className="font-mono text-xs break-all">{node.relPath}</dd>
      </dl>
      {node.error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            無法讀取這個檔案：{node.error}
            <br />
            請修正 JSON 內容，或從左側刪除。
          </span>
        </p>
      )}
      {node.kind === 'request' && !node.error && (
        <p className="text-sm text-muted-foreground">
          {node.requestType === 'websocket'
            ? 'WebSocket 連線設定將於 Phase 4 加入。'
            : 'HTTP 請求編輯器將於 Phase 2 加入。'}
        </p>
      )}
    </div>
  )
}
