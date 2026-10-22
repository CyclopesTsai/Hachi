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
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileDown,
  FilePlus2,
  FolderInput,
  FolderPlus,
  Layers,
  LocateFixed,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Terminal,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { findNode, isContainer, type ExampleNode, type TreeNode } from '@shared/tree'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { useTransferStore } from '@renderer/stores/transfer-store'
import { HistoryPanel } from '@renderer/features/history/HistoryPanel'
import { cn } from '@renderer/lib/utils'
import { useHistoryStore, type SidebarMode } from '@renderer/stores/history-store'
import { tabItemId } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { RequestBadge } from './RequestBadge'
import {
  countDescendants,
  dropPositionFor,
  flattenTree,
  isNoopMove,
  resolveDrop,
  searchTree
} from './tree-model'
import { MockActions, MockPanel } from '@renderer/features/mock/MockPanel'
import { selectRenameInput } from './rename-input'
import { ExampleRow } from './ExampleRow'
import { TreeRow, type DropIndicator } from './TreeRow'
import { msg } from '@shared/i18n'

const AUTO_EXPAND_DELAY_MS = 600

function DeleteDialog({ node, onClose }: { node: TreeNode | null; onClose: () => void }) {
  const remove = useTreeStore((s) => s.remove)
  const count = node ? countDescendants(node) : 0
  const examples = node?.kind === 'request' ? (node.examples?.length ?? 0) : 0
  const m = msg()
  return (
    <AlertDialog open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="delete-item-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {m.tree.deleteTitle(node ? m.tree.kinds[node.kind] : '', node?.name ?? '')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count > 0 ? m.tree.deleteChildren(count) : ''}
            {examples > 0 ? m.tree.deleteExamples(examples) : ''}
            {m.tree.toTrash}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (node) void remove(node.id)
              onClose()
            }}
          >
            {m.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Deleting a saved result (decision 140). */
function DeleteExampleDialog({
  example,
  onClose
}: {
  example: ExampleNode | null
  onClose: () => void
}) {
  return (
    <AlertDialog open={example !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="delete-example-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{msg().tree.deleteExampleTitle(example?.name ?? '')}</AlertDialogTitle>
          <AlertDialogDescription>{msg().tree.toTrash}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{msg().common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (example) void useTreeStore.getState().removeExample(example.id)
              onClose()
            }}
          >
            {msg().common.delete}
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
  { mode: 'history', label: 'History' },
  { mode: 'mocks', label: 'Mocks' }
]

/** Left sidebar: Collections tree, History or Mock Servers of the current Workspace. */
export function CollectionSidebar() {
  const mode = useHistoryStore((s) => s.sidebarMode)
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r bg-muted/40"
      data-testid="collection-sidebar"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-2">
        <div role="tablist" aria-label={msg().tree.sidebar} className="flex items-center gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              data-testid={`sidebar-${m.mode}`}
              className={cn(
                'rounded-sm px-1.5 py-1 text-[11px] font-semibold uppercase',
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
        {mode === 'mocks' && <MockActions />}
      </div>
      {mode === 'collections' && <TreeToolbar />}
      {mode === 'collections' ? (
        <CollectionTree />
      ) : mode === 'history' ? (
        <HistoryPanel />
      ) : (
        <MockPanel />
      )}
    </aside>
  )
}

/** Item of the active tab (for the focus button), or null. */
function useActiveItemId(): string | null {
  return useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.key === s.activeKey)
    return tab ? tabItemId(tab) : null
  })
}

/** Shows the active tab's item in the tree: open its folders, select it, scroll to it. */
function focusActiveItem(itemId: string): void {
  const store = useTreeStore.getState()
  const search = searchTree(store.tree, store.query)
  if (search && !search.visible.has(itemId)) store.setQuery('')
  useTreeStore.getState().reveal(itemId)
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(
      `[data-testid="tree-row"][data-id="${CSS.escape(itemId)}"]`
    )
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus()
  })
}

/**
 * Name search (decision 108: collections, folders and requests; no shortcut) and the
 * locate / expand all / collapse all buttons (decision 109).
 */
function TreeToolbar() {
  const query = useTreeStore((s) => s.query)
  const activeItemId = useActiveItemId()
  const iconButton = 'size-7 shrink-0 text-muted-foreground hover:text-foreground'
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-1 pb-2 pl-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label={msg().tree.search}
          data-testid="global-search"
          placeholder={msg().tree.search}
          title={msg().tree.searchTitle}
          value={query}
          onChange={(e) => useTreeStore.getState().setQuery(e.target.value)}
          className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={iconButton}
        title={msg().tree.locateTitle}
        aria-label={msg().tree.locate}
        data-testid="tree-focus"
        disabled={!activeItemId}
        onClick={() => activeItemId && focusActiveItem(activeItemId)}
      >
        <LocateFixed />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconButton}
        title={msg().tree.expandAll}
        aria-label={msg().tree.expandAll}
        data-testid="tree-expand-all"
        onClick={() => useTreeStore.getState().expandAllContainers()}
      >
        <ChevronsUpDown />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconButton}
        title={msg().tree.collapseAll}
        aria-label={msg().tree.collapseAll}
        data-testid="tree-collapse-all"
        onClick={() => useTreeStore.getState().collapseAll()}
      >
        <ChevronsDownUp />
      </Button>
    </div>
  )
}

type NewKind = { kind: 'folder' } | { kind: 'request'; requestType: 'http' | 'websocket' }

const newLabel = (what: NewKind) =>
  what.kind === 'folder'
    ? msg().tree.newFolder
    : what.requestType === 'http'
      ? msg().tree.newHttp
      : msg().tree.newWebSocket

/**
 * Where "＋" puts a folder / request (decision 106): inside the selected collection /
 * folder, next to a selected request; null when nothing usable is selected.
 */
function selectedContainerId(): string | null {
  const { tree, selectedId } = useTreeStore.getState()
  if (!selectedId) return null
  const found = findNode(tree, selectedId)
  if (!found || found.node.error) return null
  return isContainer(found.node) ? found.node.id : (found.parent?.id ?? null)
}

function createIn(parentId: string, what: NewKind): void {
  const { create, reveal } = useTreeStore.getState()
  reveal(parentId)
  useTreeStore.getState().expand(parentId)
  void (
    what.kind === 'folder'
      ? create(parentId, 'folder')
      : create(parentId, 'request', what.requestType)
  ).then((id) => {
    if (id) useTabsStore.getState().openItem(id, { preview: false })
  })
}

/** Nothing selected: ask which Collection the new item goes into. */
function PickCollectionDialog({ what, onClose }: { what: NewKind | null; onClose: () => void }) {
  // Select the stable array and filter outside: a new array per call would re-render forever.
  const all = useTreeStore((s) => s.tree.collections)
  const collections = useMemo(() => all.filter((c) => !c.error), [all])
  const [target, setTarget] = useState('')
  const chosen = collections.find((c) => c.id === target) ?? collections[0]
  const label = what ? newLabel(what) : ''
  return (
    <Dialog open={what !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="pick-collection-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (what && chosen) createIn(chosen.id, what)
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{msg().tree.pickCollection}</DialogDescription>
          </DialogHeader>
          <NativeSelect
            aria-label="Collection"
            autoFocus
            value={chosen?.id ?? ''}
            onChange={(e) => setTarget(e.target.value)}
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {msg().common.cancel}
            </Button>
            <Button type="submit" disabled={!chosen}>
              {msg().tree.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CollectionActions() {
  const hasCollections = useTreeStore((s) => s.tree.collections.some((c) => !c.error))
  const [asking, setAsking] = useState<NewKind | null>(null)
  // A new item opens its rename field: the closing menu must not pull focus back to "+".
  const creating = useRef(false)
  const add = (what: NewKind) => {
    creating.current = true
    const parentId = selectedContainerId()
    if (parentId) createIn(parentId, what)
    else setAsking(what)
  }
  const transfer = useTransferStore.getState()
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={msg().tree.reloadWorkspaceTitle}
        aria-label={msg().tree.reloadWorkspace}
        onClick={() => void useTabsStore.getState().reload({ scope: 'workspace' })}
      >
        <RefreshCw />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title={msg().tree.addTitle}
            aria-label={msg().tree.add}
            data-testid="sidebar-add"
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-testid="sidebar-add-menu"
          onCloseAutoFocus={(e) => {
            if (creating.current) {
              e.preventDefault()
              selectRenameInput()
            }
            creating.current = false
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              creating.current = true
              void createCollection()
            }}
          >
            <Layers />
            {msg().tree.newCollection}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasCollections}
            onSelect={() => add({ kind: 'request', requestType: 'http' })}
          >
            <FilePlus2 />
            {msg().tree.newHttp}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasCollections}
            onSelect={() => add({ kind: 'request', requestType: 'websocket' })}
          >
            <Radio />
            {msg().tree.newWebSocket}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasCollections} onSelect={() => add({ kind: 'folder' })}>
            <FolderPlus />
            {msg().tree.newFolder}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void transfer.importFile()}>
            <FileDown />
            {msg().tree.importFile}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void transfer.importBrunoFolder()}>
            <FolderInput />
            {msg().tree.importBrunoFolder}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => transfer.setCurlOpen(true)}>
            <Terminal />
            {msg().tree.importCurl}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PickCollectionDialog what={asking} onClose={() => setAsking(null)} />
    </div>
  )
}

function CollectionTree() {
  const tree = useTreeStore((s) => s.tree)
  const expanded = useTreeStore((s) => s.expanded)
  const error = useTreeStore((s) => s.error)
  const loaded = useTreeStore((s) => s.loaded)
  const query = useTreeStore((s) => s.query)
  const { move, toggle, dismissError } = useTreeStore.getState()

  const search = useMemo(() => searchTree(tree, query), [tree, query])
  const rows = useMemo(() => flattenTree(tree, expanded, search?.visible), [tree, expanded, search])
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null)
  const [pendingExampleDelete, setPendingExampleDelete] = useState<ExampleNode | null>(null)
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
        {search && rows.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground" data-testid="tree-no-match">
            {msg().tree.noMatch(query.trim())}
          </p>
        )}
        {loaded && !search && rows.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-2 py-3 text-sm text-muted-foreground">
            <p>{msg().tree.empty}</p>
            <Button variant="outline" size="sm" onClick={() => void createCollection()}>
              <Plus />
              {msg().tree.createCollection}
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
          {rows.map((row) =>
            row.example ? (
              <ExampleRow
                key={row.example.id}
                example={row.example}
                depth={row.depth}
                onRequestDelete={setPendingExampleDelete}
              />
            ) : (
              <TreeRow key={row.node.id} row={row} drop={drop} onRequestDelete={setPendingDelete} />
            )
          )}
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
          <button type="button" aria-label={msg().common.close} onClick={dismissError}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <DeleteDialog node={pendingDelete} onClose={() => setPendingDelete(null)} />
      <DeleteExampleDialog
        example={pendingExampleDelete}
        onClose={() => setPendingExampleDelete(null)}
      />
    </>
  )
}
