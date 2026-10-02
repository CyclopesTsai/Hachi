import { ArrowDown, ArrowUp, Download, Dot, Trash2 } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { slugify } from '@shared/file-names'
import { formatBytes } from '@shared/http'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useWsStore, type WsLogItem } from '@renderer/stores/ws-store'
import {
  COLLAPSE_BYTES,
  describeEvent,
  exportJson,
  exportText,
  formatTime,
  matchesFilter,
  matchesSearch,
  messageText,
  prettyJson,
  type BinaryView,
  type LogFilter
} from './log-model'

const EMPTY: WsLogItem[] = []

function MessageRow({
  entry,
  binaryView,
  pretty,
  expanded,
  onToggle
}: {
  entry: WsLogItem
  binaryView: BinaryView
  pretty: boolean
  expanded: boolean
  onToggle: () => void
}) {
  if (entry.kind === 'event') {
    return (
      <li
        className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-muted-foreground"
        data-testid="ws-log-row"
        data-kind="event"
        data-event={entry.event}
      >
        <Dot className="size-3.5 shrink-0" />
        <span className="shrink-0 font-mono tabular-nums">{formatTime(entry.time)}</span>
        <span
          className={cn('min-w-0 truncate', entry.event === 'error' && 'text-destructive')}
          title={describeEvent(entry)}
        >
          {describeEvent(entry)}
        </span>
      </li>
    )
  }
  const big = entry.size > COLLAPSE_BYTES
  const text = !big || expanded ? messageText(entry, binaryView) : ''
  const shown = expanded && pretty && !entry.binary ? (prettyJson(text) ?? text) : text
  const Arrow = entry.direction === 'sent' ? ArrowUp : ArrowDown
  return (
    <li
      className="border-b border-border/50 px-2 py-1"
      data-testid="ws-log-row"
      data-kind={entry.direction}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-xs"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <Arrow
          className={cn(
            'size-3.5 shrink-0',
            entry.direction === 'sent'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-sky-600 dark:text-sky-400'
          )}
          aria-label={entry.direction === 'sent' ? '送出' : '收到'}
        />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatTime(entry.time)}
        </span>
        {entry.binary && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
            Binary
          </span>
        )}
        {entry.heartbeat && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
            心跳
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono" data-testid="ws-log-preview">
          {big && !expanded ? `（${formatBytes(entry.size)}，已摺疊，點一下展開）` : text}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatBytes(entry.size)}
        </span>
      </button>
      {expanded && (
        <pre
          className="mt-1 max-h-80 overflow-auto rounded bg-muted/50 p-2 font-mono text-xs break-all whitespace-pre-wrap select-text"
          data-testid="ws-log-detail"
        >
          {shown}
        </pre>
      )}
    </li>
  )
}

/** Live message stream of a WebSocket tab: search, filter, clear, export. */
export function MessageLog({ uid, title }: { uid: string; title: string }) {
  const entries = useWsStore((s) => s.sessions[uid]?.entries ?? EMPTY)
  const dropped = useWsStore((s) => s.sessions[uid]?.dropped ?? 0)
  const limit = useWsStore((s) => s.messageLimit)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [query, setQuery] = useState('')
  const [binaryView, setBinaryView] = useState<BinaryView>('hex')
  const [pretty, setPretty] = useState(true)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [exportError, setExportError] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const atBottom = useRef(true)

  const visible = useMemo(
    () => entries.filter((e) => matchesFilter(e, filter) && matchesSearch(e, query, binaryView)),
    [entries, filter, query, binaryView]
  )

  // Follow new messages while the list is scrolled to the bottom.
  useLayoutEffect(() => {
    const el = list.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [visible])

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const save = async (kind: 'json' | 'text') => {
    setExportError(null)
    try {
      const result = await window.hachi.dialog.saveTextFile({
        title: 'Export Messages',
        defaultName: `${slugify(title) || 'websocket'}-messages.${kind === 'json' ? 'json' : 'txt'}`,
        content: kind === 'json' ? exportJson(entries) : exportText(entries)
      })
      if (!result.ok) setExportError(result.error.message)
    } catch (error) {
      setExportError(errorMessage(error))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ws-message-log">
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5">
        <Input
          aria-label="搜尋訊息"
          data-testid="ws-search"
          className="h-7 w-40 text-xs"
          placeholder="搜尋…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelect
          aria-label="篩選"
          className="h-7 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as LogFilter)}
        >
          <option value="all">全部</option>
          <option value="sent">送出</option>
          <option value="received">收到</option>
          <option value="events">系統事件</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Binary 顯示方式"
          className="h-7 text-xs"
          value={binaryView}
          onChange={(e) => setBinaryView(e.target.value as BinaryView)}
        >
          <option value="hex">Binary：Hex</option>
          <option value="base64">Binary：Base64</option>
          <option value="text">Binary：UTF-8 文字</option>
        </NativeSelect>
        <CheckboxLabel checked={pretty} onChange={(e) => setPretty(e.target.checked)}>
          JSON 美化
        </CheckboxLabel>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground" data-testid="ws-log-count">
          {visible.length} / {entries.length} 則
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={entries.length === 0}
            >
              <Download />
              匯出
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void save('json')}>JSON（完整資料）</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void save('text')}>純文字</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={entries.length === 0}
          onClick={() => useWsStore.getState().clear(uid)}
        >
          <Trash2 />
          清除
        </Button>
      </div>
      {dropped > 0 && (
        <p className="border-b bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          已捨棄較舊的 {dropped} 則（每個分頁最多保留 {limit} 則，可在 App 設定調整）
        </p>
      )}
      {exportError && (
        <p className="border-b px-2 py-1 text-[11px] text-destructive">{exportError}</p>
      )}
      <ul
        ref={list}
        className="min-h-0 flex-1 overflow-auto py-1"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {entries.length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            連線後，送出與收到的訊息會顯示在這裡（只存在記憶體，需要時請匯出）。
          </li>
        )}
        {visible.map((entry) => (
          <MessageRow
            key={entry.key}
            entry={entry}
            binaryView={binaryView}
            pretty={pretty}
            expanded={expanded.has(entry.key)}
            onToggle={() => toggle(entry.key)}
          />
        ))}
      </ul>
    </div>
  )
}
