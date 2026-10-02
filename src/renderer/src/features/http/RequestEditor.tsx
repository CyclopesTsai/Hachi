import { Loader2, Save, Send, X } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { HTTP_METHODS } from '@shared/schemas/collection'
import type { HttpRequest } from '@shared/schemas/http-request'
import { KeyValueTable } from '@renderer/components/key-value-table'
import { Button } from '@renderer/components/ui/button'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { isDirty, useEditorStore, type RequestDoc } from '@renderer/stores/editor-store'
import { AuthEditor } from './AuthEditor'
import { BodyEditor } from './BodyEditor'
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

export function RequestEditor({ doc, name }: { doc: RequestDoc; name: string }) {
  const { updateRequest, save, send, cancel } = useEditorStore.getState()
  const running = useEditorStore((s) => s.run !== null)
  const runningThis = useEditorStore((s) => s.run?.requestId === doc.id)
  const saving = useEditorStore((s) => s.saving)
  const saveError = useEditorStore((s) => s.saveError)
  const dirty = isDirty(doc)
  const draft = doc.draft
  const set = (patch: Partial<HttpRequest>) => updateRequest((d) => ({ ...d, ...patch }))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="request-editor">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium" title={name}>
          {name}
        </h2>
        {dirty && (
          <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="有未儲存的修改" />
        )}
        <div className="flex-1" />
        {saveError && (
          <span className="truncate text-xs text-destructive" title={saveError}>
            {saveError}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
          title="儲存（CmdOrCtrl+S）"
        >
          <Save />
          儲存
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
        <input
          aria-label="URL"
          data-testid="url-input"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          placeholder="https://api.example.com/users"
          spellCheck={false}
          value={draft.url}
          onChange={(e) => set({ url: e.target.value })}
        />
        {runningThis ? (
          <Button variant="outline" className="w-24" onClick={() => void cancel()}>
            <X />
            取消
          </Button>
        ) : (
          <Button className="w-24" disabled={running} onClick={() => void send()}>
            {running ? <Loader2 className="animate-spin" /> : <Send />}
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
                inherited={doc.inherited}
              />
            </TabsContent>
            <TabsContent value="body" className="flex min-h-0 flex-col">
              <BodyEditor body={draft.body} onChange={(body) => set({ body })} />
            </TabsContent>
            <TabsContent value="auth" className="overflow-auto">
              <AuthEditor
                auth={draft.auth}
                onChange={(auth) => set({ auth })}
                inherited={doc.inherited}
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
          <ResponseViewer requestId={doc.id} />
        </Panel>
      </Group>
    </div>
  )
}
