import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileSpreadsheet,
  Play,
  Square,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatBytes, formatDuration, type HttpErrorCode } from '@shared/http'
import {
  RUNNER_MAX_CONCURRENCY,
  RUNNER_MAX_DELAY_MS,
  RUNNER_MAX_ITERATIONS,
  type LatencyStats,
  type RunnerRowDetail,
  type RunnerStatsRow,
  type RunnerStatus
} from '@shared/runner'
import { findNode, type TreeNode } from '@shared/tree'
import { CodeEditor } from '@renderer/components/code-editor'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { ConsolePanel, TestsPanel } from '@renderer/features/http/ScriptResults'
import { RequestBadge } from '@renderer/features/collections/RequestBadge'
import { isTabDirty, itemTabKey, type RunnerTab } from '@renderer/features/tabs/tab-model'
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useEnvStore } from '@renderer/stores/env-store'
import {
  RUNNER_PAGE_SIZE,
  requestsBelow,
  useRunnerStore,
  type RunnerSession
} from '@renderer/stores/runner-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { LineChart } from './LineChart'

const STATUS_LABEL: Record<RunnerStatus, string> = {
  running: '執行中',
  done: '完成',
  cancelled: '已取消',
  stopped: '已停止',
  error: '錯誤'
}

const ERROR_LABEL: Partial<Record<HttpErrorCode, string>> = {
  TIMEOUT: '逾時',
  NETWORK: '連線失敗',
  TLS: 'SSL / TLS',
  PROXY: 'Proxy',
  SCRIPT: '腳本錯誤',
  INVALID_URL: 'URL 錯誤',
  TOO_LARGE: '回應太大',
  FILE_NOT_FOUND: '檔案不存在',
  TOO_MANY_REDIRECTS: '重新導向過多',
  CANCELLED: '已取消',
  UNKNOWN: '其他'
}

const clampInt = (text: string, min: number, max: number) => {
  const n = Math.round(Number(text))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

const ms = (v: number | undefined) => (v === undefined ? '—' : formatDuration(v))

function Field({
  label,
  children,
  hint
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

function Settings({
  uid,
  session,
  target
}: {
  uid: string
  session: RunnerSession
  target: TreeNode
}) {
  const update = (patch: Parameters<ReturnType<typeof useRunnerStore.getState>['updateForm']>[1]) =>
    useRunnerStore.getState().updateForm(uid, patch)
  const f = session.form
  const running = session.run?.progress.status === 'running' || session.starting
  const envList = useEnvStore((s) => s.list)
  const tree = useTreeStore((s) => s.tree)
  const tabs = useTabsStore((s) => s.tabs)
  const dirtyIds = useMemo(() => new Set(tabs.filter(isTabDirty).map((t) => t.key)), [tabs])
  const requests = requestsBelow(target).filter((n) => n.kind === 'request')
  const excluded = new Set(f.excluded)
  const pathOf = (node: TreeNode) => {
    const names: string[] = []
    for (let cur = findNode(tree, node.id); cur && cur.node.id !== target.id;) {
      names.unshift(cur.node.name)
      cur = cur.parent ? findNode(tree, cur.parent.id) : null
    }
    return names.join(' / ')
  }
  const unsaved = requests.some((r) => !excluded.has(r.id) && dirtyIds.has(itemTabKey(r.id)))
  const [iterText, setIterText] = useState(String(f.iterations))
  const [concText, setConcText] = useState(String(f.concurrency))
  const [delayText, setDelayText] = useState(String(f.delayMs))

  return (
    <fieldset disabled={running} className="flex flex-col gap-4 p-4" data-testid="runner-settings">
      <Field
        label={`請求（${requests.filter((r) => !excluded.has(r.id)).length} / ${requests.length}）`}
      >
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => update({ excluded: [] })}
          >
            全選
          </button>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => update({ excluded: requests.map((r) => r.id) })}
          >
            全不選
          </button>
        </div>
        <ul className="max-h-56 overflow-auto rounded-md border p-1" data-testid="runner-items">
          {requests.map((r) => {
            const ws = r.kind === 'request' && r.requestType === 'websocket'
            return (
              <li key={r.id}>
                <label
                  className={cn(
                    'flex h-7 items-center gap-2 rounded-sm px-1.5 text-sm hover:bg-accent/60',
                    ws && 'text-muted-foreground'
                  )}
                  title={ws ? 'WebSocket 不會執行' : undefined}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    disabled={ws}
                    checked={!ws && !excluded.has(r.id)}
                    onChange={(e) =>
                      update({
                        excluded: e.target.checked
                          ? f.excluded.filter((id) => id !== r.id)
                          : [...f.excluded, r.id]
                      })
                    }
                  />
                  {r.kind === 'request' && <RequestBadge node={r} />}
                  <span className="min-w-0 truncate">{pathOf(r)}</span>
                </label>
              </li>
            )
          })}
        </ul>
        {unsaved && (
          <span className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            有請求還沒儲存，Runner 使用的是已儲存的版本。
          </span>
        )}
      </Field>
      <Field label="環境">
        <NativeSelect
          aria-label="環境"
          value={f.environmentId ?? ''}
          onChange={(e) => update({ environmentId: e.target.value || null })}
        >
          <option value="">無環境</option>
          {envList
            .filter((e) => !e.error)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="執行次數（每個 worker）">
          <Input
            aria-label="執行次數"
            type="number"
            min={1}
            max={RUNNER_MAX_ITERATIONS}
            className="h-8"
            value={iterText}
            onChange={(e) => {
              setIterText(e.target.value)
              update({ iterations: clampInt(e.target.value, 1, RUNNER_MAX_ITERATIONS) })
            }}
          />
        </Field>
        <Field label="並行數">
          <Input
            aria-label="並行數"
            type="number"
            min={1}
            max={RUNNER_MAX_CONCURRENCY}
            className="h-8"
            value={concText}
            onChange={(e) => {
              setConcText(e.target.value)
              update({ concurrency: clampInt(e.target.value, 1, RUNNER_MAX_CONCURRENCY) })
            }}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        總輪數 = {f.iterations} × {f.concurrency} ={' '}
        {(f.iterations * f.concurrency).toLocaleString()}
        {f.concurrency > 1 &&
          '。並行時每個 worker 的變數各自獨立，環境 / Collection 變更不會寫入檔案'}
      </p>
      <Field label="請求間隔（ms）">
        <Input
          aria-label="請求間隔"
          type="number"
          min={0}
          max={RUNNER_MAX_DELAY_MS}
          className="h-8 w-32"
          value={delayText}
          onChange={(e) => {
            setDelayText(e.target.value)
            update({ delayMs: clampInt(e.target.value, 0, RUNNER_MAX_DELAY_MS) })
          }}
        />
      </Field>
      <CheckboxLabel
        checked={f.stopOnFailure}
        onChange={(e) => update({ stopOnFailure: e.target.checked })}
      >
        失敗時停止（錯誤、腳本錯誤或任一測試 / 斷言失敗）
      </CheckboxLabel>
      <Field label="回應內容" hint="保留時每筆上限 1 MB、總共 200 MB">
        <div className="flex gap-4 text-xs" role="radiogroup" aria-label="回應內容">
          {[
            [false, '不保留'],
            [true, '全部保留']
          ].map(([value, label]) => (
            <label key={String(value)} className="flex items-center gap-1.5">
              <input
                type="radio"
                className="accent-primary"
                checked={f.keepBodies === value}
                onChange={() => update({ keepBodies: value as boolean })}
              />
              {label as string}
            </label>
          ))}
        </div>
      </Field>
      <Field
        label="資料檔（CSV / JSON）"
        hint="第 n 輪使用第 (n mod 列數) 列；欄位可用 {{欄名}} 或 pm.iterationData"
      >
        {f.data ? (
          <div
            className="flex items-start gap-2 rounded-md border p-2 text-xs"
            data-testid="runner-data"
          >
            <FileSpreadsheet className="mt-px size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{f.data.fileName}</div>
              <div className="text-muted-foreground">
                {f.data.rows.length} 列 · 欄位：{f.data.columns.join('、')}
              </div>
            </div>
            <button type="button" aria-label="移除資料檔" onClick={() => update({ data: null })}>
              <X className="size-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void useRunnerStore.getState().pickDataFile(uid)}
          >
            <FileSpreadsheet />
            選擇檔案…
          </Button>
        )}
      </Field>
      <DataFileExample />
    </fieldset>
  )
}

const CSV_EXAMPLE = `username,password
alice,secret1
bob,secret2`

const JSON_EXAMPLE = `[
  { "username": "alice", "password": "secret1" },
  { "username": "bob", "password": "secret2" }
]`

/** What a data file looks like and how its columns are used. */
function DataFileExample() {
  const code = 'overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-snug'
  return (
    <details className="-mt-2 text-xs text-muted-foreground" data-testid="runner-data-example">
      <summary className="cursor-default select-none hover:text-foreground">查看資料檔範例</summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        <span>CSV（第一列是欄名）：</span>
        <pre className={code}>{CSV_EXAMPLE}</pre>
        <span>JSON（物件陣列）：</span>
        <pre className={code}>{JSON_EXAMPLE}</pre>
        <span>
          兩個範例都是 2 列：第 1、3、5… 輪用 alice，第 2、4、6… 輪用 bob。請求中寫{' '}
          <code className="font-mono">{'{{username}}'}</code>，腳本中用{' '}
          <code className="font-mono">pm.iterationData.get(&apos;username&apos;)</code>。
        </span>
      </div>
    </details>
  )
}

/** Result table columns; a hint explains the less obvious ones on hover. */
const ROW_COLUMNS: [string, string | null][] = [
  ['#', '完成的順序'],
  [
    '輪',
    '第幾輪：全部 worker 共用的流水號，依開始的先後編號（不是固定分給某個 worker）。一輪 = 勾選的請求依序各跑一次；有資料檔時第 n 輪用第 n 列'
  ],
  [
    'worker',
    '由第幾個 worker 執行。並行數 = 同時執行的 worker 數，每個 worker 依序跑「執行次數」輪，變數各自獨立'
  ],
  ['請求', null],
  ['狀態', null],
  ['耗時', null],
  ['大小', null],
  ['測試', '通過數 / 測試與斷言總數；— 表示這個請求沒有測試或斷言']
]

function StatsTable({ items, total }: { items: RunnerStatsRow[]; total: RunnerStatsRow }) {
  const cols: [string, (l: LatencyStats | null) => string][] = [
    ['平均', (l) => ms(l?.avg)],
    ['最小', (l) => ms(l?.min)],
    ['最大', (l) => ms(l?.max)],
    ['p50', (l) => ms(l?.p50)],
    ['p90', (l) => ms(l?.p90)],
    ['p95', (l) => ms(l?.p95)],
    ['p99', (l) => ms(l?.p99)],
    ['標準差', (l) => ms(l?.stdDev)]
  ]
  const rows = [...items, total]
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-xs whitespace-nowrap" data-testid="runner-stats">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {['請求', '次數', '成功', '失敗', '錯誤率', '測試通過', ...cols.map(([h]) => h)].map(
              (h) => (
                <th key={h} className={cn('px-2 py-1.5 font-medium', h !== '請求' && 'text-right')}>
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr
              key={r.itemId || 'total'}
              className={cn(
                'border-b last:border-b-0',
                r.itemId === '' && 'bg-muted/50 font-medium'
              )}
              data-testid={r.itemId === '' ? 'runner-stats-total' : 'runner-stats-row'}
            >
              <td className="max-w-56 truncate px-2 py-1.5" title={r.name}>
                {r.name}
              </td>
              <td className="px-2 py-1.5 text-right">{r.count}</td>
              <td className="px-2 py-1.5 text-right">{r.succeeded}</td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right',
                  r.failed > 0 && 'text-red-700 dark:text-red-400'
                )}
              >
                {r.failed}
              </td>
              <td className="px-2 py-1.5 text-right">{(r.errorRate * 100).toFixed(1)}%</td>
              <td className="px-2 py-1.5 text-right">
                {r.testsPassed + r.testsFailed === 0
                  ? '—'
                  : `${r.testsPassed} / ${r.testsPassed + r.testsFailed}`}
              </td>
              {cols.map(([h, get]) => (
                <td key={h} className="px-2 py-1.5 text-right">
                  {get(r.latency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Distribution({
  title,
  counts,
  label
}: {
  title: string
  counts: Record<string, number>
  label?: (k: string) => string
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">{title}</span>
      {entries.length === 0 ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, v]) => (
            <span key={k} className="rounded border px-1.5 py-0.5 font-mono text-xs tabular-nums">
              {label ? label(k) : k} × {v}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function RowDetailDialog({
  uid,
  detail
}: {
  uid: string
  detail: RunnerRowDetail | null | undefined
}) {
  const close = () => void useRunnerStore.getState().showDetail(uid, null)
  const pretty = useMemo(() => {
    if (!detail?.body) return null
    try {
      return JSON.stringify(JSON.parse(detail.body), null, 2)
    } catch {
      return detail.body
    }
  }, [detail])
  return (
    <Dialog open={detail !== undefined} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-3xl" data-testid="runner-row-detail">
        <DialogHeader>
          <DialogTitle>{detail ? `#${detail.index + 1} ${detail.name}` : '詳細內容'}</DialogTitle>
        </DialogHeader>
        {detail === null ? (
          <p className="text-sm text-muted-foreground">
            這筆的詳細內容沒有保留（只保留前 2000 筆，以及之後失敗的 2000 筆）。
          </p>
        ) : (
          detail && (
            <div className="flex max-h-[65vh] min-h-0 flex-col gap-2">
              <p className="font-mono text-xs break-all text-muted-foreground select-text">
                {detail.method} {detail.url}
              </p>
              <p className="text-xs">
                {detail.status !== null
                  ? `${detail.status} ${detail.statusText}`
                  : `${ERROR_LABEL[detail.errorCode ?? 'UNKNOWN'] ?? ''}：${detail.errorMessage ?? ''}`}{' '}
                · {formatDuration(detail.timeMs)} · {formatBytes(detail.sizeBytes)} · 第{' '}
                {detail.round + 1} 輪 · worker {detail.worker + 1}
              </p>
              <Tabs
                defaultValue={detail.scriptReport ? 'tests' : 'response'}
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList>
                  {detail.scriptReport && <TabsTrigger value="tests">Tests</TabsTrigger>}
                  {detail.scriptReport && <TabsTrigger value="console">Console</TabsTrigger>}
                  <TabsTrigger value="response">回應</TabsTrigger>
                  <TabsTrigger value="request">請求 Headers</TabsTrigger>
                  {detail.data && <TabsTrigger value="data">資料列</TabsTrigger>}
                </TabsList>
                {detail.scriptReport && (
                  <>
                    <TabsContent value="tests" className="min-h-0 flex-1 overflow-auto">
                      <TestsPanel report={detail.scriptReport} />
                    </TabsContent>
                    <TabsContent value="console" className="min-h-0 flex-1 overflow-auto">
                      <ConsolePanel report={detail.scriptReport} />
                    </TabsContent>
                  </>
                )}
                <TabsContent
                  value="response"
                  className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2"
                >
                  <HeaderTable headers={detail.responseHeaders} />
                  {pretty !== null ? (
                    <div className="h-64 overflow-hidden rounded-md border">
                      <CodeEditor value={pretty} language="json" readOnly className="h-full" />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{detail.bodyNote}</p>
                  )}
                </TabsContent>
                <TabsContent value="request" className="min-h-0 flex-1 overflow-auto p-2">
                  <HeaderTable headers={detail.requestHeaders} />
                </TabsContent>
                {detail.data && (
                  <TabsContent value="data" className="min-h-0 flex-1 overflow-auto p-2">
                    <HeaderTable headers={Object.entries(detail.data)} />
                  </TabsContent>
                )}
              </Tabs>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

function HeaderTable({ headers }: { headers: [string, string][] }) {
  if (headers.length === 0) return <p className="text-xs text-muted-foreground">（沒有）</p>
  return (
    <table className="w-full table-fixed text-xs select-text">
      <tbody>
        {headers.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-b align-top last:border-b-0">
            <td className="w-[30%] py-1 pr-3 font-mono font-medium break-all">{k}</td>
            <td className="py-1 font-mono break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Results({ uid, session }: { uid: string; session: RunnerSession }) {
  const run = session.run
  if (!run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Play className="size-5" />
        設定好之後按「開始執行」
      </div>
    )
  }
  const p = run.progress
  const pct = p.totalRequests === 0 ? 0 : (p.completedRequests / p.totalRequests) * 100
  const timeline = p.stats.timeline
  const seconds = timeline.map((t) => t.second)
  const page = session.page
  const pages = Math.max(1, Math.ceil(page.total / RUNNER_PAGE_SIZE))
  const current = Math.floor(page.offset / RUNNER_PAGE_SIZE)
  const store = useRunnerStore.getState()

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="runner-results">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              p.status === 'running' && 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
              p.status === 'done' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
              (p.status === 'stopped' || p.status === 'error') &&
                'bg-red-500/15 text-red-700 dark:text-red-400',
              p.status === 'cancelled' && 'bg-muted text-muted-foreground'
            )}
            data-testid="runner-status"
            data-status={p.status}
          >
            {STATUS_LABEL[p.status]}
          </span>
          <span className="tabular-nums" data-testid="runner-counts">
            {p.completedRequests.toLocaleString()} / {p.totalRequests.toLocaleString()} 個請求 ·{' '}
            {p.completedRounds} / {p.totalRounds} 輪 · {formatDuration(p.elapsedMs)}
          </span>
          {p.message && p.status !== 'cancelled' && (
            <span className="text-xs text-muted-foreground">{p.message}</span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        {run.skipped.length > 0 && (
          <span className="text-xs text-muted-foreground">
            略過（WebSocket 或無法讀取）：{run.skipped.join('、')}
          </span>
        )}
      </div>

      <StatsTable items={p.stats.items} total={p.stats.total} />

      <div className="grid grid-cols-2 gap-4">
        <Distribution title="狀態碼" counts={p.stats.statusCodes} />
        <Distribution
          title="錯誤類別"
          counts={p.stats.errorCodes}
          label={(k) => ERROR_LABEL[k as HttpErrorCode] ?? k}
        />
      </div>

      {timeline.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <LineChart
            title="耗時（每秒）"
            unit="ms"
            seconds={seconds}
            data-testid="runner-latency-chart"
            series={[
              { name: 'p50', color: 'var(--chart-1)', values: timeline.map((t) => t.p50) },
              { name: 'p95', color: 'var(--chart-2)', values: timeline.map((t) => t.p95) }
            ]}
          />
          <LineChart
            title="每秒完成的請求數"
            unit="個"
            seconds={seconds}
            data-testid="runner-rps-chart"
            series={[
              { name: '請求數', color: 'var(--chart-1)', values: timeline.map((t) => t.requests) }
            ]}
          />
        </div>
      )}
      {timeline.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-default text-muted-foreground">圖表資料表</summary>
          <table className="mt-1 text-right tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                {['秒', '請求數', 'p50（ms）', 'p95（ms）'].map((h) => (
                  <th key={h} className="px-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.map((t) => (
                <tr key={t.second}>
                  <td className="px-2">{t.second}</td>
                  <td className="px-2">{t.requests}</td>
                  <td className="px-2">{t.p50 === null ? '—' : Math.round(t.p50)}</td>
                  <td className="px-2">{t.p95 === null ? '—' : Math.round(t.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">結果</span>
          <div className="flex gap-3 text-xs" role="radiogroup" aria-label="篩選結果">
            {[
              [false, '全部'],
              [true, '只看失敗']
            ].map(([value, label]) => (
              <label key={String(value)} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  className="accent-primary"
                  checked={page.failedOnly === value}
                  onChange={() =>
                    void store.loadPage(uid, { offset: 0, failedOnly: value as boolean })
                  }
                />
                {label as string}
              </label>
            ))}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground tabular-nums">
            第 {current + 1} / {pages} 頁（{page.total.toLocaleString()} 筆）
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="上一頁"
            disabled={current === 0}
            onClick={() => void store.loadPage(uid, { offset: (current - 1) * RUNNER_PAGE_SIZE })}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="下一頁"
            disabled={current >= pages - 1}
            onClick={() => void store.loadPage(uid, { offset: (current + 1) * RUNNER_PAGE_SIZE })}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-xs whitespace-nowrap" data-testid="runner-rows">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {ROW_COLUMNS.map(([h, hint]) => (
                  <th key={h} className="px-2 py-1.5 font-medium" title={hint ?? undefined}>
                    {hint ? (
                      <span className="inline-flex items-center gap-1">
                        {h}
                        <CircleHelp className="size-3 opacity-60" aria-hidden />
                      </span>
                    ) : (
                      h
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {page.rows.map((r) => (
                <tr
                  key={r.index}
                  className={cn(
                    'cursor-default border-b last:border-b-0 hover:bg-accent/60',
                    r.failed && 'bg-red-500/5'
                  )}
                  data-testid="runner-row"
                  data-failed={r.failed}
                  onClick={() => void store.showDetail(uid, r.index)}
                >
                  <td className="px-2 py-1">{r.index + 1}</td>
                  <td className="px-2 py-1">{r.round + 1}</td>
                  <td className="px-2 py-1">{r.worker + 1}</td>
                  <td className="max-w-56 truncate px-2 py-1" title={r.url}>
                    {r.name}
                  </td>
                  <td className={cn('px-2 py-1', r.failed && 'text-red-700 dark:text-red-400')}>
                    {r.status ?? ERROR_LABEL[r.errorCode ?? 'UNKNOWN'] ?? r.errorCode}
                  </td>
                  <td className="px-2 py-1">{formatDuration(r.timeMs)}</td>
                  <td className="px-2 py-1">{formatBytes(r.sizeBytes)}</td>
                  <td className="px-2 py-1">
                    {r.testsTotal === 0 ? '—' : `${r.testsPassed} / ${r.testsTotal}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <RowDetailDialog uid={uid} detail={session.detail} />
    </div>
  )
}

export function RunnerView({ tab }: { tab: RunnerTab }) {
  const session = useRunnerStore((s) => s.sessions[tab.uid])
  const target = useTreeStore((s) => findNode(s.tree, tab.itemId)?.node)
  const [exportError, setExportError] = useState<string | null>(null)
  useEffect(() => {
    if (!session) useRunnerStore.getState().open(tab.uid, tab.itemId)
  }, [session, tab.uid, tab.itemId])
  if (!session || !target) return null
  const store = useRunnerStore.getState()
  const running = session.run?.progress.status === 'running'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="runner-view">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium">Collection Runner：{target.name}</h2>
        <div className="flex-1" />
        {(session.error ?? exportError) && (
          <span className="truncate text-xs text-destructive" data-testid="runner-error">
            {session.error ?? exportError}
          </span>
        )}
        {session.run && !running && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void store.exportResults(tab.uid).then(
                () => setExportError(null),
                (e: unknown) => setExportError(errorMessage(e))
              )
            }
          >
            <Download />
            匯出結果
          </Button>
        )}
        {running ? (
          <Button variant="outline" size="sm" onClick={() => void store.cancel(tab.uid)}>
            <Square />
            停止
          </Button>
        ) : (
          <Button size="sm" disabled={session.starting} onClick={() => void store.start(tab.uid)}>
            <Play />
            開始執行
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-auto border-r">
          <Settings key={tab.uid} uid={tab.uid} session={session} target={target} />
        </div>
        <div className="min-w-0 flex-1 overflow-auto">
          <Results uid={tab.uid} session={session} />
        </div>
      </div>
    </div>
  )
}
