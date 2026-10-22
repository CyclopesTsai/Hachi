import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { formatDuration } from '@shared/http'
import type { HistoryEntry } from '@shared/schemas/history'
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
import { RequestBadge } from '@renderer/features/collections/RequestBadge'
import { cn } from '@renderer/lib/utils'
import { useHistoryStore } from '@renderer/stores/history-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { groupByDay } from './history-model'
import { localeOf, msg } from '@shared/i18n'

const tone = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  redirect: 'text-sky-700 dark:text-sky-400',
  warn: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400'
}

/** Short status shown on the right of a row, with its colour. */
function statusOf(entry: HistoryEntry): { label: string; className: string } {
  if (entry.type === 'websocket') {
    const r = entry.result
    if (r.error) return { label: msg().history.error, className: tone.error }
    if (r.closeCode === null) return { label: '—', className: tone.warn }
    return { label: String(r.closeCode), className: r.closeCode === 1000 ? tone.ok : tone.warn }
  }
  if (entry.result.kind === 'error') return { label: msg().history.error, className: tone.error }
  const s = entry.result.status
  const className =
    s >= 500 ? tone.error : s >= 400 ? tone.warn : s >= 300 ? tone.redirect : tone.ok
  return { label: String(s), className }
}

function detailOf(entry: HistoryEntry): string {
  const lines: (string | null)[] = [entry.request.name]
  if (entry.type === 'websocket') {
    const r = entry.result
    lines.unshift(`WebSocket ${entry.request.url}`)
    lines.push(
      r.error
        ? msg().history.errorDetail(r.error)
        : `Close Code ${r.closeCode ?? '—'}${r.closeReason ? msg().history.closeReason(r.closeReason) : ''}`,
      msg().history.counts(r.sent, r.received)
    )
  } else {
    lines.unshift(`${entry.request.method} ${entry.request.url}`)
    lines.push(
      entry.result.kind === 'response'
        ? `${entry.result.status} ${entry.result.statusText} · ${formatDuration(entry.result.timeMs)}`
        : entry.result.message
    )
  }
  lines.push(
    entry.environmentName ? msg().history.environment(entry.environmentName) : null,
    new Date(entry.sentAt).toLocaleString(localeOf())
  )
  return lines.filter(Boolean).join('\n')
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const time = new Date(entry.sentAt).toLocaleTimeString(localeOf(), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  const status = statusOf(entry)
  const detail = detailOf(entry)
  return (
    <li>
      <button
        type="button"
        data-testid="history-row"
        data-url={entry.request.url}
        title={detail}
        className="group flex h-7 w-full items-center gap-1.5 rounded-sm pr-1 text-left text-xs hover:bg-accent/70"
        onClick={() => void useTabsStore.getState().openHistoryEntry(entry)}
        onDoubleClick={() =>
          void useTabsStore.getState().openHistoryEntry(entry, { preview: false })
        }
      >
        <RequestBadge
          node={
            entry.type === 'websocket'
              ? { requestType: 'websocket' }
              : { requestType: 'http', method: entry.request.method }
          }
        />
        <span className="min-w-0 flex-1 truncate font-mono">
          {entry.request.url || msg().history.emptyUrl}
        </span>
        <span className={cn('shrink-0 font-mono text-[10px] font-semibold', status.className)}>
          {status.label}
        </span>
        <span className="shrink-0 text-right text-[10px] whitespace-nowrap text-muted-foreground tabular-nums group-hover:hidden">
          {time}
        </span>
        <X
          className="hidden size-3.5 shrink-0 text-muted-foreground group-hover:block hover:text-destructive"
          aria-label={msg().history.deleteEntry}
          onClick={(e) => {
            e.stopPropagation()
            void useHistoryStore.getState().remove(entry.id)
          }}
        />
      </button>
    </li>
  )
}

/** Sidebar "History": requests sent in this Workspace, newest first, grouped by day. */
export function HistoryPanel() {
  const entries = useHistoryStore((s) => s.entries)
  const loaded = useHistoryStore((s) => s.loaded)
  const error = useHistoryStore((s) => s.error)
  const [confirmClear, setConfirmClear] = useState(false)
  const groups = groupByDay(entries, new Date())

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="history-panel">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1 pl-3">
        <span className="text-xs text-muted-foreground">{msg().history.count(entries.length)}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={msg().history.clearTitle}
          aria-label={msg().history.clearLabel}
          disabled={entries.length === 0}
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-4">
        {loaded && entries.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">{msg().history.empty}</p>
        )}
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="sticky top-0 bg-muted/90 px-2 py-1 text-[11px] font-semibold text-muted-foreground backdrop-blur">
              {group.label}
            </h3>
            <ul>
              {group.entries.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        ))}
        {error && <p className="px-2 py-2 text-xs text-destructive">{error}</p>}
      </div>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{msg().history.clearConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {msg().history.clearConfirm(entries.length)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{msg().common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void useHistoryStore.getState().clear()}
            >
              {msg().history.clear}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
