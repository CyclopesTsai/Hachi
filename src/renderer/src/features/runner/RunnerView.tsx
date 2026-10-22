import {
  AlertTriangle,
  ChevronDown,
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
import { formatBytes, formatDuration } from '@shared/http'
import {
  RUNNER_MAX_CONCURRENCY,
  RUNNER_MAX_DELAY_MS,
  RUNNER_MAX_DURATION_SEC,
  RUNNER_MAX_ITERATIONS,
  type LatencyStats,
  type RunnerRowDetail,
  type RunnerStatsRow
} from '@shared/runner'
import { findNode, type TreeNode } from '@shared/tree'
import { CodeEditor } from '@renderer/components/code-editor'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
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
import { localeOf, msg } from '@shared/i18n'

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
  const [durationText, setDurationText] = useState(String(f.durationSec))
  const [concText, setConcText] = useState(String(f.concurrency))
  const [delayText, setDelayText] = useState(String(f.delayMs))

  return (
    // min-w-0: a fieldset is otherwise as wide as its widest content (the examples below).
    <fieldset
      disabled={running}
      className="flex min-w-0 flex-col gap-4 p-4"
      data-testid="runner-settings"
    >
      <Field
        label={msg().runner.requests(
          requests.filter((r) => !excluded.has(r.id)).length,
          requests.length
        )}
      >
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => update({ excluded: [] })}
          >
            {msg().runner.selectAll}
          </button>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => update({ excluded: requests.map((r) => r.id) })}
          >
            {msg().runner.selectNone}
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
                  title={ws ? msg().runner.wsSkipped : undefined}
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
            {msg().runner.unsavedNote}
          </span>
        )}
      </Field>
      <Field label={msg().runner.environment}>
        <NativeSelect
          aria-label={msg().runner.environment}
          value={f.environmentId ?? ''}
          onChange={(e) => update({ environmentId: e.target.value || null })}
        >
          <option value="">{msg().runner.noEnvironment}</option>
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
        <Field label={msg().runner.endMode}>
          <NativeSelect
            aria-label={msg().runner.endMode}
            value={f.endMode}
            onChange={(e) => update({ endMode: e.target.value as 'iterations' | 'duration' })}
          >
            <option value="iterations">{msg().runner.iterations}</option>
            <option value="duration">{msg().runner.duration}</option>
          </NativeSelect>
        </Field>
        {f.endMode === 'iterations' ? (
          <Field label={msg().runner.iterationsPerWorker}>
            <Input
              aria-label={msg().runner.iterations}
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
        ) : (
          <Field label={msg().runner.durationSec}>
            <Input
              aria-label={msg().runner.duration}
              type="number"
              min={1}
              max={RUNNER_MAX_DURATION_SEC}
              className="h-8"
              value={durationText}
              onChange={(e) => {
                setDurationText(e.target.value)
                update({ durationSec: clampInt(e.target.value, 1, RUNNER_MAX_DURATION_SEC) })
              }}
            />
          </Field>
        )}
        <Field label={msg().runner.concurrency}>
          <Input
            aria-label={msg().runner.concurrency}
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
        {f.endMode === 'iterations'
          ? msg().runner.totalRounds(
              f.iterations,
              f.concurrency,
              (f.iterations * f.concurrency).toLocaleString(localeOf())
            )
          : msg().runner.durationNote(f.concurrency, f.durationSec.toLocaleString(localeOf()))}
        {f.concurrency > 1 && msg().runner.concurrencyNote}
      </p>
      <Field label={msg().runner.delay}>
        <Input
          aria-label={msg().runner.delayLabel}
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
        {msg().runner.stopOnFailure}
      </CheckboxLabel>
      <Field label={msg().runner.keepBodies} hint={msg().runner.keepBodiesHint}>
        <div className="flex gap-4 text-xs" role="radiogroup" aria-label={msg().runner.keepBodies}>
          {[
            [false, msg().runner.keepNone],
            [true, msg().runner.keepAll]
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
      <Field label={msg().runner.dataFile} hint={msg().runner.dataFileHint}>
        {f.data ? (
          <div
            className="flex items-start gap-2 rounded-md border p-2 text-xs"
            data-testid="runner-data"
          >
            <FileSpreadsheet className="mt-px size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{f.data.fileName}</div>
              <div className="text-muted-foreground">
                {msg().runner.dataRows(f.data.rows.length, f.data.columns)}
              </div>
            </div>
            <button
              type="button"
              aria-label={msg().runner.removeData}
              onClick={() => update({ data: null })}
            >
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
            {msg().runner.chooseFile}
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
      <summary className="cursor-default select-none hover:text-foreground">
        {msg().runner.dataExample}
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        <span>{msg().runner.csvExample}</span>
        <pre className={code}>{CSV_EXAMPLE}</pre>
        <span>{msg().runner.jsonExample}</span>
        <pre className={code}>{JSON_EXAMPLE}</pre>
        <span>
          {msg().runner.exampleNote1} <code className="font-mono">{'{{username}}'}</code>
          {msg().runner.exampleNote2}{' '}
          <code className="font-mono">pm.iterationData.get(&apos;username&apos;)</code>
          {msg().runner.exampleNote3}
        </span>
      </div>
    </details>
  )
}

/** Result table columns; a hint explains the less obvious ones on hover. */
const rowColumns = (): [string, string | null][] => {
  const c = msg().runner.columns
  return ['index', 'round', 'worker', 'request', 'status', 'time', 'size', 'tests'].map(
    (k) => c[k] as [string, string | null]
  )
}

const errorLabel = (code: string | null | undefined): string | undefined =>
  msg().runner.errors[code ?? 'UNKNOWN']

function StatsTable({ items, total }: { items: RunnerStatsRow[]; total: RunnerStatsRow }) {
  const st = msg().runner.stats
  const cols: [string, (l: LatencyStats | null) => string][] = [
    [st.avg, (l) => ms(l?.avg)],
    [st.min, (l) => ms(l?.min)],
    [st.max, (l) => ms(l?.max)],
    ['p50', (l) => ms(l?.p50)],
    ['p90', (l) => ms(l?.p90)],
    ['p95', (l) => ms(l?.p95)],
    ['p99', (l) => ms(l?.p99)],
    [st.stdDev, (l) => ms(l?.stdDev)]
  ]
  const rows = [...items, total]
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-xs whitespace-nowrap" data-testid="runner-stats">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {[
              st.request,
              st.count,
              st.ok,
              st.failed,
              st.errorRate,
              st.testsPassed,
              ...cols.map(([h]) => h)
            ].map((h) => (
              <th
                key={h}
                className={cn('px-2 py-1.5 font-medium', h !== st.request && 'text-right')}
              >
                {h}
              </th>
            ))}
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
          <DialogTitle>
            {detail ? `#${detail.index + 1} ${detail.name}` : msg().runner.detail}
          </DialogTitle>
        </DialogHeader>
        {detail === null ? (
          <p className="text-sm text-muted-foreground">{msg().runner.detailMissing}</p>
        ) : (
          detail && (
            <div className="flex max-h-[65vh] min-h-0 flex-col gap-2">
              <p className="font-mono text-xs break-all text-muted-foreground select-text">
                {detail.method} {detail.url}
              </p>
              <p className="text-xs">
                {detail.status !== null
                  ? `${detail.status} ${detail.statusText}`
                  : msg().runner.errorWithMessage(
                      errorLabel(detail.errorCode) ?? '',
                      detail.errorMessage ?? ''
                    )}{' '}
                {msg().runner.detailLine(
                  formatDuration(detail.timeMs),
                  formatBytes(detail.sizeBytes),
                  detail.round + 1,
                  detail.worker + 1
                )}
              </p>
              <Tabs
                defaultValue={detail.scriptReport ? 'tests' : 'response'}
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList>
                  {detail.scriptReport && <TabsTrigger value="tests">Tests</TabsTrigger>}
                  {detail.scriptReport && <TabsTrigger value="console">Console</TabsTrigger>}
                  <TabsTrigger value="response">{msg().runner.response}</TabsTrigger>
                  <TabsTrigger value="request">{msg().runner.requestHeaders}</TabsTrigger>
                  {detail.data && <TabsTrigger value="data">{msg().runner.dataRow}</TabsTrigger>}
                </TabsList>
                {detail.scriptReport && (
                  <>
                    <TabsContent value="tests" className="min-h-0 flex-1 overflow-auto">
                      <TestsPanel report={detail.scriptReport} />
                    </TabsContent>
                    <TabsContent value="console" className="min-h-0 flex-1 overflow-auto">
                      <ConsolePanel report={detail.scriptReport} inRunner />
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
  if (headers.length === 0)
    return <p className="text-xs text-muted-foreground">{msg().runner.none}</p>
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
        {msg().runner.idle}
      </div>
    )
  }
  const p = run.progress
  const pct =
    p.durationMs !== null
      ? p.status === 'running'
        ? Math.min(100, (p.elapsedMs / p.durationMs) * 100)
        : 100
      : p.totalRequests === 0
        ? 0
        : (p.completedRequests / p.totalRequests) * 100
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
            {msg().runner.status[p.status]}
          </span>
          <span className="tabular-nums" data-testid="runner-counts">
            {p.durationMs !== null
              ? msg().runner.countsDuration(
                  p.completedRequests.toLocaleString(localeOf()),
                  p.completedRounds,
                  formatDuration(p.elapsedMs),
                  formatDuration(p.durationMs)
                )
              : msg().runner.counts(
                  p.completedRequests.toLocaleString(localeOf()),
                  p.totalRequests.toLocaleString(localeOf()),
                  p.completedRounds,
                  p.totalRounds,
                  formatDuration(p.elapsedMs)
                )}
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
          <span className="text-xs text-muted-foreground">{msg().runner.skipped(run.skipped)}</span>
        )}
      </div>

      <StatsTable items={p.stats.items} total={p.stats.total} />

      <div className="grid grid-cols-2 gap-4">
        <Distribution title={msg().runner.statusCodes} counts={p.stats.statusCodes} />
        <Distribution
          title={msg().runner.errorKinds}
          counts={p.stats.errorCodes}
          label={(k) => errorLabel(k) ?? k}
        />
      </div>

      {timeline.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <LineChart
            title={msg().runner.latencyChart}
            unit="ms"
            seconds={seconds}
            data-testid="runner-latency-chart"
            series={[
              { name: 'p50', color: 'var(--chart-1)', values: timeline.map((t) => t.p50) },
              { name: 'p95', color: 'var(--chart-2)', values: timeline.map((t) => t.p95) }
            ]}
          />
          <LineChart
            title={msg().runner.rpsChart}
            unit={msg().runner.rpsUnit}
            seconds={seconds}
            data-testid="runner-rps-chart"
            series={[
              {
                name: msg().runner.requestsSeries,
                color: 'var(--chart-1)',
                values: timeline.map((t) => t.requests)
              }
            ]}
          />
        </div>
      )}
      {timeline.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-default text-muted-foreground">
            {msg().runner.chartData}
          </summary>
          <table className="mt-1 text-right tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                {msg().runner.chartColumns.map((h) => (
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
          <span className="text-sm font-medium">{msg().runner.results}</span>
          <div
            className="flex gap-3 text-xs"
            role="radiogroup"
            aria-label={msg().runner.filterResults}
          >
            {[
              [false, msg().runner.all],
              [true, msg().runner.failedOnly]
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
            {msg().runner.page(current + 1, pages, page.total.toLocaleString(localeOf()))}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={msg().runner.previous}
            disabled={current === 0}
            onClick={() => void store.loadPage(uid, { offset: (current - 1) * RUNNER_PAGE_SIZE })}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={msg().runner.next}
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
                {rowColumns().map(([h, hint]) => (
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
                    {r.status ?? errorLabel(r.errorCode) ?? r.errorCode}
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
        <h2 className="min-w-0 truncate text-sm font-medium">{msg().runner.title(target.name)}</h2>
        <div className="flex-1" />
        {(session.error ?? exportError) && (
          <span className="truncate text-xs text-destructive" data-testid="runner-error">
            {session.error ?? exportError}
          </span>
        )}
        {session.run && !running && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="runner-export">
                <Download />
                {msg().runner.export}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(['html', 'json'] as const).map((format) => (
                <DropdownMenuItem
                  key={format}
                  onSelect={() =>
                    void store.exportResults(tab.uid, format).then(
                      () => setExportError(null),
                      (e: unknown) => setExportError(errorMessage(e))
                    )
                  }
                >
                  {format === 'html' ? msg().runner.exportHtml : msg().runner.exportJson}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {running ? (
          <Button variant="outline" size="sm" onClick={() => void store.cancel(tab.uid)}>
            <Square />
            {msg().runner.stop}
          </Button>
        ) : (
          <Button size="sm" disabled={session.starting} onClick={() => void store.start(tab.uid)}>
            <Play />
            {msg().runner.start}
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
