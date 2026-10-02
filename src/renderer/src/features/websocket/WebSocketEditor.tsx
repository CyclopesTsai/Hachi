import { AlertTriangle, Plug, Save, Unplug, X } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { WsRequest } from '@shared/schemas/ws-request'
import { WS_CLOSE_CODE_NAMES, type WsConnState } from '@shared/ws'
import { KeyValueTable } from '@renderer/components/key-value-table'
import { Button } from '@renderer/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { VariableInput } from '@renderer/components/variable-input'
import { AuthEditor } from '@renderer/features/http/AuthEditor'
import { HeadersEditor } from '@renderer/features/http/HeadersEditor'
import {
  collectionIdOf,
  contextParentId,
  isTabDirty,
  type WsTab
} from '@renderer/features/tabs/tab-model'
import { cn } from '@renderer/lib/utils'
import { VariablesContext, useVariableMap } from '@renderer/lib/variables'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { isLive, useWsStore } from '@renderer/stores/ws-store'
import { Composer } from './Composer'
import { MessageLog } from './MessageLog'
import { WsSettingsTab } from './WsSettingsTab'

const STATUS: Record<WsConnState['status'] | 'idle', { label: string; dot: string }> = {
  idle: { label: '未連線', dot: 'bg-muted-foreground/40' },
  connecting: { label: '連線中', dot: 'bg-amber-500 animate-pulse' },
  open: { label: '已連線', dot: 'bg-emerald-500' },
  closing: { label: '中斷中', dot: 'bg-amber-500' },
  closed: { label: '已關閉', dot: 'bg-muted-foreground/60' },
  error: { label: '錯誤', dot: 'bg-red-500' }
}

function statusDetail(state: WsConnState | null): string | undefined {
  if (!state) return undefined
  if (state.error) return state.error
  if (state.closeCode !== undefined) {
    const name = WS_CLOSE_CODE_NAMES[state.closeCode] ?? ''
    return `Close Code ${state.closeCode} ${name}${state.closeReason ? `：${state.closeReason}` : ''}`
  }
  return state.url
}

export function WsStatusBadge({ state }: { state: WsConnState | null }) {
  const status = STATUS[state?.status ?? 'idle']
  const closeCode = state?.status === 'closed' ? state.closeCode : undefined
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="ws-status"
      data-status={state?.status ?? 'idle'}
      title={statusDetail(state)}
    >
      <span className={cn('size-2 rounded-full', status.dot)} />
      {status.label}
      {closeCode !== undefined && <span className="font-mono">{closeCode}</span>}
    </span>
  )
}

function Count({ n }: { n: number }) {
  return n > 0 ? (
    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{n}</span>
  ) : null
}

const active = (rows: { enabled: boolean; key: string }[]) =>
  rows.filter((r) => r.enabled && r.key.trim() !== '').length

export function WebSocketEditor({ tab, title }: { tab: WsTab; title: string }) {
  const store = useTabsStore.getState()
  const session = useWsStore((s) => s.sessions[tab.uid])
  const state = session?.state ?? null
  const live = isLive(session)
  const open = state?.status === 'open'
  const dirty = isTabDirty(tab)
  const isDraft = tab.itemId === null
  const draft = tab.draft as WsRequest
  const set = (patch: Partial<WsRequest>) => store.updateWs(tab.key, (d) => ({ ...d, ...patch }))
  const collectionId = useTreeStore((s) => collectionIdOf(s.tree, contextParentId(tab, s.tree)))
  const variables = useVariableMap(collectionId)

  /** Where `{{variables}}` come from, read when connecting / sending. */
  const context = () => {
    const current = useTabsStore.getState().tabs.find((t) => t.uid === tab.uid) ?? tab
    return {
      parentId: contextParentId(current, useTreeStore.getState().tree),
      environmentId: useEnvStore.getState().activeId
    }
  }

  const connect = () => {
    store.pin(tab.key)
    const current = useTabsStore.getState().tabs.find((t) => t.uid === tab.uid)
    if (current?.kind !== 'websocket' || !current.draft) return
    void useWsStore.getState().connect(tab.uid, {
      ...context(),
      requestId: current.itemId,
      request: current.draft
    })
  }
  const disconnect = () =>
    void useWsStore
      .getState()
      .disconnect(tab.uid, draft.settings.closeCode, draft.settings.closeReason)

  const unresolved = session?.unresolved ?? []

  return (
    <VariablesContext value={variables}>
      <div className="flex h-full min-h-0 flex-col" data-testid="ws-editor">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <h2 className="min-w-0 truncate text-sm font-medium" title={title}>
            {title}
          </h2>
          {isDraft && (
            <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
              尚未儲存的 WebSocket
            </span>
          )}
          {dirty && (
            <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="有未儲存的修改" />
          )}
          <div className="flex-1" />
          {tab.saveError && (
            <span className="truncate text-xs text-destructive" title={tab.saveError}>
              {tab.saveError}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={(!dirty && !isDraft) || tab.saving}
            onClick={() => void store.save(tab.key)}
            title="儲存（CmdOrCtrl+S）"
          >
            <Save />
            {isDraft ? '儲存到…' : '儲存'}
          </Button>
        </div>

        {/* No keyboard shortcuts for connect / disconnect / send (decision 21). */}
        <div className="flex items-center gap-2 px-3 py-2">
          <WsStatusBadge state={state} />
          <VariableInput
            aria-label="WebSocket URL"
            data-testid="ws-url-input"
            className="h-9 flex-1 rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
            textClassName="px-3 font-mono text-sm"
            placeholder="wss://echo.example.com/socket  或  {{wsUrl}}"
            value={draft.url}
            onChange={(e) => set({ url: e.target.value })}
          />
          {live ? (
            <Button variant="outline" className="w-24" onClick={disconnect}>
              {state?.status === 'connecting' ? <X /> : <Unplug />}
              {state?.status === 'connecting' ? '取消' : '中斷'}
            </Button>
          ) : (
            <Button className="w-24" onClick={connect}>
              <Plug />
              連線
            </Button>
          )}
        </div>
        {(unresolved.length > 0 || state?.status === 'error') && (
          <div className="flex flex-col gap-0.5 px-3 pb-2 text-xs">
            {state?.status === 'error' && state.error && (
              <p className="flex items-center gap-1 text-destructive" data-testid="ws-error">
                <AlertTriangle className="size-3.5 shrink-0" />
                {state.error}
              </p>
            )}
            {unresolved.length > 0 && (
              <p className="text-amber-700 dark:text-amber-400" data-testid="ws-unresolved">
                找不到變數，已照原樣送出：
                <span className="font-mono">{unresolved.map((n) => `{{${n}}}`).join('、')}</span>
              </p>
            )}
          </div>
        )}

        <Group orientation="vertical" className="min-h-0 flex-1">
          <Panel defaultSize="38%" minSize={110}>
            <Tabs defaultValue="params" className="flex h-full min-h-0 flex-col">
              <TabsList>
                <TabsTrigger value="params">
                  Params <Count n={active(draft.params)} />
                </TabsTrigger>
                <TabsTrigger value="headers">
                  Headers <Count n={active(draft.headers)} />
                </TabsTrigger>
                <TabsTrigger value="auth">Auth</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="params" className="overflow-auto">
                <div className="flex flex-col gap-2 p-4">
                  <KeyValueTable
                    rows={draft.params}
                    onChange={(params) => set({ params })}
                    keyPlaceholder="Query 參數"
                    data-testid="params-table"
                  />
                  <p className="text-xs text-muted-foreground">
                    啟用的參數會在連線時加到 URL 後面。
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="headers" className="overflow-auto">
                <HeadersEditor
                  headers={draft.headers}
                  onChange={(headers) => set({ headers })}
                  inherited={tab.inherited}
                />
              </TabsContent>
              <TabsContent value="auth" className="overflow-auto">
                <AuthEditor
                  auth={draft.auth}
                  onChange={(auth) => set({ auth })}
                  inherited={tab.inherited}
                />
              </TabsContent>
              <TabsContent value="settings" className="overflow-auto">
                <WsSettingsTab
                  subprotocols={draft.subprotocols}
                  onSubprotocolsChange={(subprotocols) => set({ subprotocols })}
                  settings={draft.settings}
                  onChange={(settings) => set({ settings })}
                />
              </TabsContent>
            </Tabs>
          </Panel>
          <Separator className="h-1 shrink-0 bg-border transition-colors hover:bg-primary/50 data-[separator=active]:bg-primary" />
          <Panel defaultSize="62%" minSize={160}>
            <Group orientation="horizontal" className="h-full">
              <Panel defaultSize="62%" minSize={240}>
                <MessageLog uid={tab.uid} title={title} />
              </Panel>
              <Separator className="w-1 shrink-0 bg-border transition-colors hover:bg-primary/50 data-[separator=active]:bg-primary" />
              <Panel defaultSize="38%" minSize={220}>
                <Composer tab={tab} open={open} context={context} />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </VariablesContext>
  )
}
