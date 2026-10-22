import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { CodeEditor, type CodeLanguage } from '@renderer/components/code-editor'
import { Button } from '@renderer/components/ui/button'
import { CheckboxLabel } from '@renderer/components/ui/native-select'
import { useWrapPreference } from '@renderer/hooks/use-wrap-preference'
import { cn } from '@renderer/lib/utils'
import { JsonTree } from './JsonTree'
import { ALL_COLLAPSED, ALL_EXPANDED, type TreeExpansion } from './json-tree-expansion'
import { msg } from '@shared/i18n'

function languageFor(contentType: string): CodeLanguage {
  if (/json/i.test(contentType)) return 'json'
  if (/html/i.test(contentType)) return 'html'
  if (/xml/i.test(contentType)) return 'xml'
  return 'text'
}

/** The parsed body when it is JSON, whatever the Content-Type says. */
function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return null
  }
}

type BodyView = 'pretty' | 'raw' | 'tree' | 'preview'

const VIEW_LABEL: Record<BodyView, string> = {
  pretty: 'Pretty',
  raw: 'Raw',
  tree: 'Tree',
  preview: 'Preview'
}

/**
 * A response body (the response area, saved results): Pretty / Raw / Tree (JSON,
 * decision 136) / Preview (HTML). `text` null shows `children` instead (empty, binary,
 * large bodies); `actions` go at the right of the toolbar.
 */
export function ResponseBody({
  text,
  contentType,
  actions,
  children
}: {
  text: string | null
  contentType: string
  actions?: ReactNode
  children?: ReactNode
}) {
  const [wrap, setWrap] = useWrapPreference('responseBodyWrap')
  // Every response starts in Pretty (decision 136).
  const [view, setView] = useState<BodyView>('pretty')
  const [expansion, setExpansion] = useState<TreeExpansion>(ALL_EXPANDED)

  const isHtml = /html/i.test(contentType)
  const parsed = useMemo(() => (text !== null ? parseJson(text) : null), [text])
  const isTree = parsed !== null && parsed.value !== null && typeof parsed.value === 'object'
  const pretty = useMemo(
    () => (parsed !== null && view === 'pretty' ? JSON.stringify(parsed.value, null, 2) : null),
    [parsed, view]
  )
  const views: BodyView[] = [
    'pretty',
    'raw',
    ...(isTree ? ['tree' as const] : []),
    ...(isHtml ? ['preview' as const] : [])
  ]
  const toggleNode = (path: string) =>
    setExpansion((e) => {
      const toggled = new Set(e.toggled)
      if (!toggled.delete(path)) toggled.add(path)
      return { base: e.base, toggled }
    })
  const shown = view === 'pretty' && pretty !== null ? pretty : (text ?? '')
  const language: CodeLanguage =
    view === 'raw' ? 'text' : pretty !== null ? 'json' : languageFor(contentType)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        {text !== null && (
          <div
            className="flex rounded-md border p-0.5"
            role="radiogroup"
            aria-label={msg().http.response.view}
          >
            {views.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  view === v
                    ? 'bg-accent font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {text !== null && view === 'tree' && (
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid="json-expand-all"
              onClick={() => setExpansion(ALL_EXPANDED)}
            >
              <ChevronsUpDown />
              {msg().http.response.expandAll}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="json-collapse-all"
              onClick={() => setExpansion(ALL_COLLAPSED)}
            >
              <ChevronsDownUp />
              {msg().http.response.collapseAll}
            </Button>
          </>
        )}
        {text !== null && view !== 'preview' && (
          <CheckboxLabel checked={wrap} onChange={(e) => setWrap(e.target.checked)}>
            {msg().http.response.wrap}
          </CheckboxLabel>
        )}
        {actions}
      </div>

      {text === null ? (
        children
      ) : view === 'preview' ? (
        // No scripts, no same-origin access; the app's CSP also blocks external resources.
        <iframe
          title={msg().http.response.htmlPreview}
          sandbox=""
          srcDoc={text}
          className="min-h-0 flex-1 rounded-md border bg-white"
          data-testid="html-preview"
        />
      ) : view === 'tree' && parsed !== null ? (
        <JsonTree value={parsed.value} expansion={expansion} onToggle={toggleNode} wrap={wrap} />
      ) : (
        <CodeEditor
          aria-label="Response Body"
          data-testid="response-body"
          className="flex-1"
          readOnly
          wrap={wrap}
          language={language}
          value={shown}
        />
      )}
    </div>
  )
}

/** Header rows of a response (or of a saved request). */
export function HeadersTable({
  headers,
  testId = 'response-headers'
}: {
  headers: readonly [string, string][]
  testId?: string
}) {
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full table-fixed text-xs select-text" data-testid={testId}>
        <tbody>
          {headers.map(([k, v], i) => (
            <tr key={`${k}-${i}`} className="border-b align-top last:border-b-0">
              <td className="w-[30%] py-1.5 pr-3 font-mono font-medium break-all">{k}</td>
              <td className="py-1.5 font-mono break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
