import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertTriangle,
  Bookmark,
  Folder,
  Globe,
  Layers,
  Plus,
  Radio,
  Server,
  X,
  Play
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { findNode } from '@shared/tree'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { RequestBadge } from '@renderer/features/collections/RequestBadge'
import { isLive, useWsStore } from '@renderer/stores/ws-store'
import { cn } from '@renderer/lib/utils'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useMockStore } from '@renderer/stores/mock-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { isDraftTab, isTabDirty, tabItemId, tabTitle, type Tab } from './tab-model'
import { msg } from '@shared/i18n'

/** "WS" badge with a green dot while connected. */
function WsTabIcon({ uid }: { uid: string }) {
  const live = useWsStore((s) => isLive(s.sessions[uid]))
  const open = useWsStore((s) => s.sessions[uid]?.state?.status === 'open')
  return (
    <span className="relative flex shrink-0 items-center">
      <RequestBadge node={{ requestType: 'websocket' }} className="w-auto" />
      {live && (
        <span
          className={cn(
            'absolute -top-1 -right-1.5 size-1.5 rounded-full',
            open ? 'bg-emerald-500' : 'bg-amber-500'
          )}
          aria-label={msg().tabs.connected}
          data-testid="tab-live"
        />
      )}
    </span>
  )
}

function TabIcon({ tab }: { tab: Tab }) {
  const node = useTreeStore((s) => {
    const id = tabItemId(tab)
    return id ? findNode(s.tree, id)?.node : undefined
  })
  if (tab.kind === 'environments') return <Globe className="size-3.5 shrink-0 text-primary" />
  if (tab.kind === 'runner') return <Play className="size-3.5 shrink-0 text-primary" />
  if (tab.kind === 'mock') return <Server className="size-3.5 shrink-0 text-primary" />
  if (tab.kind === 'example') return <Bookmark className="size-3.5 shrink-0 text-primary" />
  if (tab.kind === 'request') {
    return (
      <RequestBadge node={{ requestType: 'http', method: tab.draft?.method }} className="w-auto" />
    )
  }
  if (tab.kind === 'websocket') return <WsTabIcon uid={tab.uid} />
  if (tab.kind === 'container') {
    return tab.containerKind === 'collection' ? (
      <Layers className="size-3.5 shrink-0 text-primary" />
    ) : (
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
    )
  }
  if (node?.error) return <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
  return <Radio className="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const store = useTabsStore.getState()
  const mocks = useMockStore((s) => s.list)
  const title = useTreeStore((s) => tabTitle(tab, s.tree, mocks))
  const dirty = isTabDirty(tab)
  const ref = useRef<HTMLDivElement>(null)
  // Dragged to reorder (issue #8). Only the pointer listeners: the tab keeps its own
  // role / tabIndex (no keyboard dragging, no new shortcuts).
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.key
  })

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(el) => {
            ref.current = el
            setNodeRef(el)
          }}
          {...listeners}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          role="tab"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          data-testid="tab"
          data-kind={tab.kind}
          data-title={title}
          data-preview={tab.preview || undefined}
          data-dirty={dirty || undefined}
          data-draft={isDraftTab(tab) || undefined}
          data-dragging={isDragging || undefined}
          title={tab.preview ? msg().tabs.previewTitle(title) : title}
          className={cn(
            'group relative flex h-full max-w-56 min-w-28 shrink-0 cursor-default items-center gap-1.5 border-r pr-1 pl-2.5 text-xs select-none',
            active
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-background/60',
            isDragging && 'z-10 shadow-md'
          )}
          onClick={() => store.activate(tab.key)}
          onDoubleClick={() => store.pin(tab.key)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              void store.close(tab.key)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') store.activate(tab.key)
          }}
        >
          {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
          <TabIcon tab={tab} />
          <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>{title}</span>
          <button
            type="button"
            aria-label={msg().tabs.closeLabel(title)}
            data-testid="tab-close"
            className="relative flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation()
              void store.close(tab.key)
            }}
          >
            {dirty && (
              <span
                className="size-2 rounded-full bg-primary group-hover:hidden"
                aria-label={msg().tabs.unsaved}
              />
            )}
            <X
              className={cn(
                'size-3.5',
                dirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100',
                active && !dirty && 'opacity-100'
              )}
            />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void store.close(tab.key)}>
          {msg().tabs.close}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void store.closeOthers(tab.key)}>
          {msg().tabs.closeOthers}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void store.closeAll()}>
          {msg().tabs.closeAll}
        </ContextMenuItem>
        {tab.preview && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => store.pin(tab.key)}>{msg().tabs.pin}</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The thin scrollbar of the tab strip shows only while the pointer is over it. Chromium
 * keeps a scrollbar's style until the scrollbar is rebuilt, so `:hover` alone never
 * shows it: mark the strip and rebuild the scrollbar by toggling overflow.
 */
function pointerOver(el: HTMLElement, over: boolean) {
  el.toggleAttribute('data-pointer', over)
  el.style.overflowX = 'hidden'
  void el.offsetWidth
  el.style.overflowX = ''
}

/** Tabs slide along the strip only. */
const alongStrip: Modifier = ({ transform }) => ({ ...transform, y: 0 })

/**
 * Open tabs above the editor; "+" opens a new unsaved HTTP request. Tabs can be dragged
 * to reorder them (issue #8): the others make room as it moves, the strip scrolls at its
 * edges, and the dragged tab becomes the active, pinned one. The order is part of the
 * session, so it survives a restart.
 */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeKey = useTabsStore((s) => s.activeKey)
  // Same threshold as the tree: a click that moves a little is still a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const keys = useMemo(() => tabs.map((t) => t.key), [tabs])

  const onDragStart = (e: DragStartEvent) => {
    const store = useTabsStore.getState()
    store.activate(String(e.active.id))
    store.pin(String(e.active.id))
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.over.id === e.active.id) return
    const to = keys.indexOf(String(e.over.id))
    if (to >= 0) useTabsStore.getState().move(String(e.active.id), to)
  }

  return (
    <div className="flex h-9 shrink-0 border-b bg-muted/40" data-testid="tab-bar">
      <div
        role="tablist"
        aria-label={msg().tabs.open}
        className="tab-strip flex min-w-0 overflow-x-auto"
        onMouseEnter={(e) => pointerOver(e.currentTarget, true)}
        onMouseLeave={(e) => pointerOver(e.currentTarget, false)}
      >
        <DndContext
          sensors={sensors}
          modifiers={[alongStrip]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={keys} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <TabButton key={tab.uid} tab={tab} active={tab.key === activeKey} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={msg().tabs.add}
            title={msg().tabs.addTitle}
            data-testid="new-tab"
            className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => useTabsStore.getState().newRequest('http')}>
            {msg().tabs.http}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useTabsStore.getState().newRequest('websocket')}>
            WebSocket
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
