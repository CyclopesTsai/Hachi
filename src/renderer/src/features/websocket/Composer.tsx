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
import { msg } from '@shared/i18n'

const formatLabel = (format: WsMessageFormat): string =>
  format === 'text'
    ? 'Text'
    : format === 'json'
      ? 'JSON'
      : format === 'binary-hex'
        ? msg().ws.composer.binaryHex
        : msg().ws.composer.binaryBase64

const placeholderOf = (format: WsMessageFormat): string =>
  format === 'binary-hex'
    ? msg().ws.composer.hexPlaceholder
    : format === 'binary-base64'
      ? msg().ws.composer.base64Placeholder
      : ''

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
          aria-label={msg().ws.composer.format}
          className="h-7 text-xs"
          value={format}
          onChange={(e) =>
            tabs.updateComposer(tab.key, { format: e.target.value as WsMessageFormat, content })
          }
        >
          {WS_MESSAGE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {formatLabel(f)}
            </option>
          ))}
        </NativeSelect>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!open}
          title={msg().ws.composer.pingTitle}
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
          title={msg().ws.composer.saveTemplateTitle}
          onClick={() =>
            setTemplates([
              ...templates,
              {
                id: crypto.randomUUID(),
                name: msg().ws.composer.templateName(templates.length + 1),
                format,
                content
              }
            ])
          }
        >
          <BookmarkPlus />
          {msg().ws.composer.saveTemplate}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <CodeEditor
          aria-label={msg().ws.composer.content}
          data-testid="ws-message-editor"
          className="min-h-20 flex-1"
          language={format === 'json' ? 'json' : 'text'}
          wrap
          variables={variables}
          value={content}
          onChange={(text) => tabs.updateComposer(tab.key, { format, content: text })}
        />
        {placeholderOf(format) && content === '' && (
          <p className="text-[11px] text-muted-foreground">{placeholderOf(format)}</p>
        )}
        {json && (
          <p className="truncate text-[11px] text-amber-600">{msg().ws.composer.jsonError(json)}</p>
        )}
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
            title={open ? msg().ws.composer.sendTitle : msg().ws.composer.connectFirst}
          >
            <Send />
            {msg().ws.composer.send}
          </Button>
        </div>
      </div>
      <div className="max-h-[45%] shrink-0 overflow-auto border-t" data-testid="ws-templates">
        <p className="px-2 pt-1.5 text-[11px] font-semibold text-muted-foreground">
          {msg().ws.composer.templates(templates.length)}
        </p>
        {templates.length === 0 && (
          <p className="px-2 pb-2 text-[11px] text-muted-foreground">
            {msg().ws.composer.templatesEmpty}
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
                aria-label={msg().ws.composer.templateNameLabel}
                className="h-6 min-w-0 flex-1 border-transparent bg-transparent px-1 text-xs shadow-none"
                value={tpl.name}
                onChange={(e) =>
                  setTemplates(
                    templates.map((t, i) => (i === index ? { ...t, name: e.target.value } : t))
                  )
                }
              />
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {formatLabel(tpl.format)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={msg().ws.composer.sendTemplate(tpl.name)}
                title={msg().ws.composer.send}
                disabled={!open}
                onClick={() => send(tpl.format, tpl.content)}
              >
                <Send className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={msg().ws.composer.loadTemplate(tpl.name)}
                title={msg().ws.composer.loadTitle}
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
                aria-label={msg().ws.composer.deleteTemplate(tpl.name)}
                title={msg().ws.composer.delete}
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
