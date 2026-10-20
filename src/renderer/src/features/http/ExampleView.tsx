import { ExternalLink } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { formatBytes, formatDuration } from '@shared/http'
import type { ExampleFile, ExampleSentBody } from '@shared/schemas/example'
import type { HttpRequest } from '@shared/schemas/http-request'
import { findExample } from '@shared/tree'
import { CodeEditor } from '@renderer/components/code-editor'
import { Button } from '@renderer/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import type { ExampleTab } from '@renderer/features/tabs/tab-model'
import { statusColor } from '@renderer/lib/status-color'
import { cn } from '@renderer/lib/utils'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { HeadersTable, ResponseBody } from './ResponseBody'

const enabledRows = (rows: { key: string; value: string; enabled: boolean }[]) =>
  rows
    .filter((r) => r.enabled && r.key.trim() !== '')
    .map((r): [string, string] => [r.key, r.value])

function looksJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function TextBlock({ text, testId }: { text: string; testId: string }) {
  return (
    <CodeEditor
      aria-label="Body"
      data-testid={testId}
      className="min-h-0 flex-1"
      readOnly
      wrap
      language={looksJson(text) ? 'json' : 'text'}
      value={text}
    />
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-sm text-muted-foreground">{children}</p>
}

/** The body that was sent. */
function SentBody({ body }: { body: ExampleSentBody }) {
  if (body.kind === 'none') return <Empty>（沒有 Body）</Empty>
  if (body.kind === 'form') {
    return (
      <HeadersTable
        testId="example-sent-body"
        headers={body.fields.map((f): [string, string] => [
          f.name,
          f.file ? `（檔案）${f.value}` : f.value
        ])}
      />
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <TextBlock text={body.text} testId="example-sent-body" />
    </div>
  )
}

/** The request as written ({{variables}} kept): imported examples have only this. */
function WrittenRequest({ request }: { request: HttpRequest }) {
  const body = request.body
  const bodyText =
    body.mode === 'json'
      ? body.json
      : body.mode === 'raw'
        ? body.raw
        : body.mode === 'urlencoded'
          ? enabledRows(body.urlencoded)
              .map(([k, v]) => `${k}=${v}`)
              .join('\n')
          : body.mode === 'formData'
            ? body.formData
                .filter((f) => f.enabled && f.key.trim() !== '')
                .map((f) => `${f.key}: ${f.type === 'file' ? `（檔案）${f.filePath}` : f.value}`)
                .join('\n')
            : ''
  const headers = enabledRows(request.headers)
  const params = enabledRows(request.params)
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 text-xs"
      data-testid="example-written"
    >
      <p className="font-mono break-all select-text">
        <span className="font-semibold">{request.method}</span> {request.url}
      </p>
      {params.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium text-muted-foreground">Params</h4>
          <HeadersTable headers={params} testId="example-written-params" />
        </section>
      )}
      {headers.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium text-muted-foreground">Headers</h4>
          <HeadersTable headers={headers} testId="example-written-headers" />
        </section>
      )}
      {bodyText !== '' && (
        <section className="flex min-h-40 flex-col">
          <h4 className="mb-1 font-medium text-muted-foreground">Body（{body.mode}）</h4>
          <TextBlock text={bodyText} testId="example-written-body" />
        </section>
      )}
    </div>
  )
}

function ResponseSide({ example }: { example: ExampleFile }) {
  const { response } = example
  const body = response.body
  const image = body.encoding === 'base64' && /^image\//i.test(response.contentType)
  return (
    <Tabs
      defaultValue="body"
      className="flex h-full min-h-0 flex-col"
      data-testid="example-response"
    >
      <div className="flex items-center gap-3 border-b pr-3">
        <TabsList className="border-b-0">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">Headers ({response.headers.length})</TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
            statusColor(response.status)
          )}
          data-testid="example-status"
        >
          {response.status} {response.statusText}
        </span>
        {response.timeMs > 0 && (
          <span className="text-xs text-muted-foreground">{formatDuration(response.timeMs)}</span>
        )}
        <span className="text-xs text-muted-foreground">{formatBytes(response.bodyBytes)}</span>
      </div>
      <TabsContent value="body" className="min-h-0 flex-1">
        <ResponseBody
          text={body.encoding === 'text' && body.data !== '' ? body.data : null}
          contentType={response.contentType}
        >
          {body.data === '' && <Empty>（回應沒有內容）</Empty>}
          {image && (
            <img
              alt="回應的圖片"
              src={`data:${response.contentType.split(';')[0]};base64,${body.data}`}
              className="max-h-full max-w-full self-start rounded border object-contain"
              data-testid="example-image"
            />
          )}
          {body.encoding === 'base64' && !image && body.data !== '' && (
            <Empty>
              二進位內容（{response.contentType || '未知類型'}，{formatBytes(response.bodyBytes)}
              ），無法直接顯示。
            </Empty>
          )}
        </ResponseBody>
      </TabsContent>
      <TabsContent value="headers" className="min-h-0 flex-1">
        <HeadersTable headers={response.headers} testId="example-response-headers" />
      </TabsContent>
    </Tabs>
  )
}

/** A saved result (decision 140): what was sent and what came back, read-only. */
export function ExampleView({ tab, title }: { tab: ExampleTab; title: string }) {
  const example = tab.data
  const requestId = useTreeStore((s) => findExample(s.tree, tab.exampleId)?.request.id ?? null)
  if (!example) return null
  const sent = example.sent
  const savedAt = example.savedAt ? new Date(example.savedAt) : null
  const headers = sent ? sent.headers : enabledRows(example.request.headers)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="example-view">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium" title={title}>
          {title}
        </h2>
        <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
          儲存的結果（唯讀）
        </span>
        {savedAt && !Number.isNaN(savedAt.getTime()) && (
          <span className="shrink-0 text-xs text-muted-foreground" data-testid="example-saved-at">
            {savedAt.toLocaleString()}
          </span>
        )}
        <div className="flex-1" />
        {requestId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => useTabsStore.getState().openItem(requestId, { preview: false })}
          >
            <ExternalLink />
            開啟請求
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-16 shrink-0 font-mono text-xs font-semibold">
          {sent?.method ?? example.request.method}
        </span>
        <p
          className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-sm select-text"
          title={sent?.url ?? example.request.url}
          data-testid="example-url"
        >
          {sent?.url ?? example.request.url}
        </p>
      </div>
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="40%" minSize={100}>
          <Tabs defaultValue="headers" className="flex h-full min-h-0 flex-col">
            <TabsList>
              <TabsTrigger value="headers">Headers ({headers.length})</TabsTrigger>
              <TabsTrigger value="body">Body</TabsTrigger>
            </TabsList>
            <TabsContent value="headers" className="min-h-0 flex-1">
              <HeadersTable headers={headers} testId="example-sent-headers" />
            </TabsContent>
            <TabsContent value="body" className="min-h-0 flex-1">
              {sent ? <SentBody body={sent.body} /> : <WrittenRequest request={example.request} />}
            </TabsContent>
          </Tabs>
        </Panel>
        <Separator className="h-1 shrink-0 bg-border transition-colors hover:bg-primary/50 data-[separator=active]:bg-primary" />
        <Panel defaultSize="60%" minSize={120}>
          <ResponseSide example={example} />
        </Panel>
      </Group>
    </div>
  )
}
