import { AlertTriangle, BookmarkPlus, FileInput, Radar, Send, Trash2 } from 'lucide-react'
import { WS_MESSAGE_FORMATS, type WsMessageFormat } from '@shared/schemas/ws-request'
import { VARIABLE_PATTERN } from '@shared/variables'
import { CodeEditor } from '@renderer/components/code-editor'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { NativeSelect } from '@renderer/components/ui/native-select'
import type { WsTab } from '@renderer/features/tabs/tab-model'
import { useVariables } from '@renderer/lib/variables'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useWsStore, type WsContext } from '@renderer/stores/ws-store'

const FORMAT_LABELS: Record<WsMessageFormat, string> = {
  text: 'Text',
  json: 'JSON',
  'binary-hex': 'Binary（Hex）',
  'binary-base64': 'Binary（Base64）'
}

const PLACEHOLDERS: Record<WsMessageFormat, string> = {
  text: '',
  json: '',
  'binary-hex': '例如 01 02 ff',
  'binary-base64': '例如 AQL/'
}

function jsonError(text: string): string | null {
  if (text.trim() === '') return null
  try {
    // `{{variables}}` may stand for numbers / objects.
    JSON.parse(text.replace(VARIABLE_PATTERN, '0'))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Message editor, ping, and the request's message templates. */
export function Composer({
  tab,
  open,
  context
}: {
  tab: WsTab
  /** The connection is open (sending is possible). */
  open: boolean
  context: () => WsContext
}) {
  const tabs = useTabsStore.getState()
  const ws = useWsStore.getState()
  const variables = useVariables()
  const error = useWsStore((s) => s.sessions[tab.uid]?.error ?? null)
  const { format, content } = tab.composer
  const templates = tab.draft?.messageTemplates ?? []
  const json = format === 'json' ? jsonError(content) : null

  const send = (f: WsMessageFormat, text: string) =>
    void ws.send(tab.uid, { ...context(), format: f, content: text })

  const setTemplates = (next: typeof templates) =>
    tabs.updateWs(tab.key, (d) => ({ ...d, messageTemplates: next }))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ws-composer">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <NativeSelect
          aria-label="訊息格式"
          className="h-7 text-xs"
          value={format}
          onChange={(e) =>
            tabs.updateComposer(tab.key, { format: e.target.value as WsMessageFormat, content })
          }
        >
          {WS_MESSAGE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </NativeSelect>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!open}
          title="送出 WebSocket Ping，收到 Pong 時顯示延遲"
          onClick={() => void ws.ping(tab.uid)}
        >
          <Radar />
          Ping
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={content.trim() === ''}
          title="把目前的內容存成範本（存在請求檔中，需要儲存）"
          onClick={() =>
            setTemplates([
              ...templates,
              {
                id: crypto.randomUUID(),
                name: `範本 ${templates.length + 1}`,
                format,
                content
              }
            ])
          }
        >
          <BookmarkPlus />
          存成範本
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <CodeEditor
          aria-label="訊息內容"
          data-testid="ws-message-editor"
          className="min-h-20 flex-1"
          language={format === 'json' ? 'json' : 'text'}
          wrap
          variables={variables}
          value={content}
          onChange={(text) => tabs.updateComposer(tab.key, { format, content: text })}
        />
        {PLACEHOLDERS[format] && content === '' && (
          <p className="text-[11px] text-muted-foreground">{PLACEHOLDERS[format]}</p>
        )}
        {json && <p className="truncate text-[11px] text-amber-600">JSON 格式有誤：{json}</p>}
        {error && (
          <p className="flex items-center gap-1 text-[11px] text-destructive" role="alert">
            <AlertTriangle className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!open || content === ''}
            onClick={() => send(format, content)}
            title={open ? '送出（{{變數}} 會在送出時替換）' : '請先連線'}
          >
            <Send />
            送出
          </Button>
        </div>
      </div>
      <div className="max-h-[45%] shrink-0 overflow-auto border-t" data-testid="ws-templates">
        <p className="px-2 pt-1.5 text-[11px] font-semibold text-muted-foreground">
          訊息範本（{templates.length}）
        </p>
        {templates.length === 0 && (
          <p className="px-2 pb-2 text-[11px] text-muted-foreground">
            把常用的訊息存成範本，之後一鍵送出。範本存在請求檔裡，機密內容請用 {'{{變數}}'}。
          </p>
        )}
        <ul className="px-1 pb-1">
          {templates.map((tpl, index) => (
            <li
              key={tpl.id}
              className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/50"
              data-testid="ws-template"
            >
              <Input
                aria-label="範本名稱"
                className="h-6 min-w-0 flex-1 border-transparent bg-transparent px-1 text-xs shadow-none"
                value={tpl.name}
                onChange={(e) =>
                  setTemplates(
                    templates.map((t, i) => (i === index ? { ...t, name: e.target.value } : t))
                  )
                }
              />
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {FORMAT_LABELS[tpl.format]}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`送出範本 ${tpl.name}`}
                title="送出"
                disabled={!open}
                onClick={() => send(tpl.format, tpl.content)}
              >
                <Send className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`載入範本 ${tpl.name}`}
                title="載入到編輯區"
                onClick={() =>
                  tabs.updateComposer(tab.key, { format: tpl.format, content: tpl.content })
                }
              >
                <FileInput className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 hover:text-destructive"
                aria-label={`刪除範本 ${tpl.name}`}
                title="刪除"
                onClick={() => setTemplates(templates.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
