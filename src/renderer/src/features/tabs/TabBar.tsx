import { AlertTriangle, Folder, Globe, Layers, Plus, Radio, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
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
import { useTreeStore } from '@renderer/stores/tree-store'
import { isDraftTab, isTabDirty, tabItemId, tabTitle, type Tab } from './tab-model'

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
          aria-label="連線中"
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
  const title = useTreeStore((s) => tabTitle(tab, s.tree))
  const dirty = isTabDirty(tab)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          role="tab"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          data-testid="tab"
          data-title={title}
          data-preview={tab.preview || undefined}
          data-dirty={dirty || undefined}
          data-draft={isDraftTab(tab) || undefined}
          title={tab.preview ? `${title}（預覽：編輯或雙擊後固定）` : title}
          className={cn(
            'group relative flex h-full max-w-56 min-w-28 shrink-0 cursor-default items-center gap-1.5 border-r pr-1 pl-2.5 text-xs select-none',
            active
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-background/60'
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
            aria-label={`關閉 ${title}`}
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
                aria-label="有未儲存的修改"
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
        <ContextMenuItem onSelect={() => void store.close(tab.key)}>關閉</ContextMenuItem>
        <ContextMenuItem onSelect={() => void store.closeOthers(tab.key)}>
          關閉其他分頁
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void store.closeAll()}>關閉所有分頁</ContextMenuItem>
        {tab.preview && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => store.pin(tab.key)}>固定分頁</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Open tabs above the editor; "+" opens a new unsaved HTTP request. */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeKey = useTabsStore((s) => s.activeKey)
  return (
    <div className="flex h-9 shrink-0 border-b bg-muted/40" data-testid="tab-bar">
      <div
        role="tablist"
        aria-label="開啟的分頁"
        className="flex min-w-0 overflow-x-auto [scrollbar-width:thin]"
      >
        {tabs.map((tab) => (
          <TabButton key={tab.uid} tab={tab} active={tab.key === activeKey} />
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="新增"
            title="新增請求（尚未儲存，可直接使用）"
            data-testid="new-tab"
            className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => useTabsStore.getState().newRequest('http')}>
            HTTP 請求
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useTabsStore.getState().newRequest('websocket')}>
            WebSocket
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
