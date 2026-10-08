import { Code2, Save, Send, X } from 'lucide-react'
import { useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { HTTP_METHODS } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import { KeyValueTable } from '@renderer/components/key-value-table'
import { Button } from '@renderer/components/ui/button'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { VariableInput } from '@renderer/components/variable-input'
import {
  collectionIdOf,
  contextParentId,
  isTabDirty,
  type RequestTab
} from '@renderer/features/tabs/tab-model'
import { VariablesContext, useVariableMap } from '@renderer/lib/variables'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { AuthEditor } from './AuthEditor'
import { BodyEditor } from './BodyEditor'
import { CodeDialog } from './CodeDialog'
import { ScriptsTab, TestsTab } from './ScriptsEditor'
import { hasScripts } from '@shared/scripts'
import { HeadersEditor } from './HeadersEditor'
import { RequestSettingsTab } from './RequestSettingsTab'
import { ResponseViewer } from './ResponseViewer'

function Count({ n }: { n: number }) {
  return n > 0 ? (
    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{n}</span>
  ) : null
}

const active = (rows: { enabled: boolean; key: string }[]) =>
  rows.filter((r) => r.enabled && r.key.trim() !== '').length

export function RequestEditor({ tab, title }: { tab: RequestTab; title: string }) {
  const store = useTabsStore.getState()
  const running = tab.runId !== null
  const dirty = isTabDirty(tab)
  const draft = tab.draft as HttpRequest
  const set = (patch: Partial<HttpRequest>) =>
    store.updateRequest(tab.key, (d) => ({ ...d, ...patch }))
  const collectionId = useTreeStore((s) => collectionIdOf(s.tree, contextParentId(tab, s.tree)))
  const parentId = useTreeStore((s) => contextParentId(tab, s.tree))
  const variables = useVariableMap(collectionId)
  const isDraft = tab.itemId === null
  const [codeOpen, setCodeOpen] = useState(false)

  return (
    <VariablesContext value={variables}>
      <div className="flex h-full min-h-0 flex-col" data-testid="request-editor">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <h2 className="min-w-0 truncate text-sm font-medium" title={title}>
            {title}
          </h2>
          {isDraft && (
            <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
              尚未儲存的請求
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
            data-testid="codegen-button"
            onClick={() => setCodeOpen(true)}
            title="產生 cURL / fetch / axios / Python 程式碼"
          >
            <Code2 />
            Code
          </Button>
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

        {/* No keyboard shortcut for send / cancel on purpose (avoids accidental requests). */}
        <div className="flex items-center gap-2 px-3 py-2">
          <NativeSelect
            aria-label="HTTP 方法"
            className="h-9 w-28 font-mono text-xs font-semibold"
            value={draft.method}
            onChange={(e) => set({ method: e.target.value as HttpRequest['method'] })}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
          <VariableInput
            aria-label="URL"
            data-testid="url-input"
            className="h-9 flex-1 rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
            textClassName="px-3 font-mono text-sm"
            placeholder="https://api.example.com/users  或  {{baseUrl}}/users"
            value={draft.url}
            onChange={(e) => set({ url: e.target.value })}
          />
          {running ? (
            <Button variant="outline" className="w-24" onClick={() => void store.cancel(tab.key)}>
              <X />
              取消
            </Button>
          ) : (
            <Button className="w-24" onClick={() => void store.send(tab.key)}>
              <Send />
              發送
            </Button>
          )}
        </div>

        <Group orientation="vertical" className="min-h-0 flex-1">
          <Panel defaultSize="50%" minSize={120}>
            <Tabs defaultValue="params" className="flex h-full min-h-0 flex-col">
              <TabsList>
                <TabsTrigger value="params">
                  Params <Count n={active(draft.params)} />
                </TabsTrigger>
                <TabsTrigger value="headers">
                  Headers <Count n={active(draft.headers)} />
                </TabsTrigger>
                <TabsTrigger value="body">
                  Body{' '}
                  {draft.body.mode !== 'none' && (
                    <span className="size-1.5 rounded-full bg-primary" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="auth">Auth</TabsTrigger>
                <TabsTrigger value="scripts">
                  Scripts{' '}
                  {hasScripts(draft.scripts) && (
                    <span className="size-1.5 rounded-full bg-primary" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="tests">
                  Tests <Count n={draft.assertions.length + draft.extractions.length} />
                </TabsTrigger>
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
                    啟用的參數會在發送時加到 URL 後面（URL 欄位裡已寫的 query 也會保留）。
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
              <TabsContent value="body" className="flex min-h-0 flex-col">
                <BodyEditor body={draft.body} onChange={(body) => set({ body })} />
              </TabsContent>
              <TabsContent value="auth" className="overflow-auto">
                <AuthEditor
                  auth={draft.auth}
                  onChange={(auth) => set({ auth })}
                  inherited={tab.inherited}
                  scopeId={parentId}
                />
              </TabsContent>
              <TabsContent value="scripts" className="flex min-h-0 flex-col">
                <ScriptsTab
                  scripts={draft.scripts}
                  onChange={(scripts) => set({ scripts })}
                  inheritedFrom={tab.inherited.scripts}
                />
              </TabsContent>
              <TabsContent value="tests" className="overflow-auto">
                <TestsTab
                  assertions={draft.assertions}
                  extractions={draft.extractions}
                  onChange={(patch) => set(patch)}
                />
              </TabsContent>
              <TabsContent value="settings" className="overflow-auto">
                <RequestSettingsTab
                  settings={draft.settings}
                  onChange={(settings) => set({ settings })}
                />
              </TabsContent>
            </Tabs>
          </Panel>
          <Separator className="h-1 shrink-0 bg-border transition-colors hover:bg-primary/50 data-[separator=active]:bg-primary" />
          <Panel defaultSize="50%" minSize={120}>
            <ResponseViewer tab={tab} />
          </Panel>
        </Group>
        <CodeDialog tab={tab} open={codeOpen} onOpenChange={setCodeOpen} />
      </div>
    </VariablesContext>
  )
}
