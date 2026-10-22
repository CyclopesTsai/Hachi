import { useState } from 'react'
import { ArrowDown, ArrowUp, Play, Plus, RotateCw, Save, Square, Trash2 } from 'lucide-react'
import type { MockLogEntry } from '@shared/mock'
import {
  MOCK_DELAY_MAX_MS,
  MOCK_INTERVAL_MAX_MS,
  MOCK_INTERVAL_MIN_MS,
  MOCK_METHODS,
  WS_MATCH_MODES,
  mockRouteSchema,
  mockWsEndpointSchema,
  mockWsIntervalSchema,
  mockWsMessageSchema,
  mockWsRuleSchema,
  type MockMethod,
  type MockRoute,
  type MockSettings,
  type MockWsEndpoint,
  type WsMatchMode
} from '@shared/schemas/mock'
import { CodeEditor } from '@renderer/components/code-editor'
import { KeyValueTable } from '@renderer/components/key-value-table'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { isTabDirty, type MockTab } from '@renderer/features/tabs/tab-model'
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useMockStore } from '@renderer/stores/mock-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { localeOf, msg } from '@shared/i18n'

const clampInt = (text: string, min: number, max: number) => {
  const n = Math.round(Number(text))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

const newId = () => crypto.randomUUID()

/** Moves item `i` one place up (-1) or down (+1). */
function move<T>(list: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by
  if (j < 0 || j >= list.length) return [...list]
  const out = [...list]
  ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  return out
}

function RowButtons({
  onUp,
  onDown,
  onDelete,
  label
}: {
  onUp: () => void
  onDown: () => void
  onDelete: () => void
  label: string
}) {
  const b = 'size-6 text-muted-foreground hover:text-foreground'
  return (
    <span className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        className={b}
        aria-label={msg().mock.moveUp}
        onClick={onUp}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={b}
        aria-label={msg().mock.moveDown}
        onClick={onDown}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={b}
        aria-label={msg().mock.deleteItem(label)}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

const looksJson = (text: string) => /^\s*[[{]/.test(text)

// ---- HTTP routes ----------------------------------------------------------------

function RouteDetail({ route, set }: { route: MockRoute; set: (r: MockRoute) => void }) {
  const [delayText, setDelayText] = useState(String(route.delayMs))
  const [statusText, setStatusText] = useState(String(route.status))
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3"
      data-testid="mock-route-detail"
    >
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <NativeSelect
          aria-label={msg().mock.method}
          value={route.method}
          onChange={(e) => set({ ...route, method: e.target.value as MockMethod })}
        >
          {MOCK_METHODS.map((m) => (
            <option key={m} value={m}>
              {m === 'ANY' ? msg().mock.anyMethod : m}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label={msg().mock.path}
          className="h-8 font-mono text-xs"
          placeholder="/users/:id"
          value={route.path}
          onChange={(e) => set({ ...route, path: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={msg().mock.status}>
          <Input
            aria-label={msg().mock.status}
            type="number"
            min={100}
            max={599}
            className="h-8"
            value={statusText}
            onChange={(e) => {
              setStatusText(e.target.value)
              set({ ...route, status: clampInt(e.target.value, 100, 599) })
            }}
          />
        </Field>
        <Field label={msg().mock.delay}>
          <Input
            aria-label={msg().mock.delayLabel}
            type="number"
            min={0}
            max={MOCK_DELAY_MAX_MS}
            className="h-8"
            value={delayText}
            onChange={(e) => {
              setDelayText(e.target.value)
              set({ ...route, delayMs: clampInt(e.target.value, 0, MOCK_DELAY_MAX_MS) })
            }}
          />
        </Field>
      </div>
      <Field label={msg().mock.description}>
        <Input
          aria-label={msg().mock.description}
          className="h-8 text-xs"
          value={route.description}
          onChange={(e) => set({ ...route, description: e.target.value })}
        />
      </Field>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Headers</Label>
        <KeyValueTable rows={route.headers} onChange={(headers) => set({ ...route, headers })} />
      </div>
      <div className="flex min-h-40 flex-1 flex-col gap-1">
        <Label className="text-xs text-muted-foreground">{msg().mock.bodyLabel}</Label>
        <CodeEditor
          aria-label={msg().mock.responseBody}
          data-testid="mock-route-body"
          className="min-h-32 flex-1 rounded-md border"
          language={looksJson(route.body) ? 'json' : 'text'}
          wrap
          value={route.body}
          onChange={(body) => set({ ...route, body })}
        />
      </div>
    </div>
  )
}

function RoutesTab({
  routes,
  onChange
}: {
  routes: MockRoute[]
  onChange: (routes: MockRoute[]) => void
}) {
  const [selected, setSelected] = useState<string | null>(routes[0]?.id ?? null)
  const route = routes.find((r) => r.id === selected) ?? null
  const add = () => {
    const r = mockRouteSchema.parse({ id: newId(), path: '/' })
    onChange([...routes, r])
    setSelected(r.id)
  }
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-80 shrink-0 flex-col border-r">
        <ul className="min-h-0 flex-1 overflow-auto p-1" data-testid="mock-routes">
          {routes.map((r, i) => (
            <li
              key={r.id}
              className={cn(
                'group flex h-8 items-center gap-1.5 rounded-sm pl-1.5 text-xs hover:bg-accent/60',
                r.id === selected && 'bg-accent'
              )}
              data-testid="mock-route"
              onClick={() => setSelected(r.id)}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                aria-label={msg().mock.enabled}
                checked={r.enabled}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onChange(
                    routes.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x))
                  )
                }
              />
              <span className="w-12 shrink-0 font-mono font-semibold">
                {r.method === 'ANY' ? '*' : r.method}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-mono',
                  !r.enabled && 'line-through opacity-60'
                )}
              >
                {r.path}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.status}</span>
              <RowButtons
                label={msg().mock.route}
                onUp={() => onChange(move(routes, i, -1))}
                onDown={() => onChange(move(routes, i, 1))}
                onDelete={() => {
                  onChange(routes.filter((x) => x.id !== r.id))
                  if (selected === r.id) setSelected(null)
                }}
              />
            </li>
          ))}
        </ul>
        <div className="border-t p-2">
          <Button size="sm" variant="outline" onClick={add} data-testid="mock-add-route">
            <Plus />
            {msg().mock.addRoute}
          </Button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{msg().mock.routesHint}</p>
        </div>
      </div>
      {route ? (
        <RouteDetail
          key={route.id}
          route={route}
          set={(next) => onChange(routes.map((x) => (x.id === next.id ? next : x)))}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{msg().mock.pickRoute}</p>
      )}
    </div>
  )
}

// ---- WebSocket endpoints ----------------------------------------------------------

function MessageArea({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <textarea
      aria-label={label}
      spellCheck={false}
      className="min-h-14 w-full resize-y rounded-md border border-input bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring dark:bg-input/30"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function EndpointDetail({
  endpoint,
  set
}: {
  endpoint: MockWsEndpoint
  set: (e: MockWsEndpoint) => void
}) {
  const section = 'flex flex-col gap-2 rounded-md border p-2.5'
  const head = 'flex items-center gap-2 text-xs font-medium'
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3"
      data-testid="mock-ws-detail"
    >
      <Field label={msg().mock.path}>
        <Input
          aria-label={msg().mock.wsPath}
          className="h-8 font-mono text-xs"
          placeholder="/ws"
          value={endpoint.path}
          onChange={(e) => set({ ...endpoint, path: e.target.value })}
        />
      </Field>

      <section className={section}>
        <div className={head}>
          {msg().mock.onConnect}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() =>
              set({
                ...endpoint,
                onConnect: [...endpoint.onConnect, mockWsMessageSchema.parse({ id: newId() })]
              })
            }
          >
            <Plus />
            {msg().mock.addMessage}
          </Button>
        </div>
        {endpoint.onConnect.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <MessageArea
              label={msg().mock.onConnectMessage}
              value={m.message}
              onChange={(message) =>
                set({
                  ...endpoint,
                  onConnect: endpoint.onConnect.map((x) => (x.id === m.id ? { ...x, message } : x))
                })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={msg().mock.deleteMessage}
              onClick={() =>
                set({ ...endpoint, onConnect: endpoint.onConnect.filter((x) => x.id !== m.id) })
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </section>

      <section className={section}>
        <div className={head}>
          {msg().mock.rulesTitle}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() =>
              set({
                ...endpoint,
                rules: [...endpoint.rules, mockWsRuleSchema.parse({ id: newId() })]
              })
            }
          >
            <Plus />
            {msg().mock.addRule}
          </Button>
        </div>
        {endpoint.rules.map((r, i) => {
          const update = (patch: Partial<typeof r>) =>
            set({
              ...endpoint,
              rules: endpoint.rules.map((x) => (x.id === r.id ? { ...x, ...patch } : x))
            })
          return (
            <div
              key={r.id}
              className="flex flex-col gap-1.5 border-t pt-2 first-of-type:border-t-0"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  aria-label={msg().mock.enableRule}
                  checked={r.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                <span className="text-xs text-muted-foreground">{msg().mock.received}</span>
                <NativeSelect
                  aria-label={msg().mock.matchMode}
                  className="h-7 w-32 text-xs"
                  value={r.match}
                  onChange={(e) => update({ match: e.target.value as WsMatchMode })}
                >
                  {WS_MATCH_MODES.map((m) => (
                    <option key={m} value={m}>
                      {msg().mock.match[m]}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label={msg().mock.pattern}
                  className="h-7 flex-1 font-mono text-xs"
                  value={r.pattern}
                  onChange={(e) => update({ pattern: e.target.value })}
                />
                <RowButtons
                  label={msg().mock.rule}
                  onUp={() => set({ ...endpoint, rules: move(endpoint.rules, i, -1) })}
                  onDown={() => set({ ...endpoint, rules: move(endpoint.rules, i, 1) })}
                  onDelete={() =>
                    set({ ...endpoint, rules: endpoint.rules.filter((x) => x.id !== r.id) })
                  }
                />
              </div>
              <MessageArea
                label={msg().mock.reply}
                value={r.reply}
                onChange={(reply) => update({ reply })}
              />
            </div>
          )
        })}
      </section>

      <section className={section}>
        <div className={head}>
          {msg().mock.intervals}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() =>
              set({
                ...endpoint,
                intervals: [...endpoint.intervals, mockWsIntervalSchema.parse({ id: newId() })]
              })
            }
          >
            <Plus />
            {msg().mock.addInterval}
          </Button>
        </div>
        {endpoint.intervals.map((t) => {
          const update = (patch: Partial<typeof t>) =>
            set({
              ...endpoint,
              intervals: endpoint.intervals.map((x) => (x.id === t.id ? { ...x, ...patch } : x))
            })
          return (
            <div
              key={t.id}
              className="flex flex-col gap-1.5 border-t pt-2 first-of-type:border-t-0"
            >
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  aria-label={msg().mock.enableInterval}
                  checked={t.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                {msg().mock.every}
                <Input
                  aria-label={msg().mock.intervalLabel}
                  type="number"
                  min={MOCK_INTERVAL_MIN_MS}
                  max={MOCK_INTERVAL_MAX_MS}
                  className="h-7 w-28"
                  defaultValue={t.everyMs}
                  onChange={(e) =>
                    update({
                      everyMs: clampInt(e.target.value, MOCK_INTERVAL_MIN_MS, MOCK_INTERVAL_MAX_MS)
                    })
                  }
                />
                {msg().mock.millisecondsSend}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={msg().mock.deleteInterval}
                  onClick={() =>
                    set({ ...endpoint, intervals: endpoint.intervals.filter((x) => x.id !== t.id) })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <MessageArea
                label={msg().mock.pushContent}
                value={t.message}
                onChange={(message) => update({ message })}
              />
            </div>
          )
        })}
      </section>
    </div>
  )
}

function WebSocketTab({
  endpoints,
  onChange
}: {
  endpoints: MockWsEndpoint[]
  onChange: (e: MockWsEndpoint[]) => void
}) {
  const [selected, setSelected] = useState<string | null>(endpoints[0]?.id ?? null)
  const endpoint = endpoints.find((e) => e.id === selected) ?? null
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r">
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {endpoints.map((e, i) => (
            <li
              key={e.id}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-sm pl-1.5 text-xs hover:bg-accent/60',
                e.id === selected && 'bg-accent'
              )}
              data-testid="mock-ws-endpoint"
              onClick={() => setSelected(e.id)}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                aria-label={msg().mock.enabled}
                checked={e.enabled}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) =>
                  onChange(
                    endpoints.map((x) => (x.id === e.id ? { ...x, enabled: ev.target.checked } : x))
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate font-mono">{e.path}</span>
              <RowButtons
                label={msg().mock.endpoint}
                onUp={() => onChange(move(endpoints, i, -1))}
                onDown={() => onChange(move(endpoints, i, 1))}
                onDelete={() => onChange(endpoints.filter((x) => x.id !== e.id))}
              />
            </li>
          ))}
        </ul>
        <div className="border-t p-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="mock-add-ws"
            onClick={() => {
              const e = mockWsEndpointSchema.parse({ id: newId() })
              onChange([...endpoints, e])
              setSelected(e.id)
            }}
          >
            <Plus />
            {msg().mock.addEndpoint}
          </Button>
        </div>
      </div>
      {endpoint ? (
        <EndpointDetail
          key={endpoint.id}
          endpoint={endpoint}
          set={(next) => onChange(endpoints.map((x) => (x.id === next.id ? next : x)))}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{msg().mock.pickEndpoint}</p>
      )}
    </div>
  )
}

// ---- Log ----------------------------------------------------------------------------

const EMPTY_LOG: MockLogEntry[] = []

function LogTab({ mockId, settings }: { mockId: string; settings: MockSettings }) {
  const log = useMockStore((s) => s.logs[mockId] ?? EMPTY_LOG)
  const routeName = (id: string | null) => {
    if (id === null) return msg().mock.noMatch
    const r = settings.routes.find((x) => x.id === id)
    if (r) return `${r.method === 'ANY' ? '*' : r.method} ${r.path}`
    const e = settings.websockets.find((x) => x.id === id)
    return e ? `WS ${e.path}` : ''
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        {msg().mock.logCount(log.length)}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          disabled={log.length === 0}
          onClick={() => useMockStore.getState().clearLog(mockId)}
        >
          {msg().mock.clear}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs" data-testid="mock-log">
          <tbody>
            {[...log].reverse().map((l, i) => (
              <tr key={`${l.time}-${i}`} className="border-b align-top" data-testid="mock-log-row">
                <td className="px-3 py-1 whitespace-nowrap text-muted-foreground tabular-nums">
                  {new Date(l.time).toLocaleTimeString(localeOf())}
                </td>
                <td className="px-2 py-1 font-mono font-semibold whitespace-nowrap">
                  {l.kind === 'http'
                    ? l.method
                    : `WS ${msg().mock.logKinds[l.kind as Exclude<typeof l.kind, 'http'>]}`}
                </td>
                <td className="px-2 py-1 font-mono break-all">{l.path}</td>
                <td
                  className={cn(
                    'px-2 py-1 whitespace-nowrap',
                    l.routeId === null ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {routeName(l.routeId)}
                </td>
                <td className="px-2 py-1 whitespace-nowrap tabular-nums">{l.status ?? ''}</td>
                <td className="px-2 py-1 font-mono break-all text-muted-foreground select-text">
                  {l.text ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{msg().mock.logEmpty}</p>
        )}
      </div>
    </div>
  )
}

// ---- Editor -------------------------------------------------------------------------

/** A Mock Server's settings, start / stop and log (decision 133). */
export function MockEditor({ tab, title }: { tab: MockTab; title: string }) {
  const draft = tab.draft as MockSettings
  const status = useMockStore((s) => s.statuses[tab.mockId])
  const tabs = useTabsStore.getState()
  const dirty = isTabDirty(tab)
  const [error, setError] = useState<string | null>(null)
  const [portText, setPortText] = useState(String(draft.port))
  const update = (patch: Partial<MockSettings>) =>
    tabs.updateMock(tab.key, (d) => ({ ...d, ...patch }))
  const running = status?.running ?? false
  const logCount = useMockStore((s) => s.logs[tab.mockId]?.length ?? 0)

  const start = async () => {
    setError(null)
    try {
      if (dirty && !(await useTabsStore.getState().save(tab.key))) return
      await useMockStore.getState().start(tab.mockId)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const stop = async () => {
    setError(null)
    await useMockStore
      .getState()
      .stop(tab.mockId)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mock-editor">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
        {dirty && (
          <span className="size-2 rounded-full bg-primary" aria-label={msg().mock.unsaved} />
        )}
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-medium',
            running
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          )}
          data-testid="mock-status"
          data-running={running}
        >
          {running ? msg().mock.runningAt(status?.url ?? '') : msg().mock.stopped}
        </span>
        <div className="flex-1" />
        {(error ?? status?.error ?? tab.saveError) && (
          <span className="truncate text-xs text-destructive" data-testid="mock-error">
            {error ?? status?.error ?? tab.saveError}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || tab.saving}
          onClick={() => void useTabsStore.getState().save(tab.key)}
        >
          <Save />
          {msg().common.save}
        </Button>
        {running && (
          <Button size="sm" variant="outline" onClick={() => void stop()}>
            <Square />
            {msg().mock.stop}
          </Button>
        )}
        <Button size="sm" onClick={() => void start()} data-testid="mock-start">
          {running ? <RotateCw /> : <Play />}
          {running
            ? dirty
              ? msg().mock.saveRestart
              : msg().mock.restart
            : dirty
              ? msg().mock.saveStart
              : msg().mock.start}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-3 py-2 text-xs">
        <label className="flex items-center gap-2">
          {msg().mock.port}
          <Input
            aria-label={msg().mock.port}
            type="number"
            min={1}
            max={65535}
            className="h-7 w-24"
            value={portText}
            onChange={(e) => {
              setPortText(e.target.value)
              update({ port: clampInt(e.target.value, 1, 65535) })
            }}
          />
        </label>
        <CheckboxLabel
          checked={draft.lan}
          data-testid="mock-lan"
          onChange={(e) => update({ lan: e.target.checked })}
        >
          {msg().mock.lan}
        </CheckboxLabel>
        <CheckboxLabel checked={draft.cors} onChange={(e) => update({ cors: e.target.checked })}>
          {msg().mock.cors}
        </CheckboxLabel>
        {draft.lan && (
          <span className="text-amber-700 dark:text-amber-400">{msg().mock.lanWarning}</span>
        )}
        {running && dirty && (
          <span className="text-muted-foreground">{msg().mock.restartNeeded}</span>
        )}
      </div>
      <Tabs defaultValue="routes" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="routes">{msg().mock.routesTab(draft.routes.length)}</TabsTrigger>
          <TabsTrigger value="ws">{msg().mock.wsTab(draft.websockets.length)}</TabsTrigger>
          <TabsTrigger value="log">{msg().mock.logTab(logCount)}</TabsTrigger>
        </TabsList>
        <TabsContent value="routes" className="min-h-0 flex-1">
          <RoutesTab routes={draft.routes} onChange={(routes) => update({ routes })} />
        </TabsContent>
        <TabsContent value="ws" className="min-h-0 flex-1">
          <WebSocketTab
            endpoints={draft.websockets}
            onChange={(websockets) => update({ websockets })}
          />
        </TabsContent>
        <TabsContent value="log" className="min-h-0 flex-1">
          <LogTab mockId={tab.mockId} settings={draft} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
