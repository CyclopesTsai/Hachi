import { AlertTriangle, Download, Eye, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import {
  formatBytes,
  formatDuration,
  type HttpErrorCode,
  type HttpResponseData,
  type HttpResult
} from '@shared/http'
import { Button } from '@renderer/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { cn } from '@renderer/lib/utils'
import { statusColor } from '@renderer/lib/status-color'
import type { RequestTab } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { testSummary } from '@shared/scripts'
import { HeadersTable, ResponseBody } from './ResponseBody'
import { SaveResultButton } from './SaveResultDialog'
import { ConsolePanel, TestsPanel } from './ScriptResults'
import { TlsDiagnosisView } from './TlsDiagnosisView'

const ERROR_TITLES: Record<HttpErrorCode, string> = {
  INVALID_URL: 'URL 格式不正確',
  TIMEOUT: '請求逾時',
  CANCELLED: '已取消請求',
  TLS: 'SSL / TLS 憑證驗證失敗（可在請求的 Settings 關閉 SSL 驗證）',
  PROXY: 'Proxy 連線失敗',
  NETWORK: '無法連線到伺服器',
  TOO_LARGE: '回應超過 100 MB，已中止接收',
  FILE_NOT_FOUND: '找不到檔案（Form-data 或 {{$file:…}}），請求沒有發送',
  FILE_ACCESS: '無法讀取檔案，請求沒有發送',
  TOO_MANY_REDIRECTS: '重新導向次數超過上限（可在 Workspace 設定調整）',
  SCRIPT: '腳本錯誤，請求沒有發送',
  AUTH: '驗證失敗，請求沒有發送',
  UNKNOWN: '發送失敗'
}

function BodyPanel({ result, tabKey }: { result: HttpResponseData; tabKey: string }) {
  const fullBody = useTabsStore((s) => s.fullBodies[result.runId])
  const tabs = useTabsStore.getState()
  const showFullBody = (runId: string) => tabs.showFullBody(tabKey, runId)
  const downloadResponse = (runId: string) => tabs.downloadResponse(tabKey, runId)
  const [busy, setBusy] = useState(false)
  const text = result.body.kind === 'text' ? result.body.text : (fullBody ?? null)

  const download = async () => {
    setBusy(true)
    await downloadResponse(result.runId)
    setBusy(false)
  }

  return (
    <ResponseBody
      text={text}
      contentType={result.contentType}
      actions={
        result.body.kind !== 'empty' && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void download()}>
            <Download />
            下載
          </Button>
        )
      }
    >
      {result.body.kind === 'empty' && (
        <p className="text-sm text-muted-foreground">（回應沒有內容）</p>
      )}
      {result.body.kind === 'binary' && (
        <p className="text-sm text-muted-foreground">
          二進位內容（{result.contentType || '未知類型'}，{formatBytes(result.bodyBytes)}
          ），無法直接顯示，請下載後開啟。
        </p>
      )}
      {result.body.kind === 'large' && fullBody === undefined && (
        <div
          className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4"
          data-testid="large-body"
        >
          <p className="text-sm">
            回應內容較大（{formatBytes(result.bodyBytes)}），預設不顯示以免畫面卡頓。
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await showFullBody(result.runId)
                setBusy(false)
              }}
            >
              <Eye />
              顯示
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void download()}>
              <Download />
              下載
            </Button>
          </div>
        </div>
      )}
    </ResponseBody>
  )
}

function CookiesPanel({ result }: { result: HttpResponseData }) {
  if (result.cookies.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">這個回應沒有設定 Cookie。</p>
  }
  const columns = ['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure', 'SameSite']
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full text-xs select-text" data-testid="response-cookies">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {columns.map((c) => (
              <th key={c} className="py-1.5 pr-3 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.cookies.map((c, i) => (
            <tr key={`${c.name}-${i}`} className="border-b align-top last:border-b-0">
              <td className="py-1.5 pr-3 font-mono">{c.name}</td>
              <td className="max-w-64 py-1.5 pr-3 font-mono break-all">{c.value}</td>
              <td className="py-1.5 pr-3">{c.domain ?? '—'}</td>
              <td className="py-1.5 pr-3">{c.path ?? '—'}</td>
              <td className="py-1.5 pr-3">
                {c.expires ?? (c.maxAge !== undefined ? `Max-Age ${c.maxAge}` : 'Session')}
              </td>
              <td className="py-1.5 pr-3">{c.httpOnly ? '✓' : ''}</td>
              <td className="py-1.5 pr-3">{c.secure ? '✓' : ''}</td>
              <td className="py-1.5 pr-3">{c.sameSite ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Variables that had no value: they were sent as `{{name}}`. */
function UnresolvedNotice({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <p
      className="flex items-start gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
      data-testid="unresolved-variables"
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <span>
        找不到變數，已照原樣送出：
        <span className="font-mono">{names.map((n) => `{{${n}}}`).join('、')}</span>
      </span>
    </p>
  )
}

export function ResponseViewer({ tab }: { tab: RequestTab }) {
  const result: HttpResult | null = tab.result
  const running = tab.runId !== null
  const cancel = () => useTabsStore.getState().cancel(tab.key)

  if (running) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        發送中…
        <Button variant="outline" size="sm" onClick={() => void cancel()}>
          取消
        </Button>
      </div>
    )
  }
  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Send className="size-5" />
        按下「發送」查看回應
      </div>
    )
  }
  if (result.kind === 'error') {
    return (
      <div className="flex h-full flex-col" data-testid="response-error">
        <UnresolvedNotice names={result.unresolvedVariables} />
        <div className="flex min-h-0 shrink flex-col gap-2 overflow-auto p-4">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" />
            {ERROR_TITLES[result.code]}
          </p>
          <p className="font-mono text-xs break-all text-muted-foreground select-text">
            {result.message}
          </p>
          <p className="text-xs text-muted-foreground">
            {result.url} · {formatDuration(result.timings.totalMs)}
          </p>
          {result.tls && <TlsDiagnosisView diagnosis={result.tls} />}
        </div>
        {result.scriptReport && (
          <Tabs defaultValue="console" className="flex min-h-0 flex-1 flex-col border-t">
            <TabsList>
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="tests">Tests</TabsTrigger>
            </TabsList>
            <TabsContent value="console" className="min-h-0 flex-1">
              <ConsolePanel report={result.scriptReport} />
            </TabsContent>
            <TabsContent value="tests" className="min-h-0 flex-1">
              <TestsPanel report={result.scriptReport} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    )
  }
  const report = result.scriptReport
  const summary = testSummary(report)
  const logCount = (report?.preRequest?.logs.length ?? 0) + (report?.postResponse?.logs.length ?? 0)
  const scriptFailed = !!(report?.preRequest?.error || report?.postResponse?.error)

  return (
    <Tabs
      defaultValue="body"
      className="flex h-full min-h-0 flex-col"
      data-testid="response-viewer"
    >
      <div className="flex items-center gap-3 border-b pr-3">
        <TabsList className="border-b-0">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">Headers ({result.headers.length})</TabsTrigger>
          <TabsTrigger value="cookies">Cookies ({result.cookies.length})</TabsTrigger>
          {report && (
            <>
              <TabsTrigger value="tests" data-testid="tests-trigger">
                Tests
                {summary.total > 0 && (
                  <span
                    className={cn(
                      'rounded px-1 text-[10px] font-semibold',
                      summary.passed === summary.total && !scriptFailed
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-red-500/15 text-red-700 dark:text-red-400'
                    )}
                    data-testid="tests-summary"
                  >
                    {summary.passed}/{summary.total}
                  </span>
                )}
                {summary.total === 0 && scriptFailed && (
                  <AlertTriangle className="size-3.5 text-red-600 dark:text-red-400" />
                )}
              </TabsTrigger>
              <TabsTrigger value="console">Console {logCount > 0 && `(${logCount})`}</TabsTrigger>
            </>
          )}
        </TabsList>
        <div className="flex-1" />
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
            statusColor(result.status)
          )}
          data-testid="response-status"
        >
          {result.status} {result.statusText}
        </span>
        <span
          className="text-xs text-muted-foreground"
          title={`Headers ${formatDuration(result.timings.headersMs)}`}
        >
          {formatDuration(result.timings.totalMs)}
        </span>
        <span
          className="text-xs text-muted-foreground"
          title={`Body ${formatBytes(result.bodyBytes)} + Headers ${formatBytes(result.headerBytes)}`}
        >
          {formatBytes(result.bodyBytes + result.headerBytes)}
        </span>
        {result.redirects > 0 && (
          <span className="text-xs text-muted-foreground">重新導向 {result.redirects} 次</span>
        )}
        <SaveResultButton tab={tab} result={result} />
      </div>
      <UnresolvedNotice names={result.unresolvedVariables} />
      <TabsContent value="body" className="min-h-0 flex-1">
        <BodyPanel key={result.runId} result={result} tabKey={tab.key} />
      </TabsContent>
      <TabsContent value="headers" className="min-h-0 flex-1">
        <HeadersTable headers={result.headers} />
      </TabsContent>
      <TabsContent value="cookies" className="min-h-0 flex-1">
        <CookiesPanel result={result} />
      </TabsContent>
      {report && (
        <>
          <TabsContent value="tests" className="min-h-0 flex-1">
            <TestsPanel report={report} />
          </TabsContent>
          <TabsContent value="console" className="min-h-0 flex-1">
            <ConsolePanel report={report} />
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}
