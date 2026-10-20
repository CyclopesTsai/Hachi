import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { ExampleNode } from '@shared/tree'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { statusTextColor } from '@renderer/lib/status-color'
import { cn } from '@renderer/lib/utils'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { selectRenameInput } from './rename-input'
import { InlineRename } from './TreeRow'

/**
 * A saved result under its request (decision 140): single click previews it, double
 * click keeps the tab; rename and delete from the context menu (like other items).
 */
export function ExampleRow({
  example,
  depth,
  onRequestDelete
}: {
  example: ExampleNode
  depth: number
  onRequestDelete: (example: ExampleNode) => void
}) {
  const selected = useTreeStore((s) => s.selectedId === example.id)
  const editing = useTreeStore((s) => s.editingId === example.id)
  const { select, setEditing, renameExample } = useTreeStore.getState()
  const broken = example.error !== undefined
  const open = (preview: boolean) => {
    if (broken) return
    select(example.id)
    useTabsStore.getState().openExample(example.id, { preview })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-selected={selected}
          data-testid="example-row"
          data-id={example.id}
          data-name={example.name}
          tabIndex={0}
          title={example.error ?? example.relPath}
          onClick={() => open(true)}
          onDoubleClick={() => open(false)}
          onKeyDown={(e) => {
            if (editing) return
            if (e.key === 'Enter') open(false)
            else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault()
              onRequestDelete(example)
            }
          }}
          className={cn(
            'relative flex h-7 cursor-default items-center gap-1.5 rounded-sm pr-2 text-sm outline-none',
            'hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50',
            selected && 'bg-accent'
          )}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <span className="size-4 shrink-0" />
          <span
            className={cn(
              'w-11 shrink-0 text-right font-mono text-[10px] font-semibold',
              example.status === undefined
                ? 'text-muted-foreground'
                : statusTextColor(example.status)
            )}
          >
            {example.status ?? '—'}
          </span>
          {editing ? (
            <InlineRename
              initial={example.name}
              onDone={(value) => {
                if (value === null) setEditing(null)
                else void renameExample(example.id, value)
              }}
            />
          ) : (
            <span
              className={cn('min-w-0 flex-1 truncate text-muted-foreground', broken && 'italic')}
            >
              {example.name}
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="example-context-menu"
        onCloseAutoFocus={(e) => {
          if (!useTreeStore.getState().editingId) return
          e.preventDefault()
          selectRenameInput()
        }}
      >
        {!broken && (
          <>
            <ContextMenuItem onSelect={() => open(false)}>
              <ExternalLink />
              開啟
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setEditing(example.id)}>
              <Pencil />
              重新命名
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem variant="destructive" onSelect={() => onRequestDelete(example)}>
          <Trash2 />
          刪除…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
