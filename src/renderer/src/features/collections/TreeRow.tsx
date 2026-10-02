import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  FilePlus2,
  FileWarning,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Pencil,
  Radio,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ITEM_NAME_MAX } from '@shared/schemas/collection'
import { isContainer, type TreeNode } from '@shared/tree'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { cn } from '@renderer/lib/utils'
import { isTabDirty, itemTabKey } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { RequestBadge } from './RequestBadge'
import type { DropPosition, FlatRow } from './tree-model'

export interface DropIndicator {
  targetId: string
  position: DropPosition
  valid: boolean
}

function InlineRename({
  initial,
  onDone
}: {
  initial: string
  onDone: (value: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (result: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(result)
  }
  return (
    <input
      aria-label="名稱"
      data-testid="tree-rename-input"
      className="h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm outline-none"
      value={value}
      maxLength={ITEM_NAME_MAX}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

function NodeIcon({ node, open, method }: { node: TreeNode; open: boolean; method?: string }) {
  if (node.kind === 'request' && node.error) {
    return (
      <span className="flex w-11 shrink-0 justify-end">
        <FileWarning className="size-4 text-muted-foreground" />
      </span>
    )
  }
  if (node.kind === 'collection') return <Layers className="size-4 shrink-0 text-primary" />
  if (node.kind === 'folder') {
    const Icon = open ? FolderOpen : Folder
    return <Icon className="size-4 shrink-0 text-muted-foreground" />
  }
  return <RequestBadge node={node} method={method} />
}

export function TreeRow({
  row,
  drop,
  onRequestDelete
}: {
  row: FlatRow
  drop: DropIndicator | null
  onRequestDelete: (node: TreeNode) => void
}) {
  const { node, depth } = row
  const selected = useTreeStore((s) => s.selectedId === node.id)
  const editing = useTreeStore((s) => s.editingId === node.id)
  const expanded = useTreeStore((s) => s.expanded.has(node.id))
  const tab = useTabsStore((s) => s.tabs.find((t) => t.key === itemTabKey(node.id)))
  const unsaved = tab ? isTabDirty(tab) : false
  // The method being edited in an open tab, so the tree matches the editor.
  const method = tab?.kind === 'request' ? tab.draft?.method : undefined
  const { select, toggle, setEditing, rename, duplicate, create } = useTreeStore.getState()
  const tabs = useTabsStore.getState()
  const open = (preview: boolean) => {
    select(node.id)
    tabs.openItem(node.id, { preview })
  }
  const createAndOpen = (...args: Parameters<typeof create>) =>
    void create(...args).then((id) => id && tabs.openItem(id, { preview: false }))
  const container = isContainer(node)
  const broken = node.error !== undefined

  const drag = useDraggable({ id: node.id, disabled: editing || broken })
  const dropZone = useDroppable({ id: node.id })
  const rowRef = useRef<HTMLDivElement | null>(null)
  const { setNodeRef: setDragRef } = drag
  const { setNodeRef: setDropRef } = dropZone
  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element
      setDragRef(element)
      setDropRef(element)
    },
    [setDragRef, setDropRef]
  )

  // Keep keyboard focus on the row after an inline rename finishes.
  useEffect(() => {
    if (!editing && selected && document.activeElement === document.body) rowRef.current?.focus()
  }, [editing, selected])

  const startRename = (): void => {
    if (!broken) setEditing(node.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (editing) return
    if (e.key === 'F2') {
      e.preventDefault()
      startRename()
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      onRequestDelete(node)
    } else if (container && e.key === 'ArrowRight' && !expanded) {
      toggle(node.id)
    } else if (container && e.key === 'ArrowLeft' && expanded) {
      toggle(node.id)
    } else if (e.key === 'Enter') {
      if (container) toggle(node.id)
      open(false)
    }
  }

  const here = drop?.targetId === node.id ? drop : null

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setRefs}
          {...drag.attributes}
          {...drag.listeners}
          // dnd-kit marks non-draggable rows aria-disabled, which would also disable the
          // inline rename field for assistive tech. The row itself is always interactive.
          aria-disabled={undefined}
          role="treeitem"
          aria-selected={selected}
          aria-expanded={container ? expanded : undefined}
          data-testid="tree-row"
          data-name={node.name}
          data-kind={node.kind}
          tabIndex={0}
          title={node.error ?? node.relPath}
          // Single click: preview tab. Double click: keep the tab open (rename is F2).
          onClick={() => {
            open(true)
            if (container) toggle(node.id)
          }}
          onDoubleClick={() => {
            open(false)
            if (container) toggle(node.id)
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'relative flex h-7 cursor-default items-center gap-1.5 rounded-sm pr-2 text-sm outline-none',
            'hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50',
            selected && 'bg-accent',
            drag.isDragging && 'opacity-40',
            here?.position === 'inside' && here.valid && 'bg-primary/15 ring-1 ring-primary/50'
          )}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {here && here.valid && here.position !== 'inside' && (
            <div
              className={cn(
                'pointer-events-none absolute right-1 h-0.5 rounded bg-primary',
                here.position === 'before' ? '-top-px' : '-bottom-px'
              )}
              style={{ left: 6 + depth * 14 }}
            />
          )}
          <span className="flex size-4 shrink-0 items-center justify-center">
            {container && (
              <ChevronRight
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform',
                  expanded && 'rotate-90'
                )}
              />
            )}
          </span>
          <NodeIcon node={node} open={expanded} method={method} />
          {editing ? (
            <InlineRename
              initial={node.name}
              onDone={(value) => {
                if (value === null) setEditing(null)
                else void rename(node.id, value)
              }}
            />
          ) : (
            <span
              className={cn('min-w-0 flex-1 truncate', broken && 'text-muted-foreground italic')}
            >
              {node.name}
            </span>
          )}
          {unsaved && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-primary"
              aria-label="有未儲存的修改"
            />
          )}
          {broken && (
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label="檔案錯誤" />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="tree-context-menu"
        // Don't pull focus back to the row while a rename field (new or renamed item) is open.
        onCloseAutoFocus={(e) => {
          if (useTreeStore.getState().editingId) e.preventDefault()
        }}
      >
        {container && !broken && (
          <>
            <ContextMenuItem onSelect={() => createAndOpen(node.id, 'request', 'http')}>
              <FilePlus2 />
              新增 HTTP 請求
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => createAndOpen(node.id, 'request', 'websocket')}>
              <Radio />
              新增 WebSocket
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => createAndOpen(node.id, 'folder')}>
              <FolderPlus />
              新增資料夾
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {!broken && (
          <>
            <ContextMenuItem onSelect={startRename}>
              <Pencil />
              重新命名
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void duplicate(node.id).then((id) => id && tabs.openItem(id))}
            >
              <Copy />
              複製
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => void tabs.reload({ scope: 'item', id: node.id })}>
          <RefreshCw />
          重新讀取
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onRequestDelete(node)}>
          <Trash2 />
          刪除…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
