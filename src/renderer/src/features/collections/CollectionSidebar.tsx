import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { findNode, isContainer, type TreeNode } from '@shared/tree'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
import { HistoryPanel } from '@renderer/features/history/HistoryPanel'
import { cn } from '@renderer/lib/utils'
import { useHistoryStore, type SidebarMode } from '@renderer/stores/history-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { RequestBadge } from './RequestBadge'
import {
  countDescendants,
  dropPositionFor,
  flattenTree,
  isNoopMove,
  resolveDrop
} from './tree-model'
import { TreeRow, type DropIndicator } from './TreeRow'

const AUTO_EXPAND_DELAY_MS = 600

const KIND_LABEL: Record<TreeNode['kind'], string> = {
  collection: 'Collection',
  folder: '資料夾',
  request: '請求'
}

function DeleteDialog({ node, onClose }: { node: TreeNode | null; onClose: () => void }) {
  const remove = useTreeStore((s) => s.remove)
  const count = node ? countDescendants(node) : 0
  return (
    <AlertDialog open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="delete-item-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            刪除{node ? KIND_LABEL[node.kind] : ''}「{node?.name}」？
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count > 0 ? `其中的 ${count} 個項目也會一併刪除。` : ''}
            檔案會移到系統垃圾桶，需要時可以從垃圾桶還原。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (node) void remove(node.id)
              onClose()
            }}
          >
            刪除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function createCollection(): Promise<void> {
  return useTreeStore
    .getState()
    .create(null, 'collection')
    .then((id) => {
      if (id) useTabsStore.getState().openItem(id, { preview: false })
    })
}

const MODES: { mode: SidebarMode; label: string }[] = [
  { mode: 'collections', label: 'Collections' },
  { mode: 'history', label: 'History' }
]

/** Left sidebar: Collections tree or History of the current Workspace. */
export function CollectionSidebar() {
  const mode = useHistoryStore((s) => s.sidebarMode)
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r bg-muted/40"
      data-testid="collection-sidebar"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-2">
        <div role="tablist" aria-label="側欄" className="flex items-center gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              data-testid={`sidebar-${m.mode}`}
              className={cn(
                'rounded-sm px-2 py-1 text-xs font-semibold tracking-wide uppercase',
                mode === m.mode
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => useHistoryStore.getState().setSidebarMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {mode === 'collections' && <CollectionActions />}
      </div>
      {mode === 'collections' ? <CollectionTree /> : <HistoryPanel />}
    </aside>
  )
}

function CollectionActions() {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="重新讀取整個 Workspace（套用在 Hachi 以外修改的檔案）"
        aria-label="重新讀取 Workspace"
        onClick={() => void useTabsStore.getState().reload({ scope: 'workspace' })}
      >
        <RefreshCw />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="新增 Collection"
        aria-label="新增 Collection"
        onClick={() => void createCollection()}
      >
        <Plus />
      </Button>
    </div>
  )
}

function CollectionTree() {
  const tree = useTreeStore((s) => s.tree)
  const expanded = useTreeStore((s) => s.expanded)
  const error = useTreeStore((s) => s.error)
  const loaded = useTreeStore((s) => s.loaded)
  const { move, toggle, dismissError } = useTreeStore.getState()

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded])
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropIndicator | null>(null)
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const clearExpandTimer = (): void => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer)
    expandTimer.current = null
  }
  useEffect(() => clearExpandTimer, [])

  const onDragStart = (e: DragStartEvent): void => {
    setDraggingId(String(e.active.id))
  }

  const onDragMove = (e: DragMoveEvent): void => {
    const over = e.over
    const dragged = findNode(tree, String(e.active.id))?.node
    const target = over ? findNode(tree, String(over.id))?.node : undefined
    if (!over || !dragged || !target) {
      setDrop(null)
      clearExpandTimer()
      return
    }
    const pointerY = (e.activatorEvent as PointerEvent).clientY + e.delta.y
    const ratio = (pointerY - over.rect.top) / Math.max(over.rect.height, 1)
    const position = dropPositionFor(dragged, target, ratio)
    const valid = resolveDrop(tree, dragged.id, target.id, position) !== null
    setDrop((prev) =>
      prev?.targetId === target.id && prev.position === position && prev.valid === valid
        ? prev
        : { targetId: target.id, position, valid }
    )

    // Hovering "inside" a collapsed container opens it after a short delay.
    const shouldExpand =
      valid && position === 'inside' && isContainer(target) && !expanded.has(target.id)
    if (!shouldExpand) clearExpandTimer()
    else if (expandTimer.current?.id !== target.id) {
      clearExpandTimer()
      expandTimer.current = {
        id: target.id,
        timer: setTimeout(() => {
          if (!useTreeStore.getState().expanded.has(target.id)) toggle(target.id)
        }, AUTO_EXPAND_DELAY_MS)
      }
    }
  }

  const finishDrag = (): void => {
    setDraggingId(null)
    setDrop(null)
    clearExpandTimer()
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const current = drop
    finishDrag()
    if (!current?.valid || String(e.active.id) === current.targetId) return
    const target = resolveDrop(tree, String(e.active.id), current.targetId, current.position)
    if (target && !isNoopMove(tree, String(e.active.id), target)) {
      void move(String(e.active.id), target.parentId, target.index)
    }
  }

  const dragging = draggingId ? findNode(tree, draggingId)?.node : undefined

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-4" role="tree" aria-label="Collections">
        {loaded && rows.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-2 py-3 text-sm text-muted-foreground">
            <p>還沒有任何 Collection。</p>
            <Button variant="outline" size="sm" onClick={() => void createCollection()}>
              <Plus />
              建立 Collection
            </Button>
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={finishDrag}
        >
          {rows.map((row) => (
            <TreeRow key={row.node.id} row={row} drop={drop} onRequestDelete={setPendingDelete} />
          ))}
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className="flex h-7 items-center gap-1.5 rounded-sm border bg-card px-2 text-sm shadow-md">
                {dragging.kind === 'request' && <RequestBadge node={dragging} />}
                <span className="truncate">{dragging.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {error && (
        <div
          role="alert"
          className="m-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" aria-label="關閉" onClick={dismissError}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <DeleteDialog node={pendingDelete} onClose={() => setPendingDelete(null)} />
    </>
  )
}
