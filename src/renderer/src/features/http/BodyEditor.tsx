import { FileUp, Wand2 } from 'lucide-react'
import {
  BODY_MODES,
  RAW_CONTENT_TYPES,
  type BodyMode,
  type FormDataField,
  type HttpBody
} from '@shared/schemas/http-request'
import { CodeEditor, type CodeLanguage } from '@renderer/components/code-editor'
import { KeyValueTable } from '@renderer/components/key-value-table'
import { useWrapPreference } from '@renderer/hooks/use-wrap-preference'
import { newKeyValue } from '@renderer/lib/key-value'
import { Button } from '@renderer/components/ui/button'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { unwrap } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'

const MODE_LABELS: Record<BodyMode, string> = {
  none: 'none',
  json: 'JSON',
  raw: 'Raw',
  formData: 'Form-data',
  urlencoded: 'x-www-form-urlencoded'
}

function rawLanguage(contentType: string): CodeLanguage {
  if (/json/i.test(contentType)) return 'json'
  if (/html/i.test(contentType)) return 'html'
  if (/xml/i.test(contentType)) return 'xml'
  return 'text'
}

function jsonError(text: string): string | null {
  if (text.trim() === '') return null
  try {
    JSON.parse(text)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function FormDataValue({
  field,
  update
}: {
  field: FormDataField
  update: (patch: Partial<FormDataField>) => void
}) {
  if (field.type === 'text') {
    return (
      <input
        aria-label="Value"
        className="h-8 w-full min-w-0 bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40"
        placeholder="Value"
        value={field.value}
        spellCheck={false}
        onChange={(e) => update({ value: e.target.value })}
      />
    )
  }
  return (
    <div className="flex h-8 items-center gap-2 px-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={async () => {
          const file = await unwrap(window.hachi.dialog.selectFile({ title: '選擇要上傳的檔案' }))
          if (file) update({ filePath: file })
        }}
      >
        <FileUp />
        選擇檔案
      </Button>
      <span
        className="min-w-0 truncate font-mono text-xs text-muted-foreground"
        title={field.filePath}
      >
        {field.filePath || '尚未選擇'}
      </span>
    </div>
  )
}

export function BodyEditor({
  body,
  onChange
}: {
  body: HttpBody
  onChange: (body: HttpBody) => void
}) {
  const [wrap, setWrap] = useWrapPreference('requestBodyWrap')
  const set = (patch: Partial<HttpBody>) => onChange({ ...body, ...patch })
  const error = body.mode === 'json' ? jsonError(body.json) : null
  const hasFileField = body.formData.some((f) => f.type === 'file')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="body-editor">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        role="radiogroup"
        aria-label="Body 類型"
      >
        {BODY_MODES.map((mode) => (
          <label key={mode} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="body-mode"
              className="accent-primary"
              checked={body.mode === mode}
              onChange={() => set({ mode })}
            />
            {MODE_LABELS[mode]}
          </label>
        ))}
      </div>

      {(body.mode === 'json' || body.mode === 'raw') && (
        <div className="flex items-center gap-3">
          {body.mode === 'raw' && (
            <>
              <input
                aria-label="Content-Type"
                list="raw-content-types"
                className="h-8 w-56 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
                value={body.rawContentType}
                onChange={(e) => set({ rawContentType: e.target.value })}
              />
              <datalist id="raw-content-types">
                {RAW_CONTENT_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </>
          )}
          {body.mode === 'json' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={error !== null || body.json.trim() === ''}
              onClick={() => set({ json: JSON.stringify(JSON.parse(body.json), null, 2) })}
            >
              <Wand2 />
              格式化
            </Button>
          )}
          <div className="flex-1" />
          {error && (
            <span className="truncate text-xs text-destructive" title={error}>
              JSON 格式錯誤：{error}
            </span>
          )}
          <CheckboxLabel checked={wrap} onChange={(e) => setWrap(e.target.checked)}>
            自動換行
          </CheckboxLabel>
        </div>
      )}

      {body.mode === 'none' && <p className="text-sm text-muted-foreground">這個請求不帶 Body。</p>}

      {body.mode === 'json' && (
        <CodeEditor
          aria-label="JSON Body"
          data-testid="body-json"
          className="flex-1"
          language="json"
          wrap={wrap}
          value={body.json}
          onChange={(json) => set({ json })}
        />
      )}

      {body.mode === 'raw' && (
        <CodeEditor
          aria-label="Raw Body"
          className="flex-1"
          language={rawLanguage(body.rawContentType)}
          wrap={wrap}
          value={body.raw}
          onChange={(raw) => set({ raw })}
        />
      )}

      {body.mode === 'urlencoded' && (
        <KeyValueTable rows={body.urlencoded} onChange={(urlencoded) => set({ urlencoded })} />
      )}

      {body.mode === 'formData' && (
        <>
          <KeyValueTable<FormDataField>
            rows={body.formData}
            onChange={(formData) => set({ formData })}
            createRow={(patch) =>
              ({ ...newKeyValue(), type: 'text', filePath: '', ...patch }) as FormDataField
            }
            renderExtra={(field, update) => (
              <NativeSelect
                aria-label="欄位類型"
                className={cn('h-8 w-full rounded-none border-0 shadow-none')}
                value={field.type}
                onChange={(e) => update({ type: e.target.value as 'text' | 'file' })}
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </NativeSelect>
            )}
            renderValue={(field, update) => <FormDataValue field={field} update={update} />}
          />
          {hasFileField && (
            <p className="text-xs text-muted-foreground">
              檔案欄位會儲存檔案的完整路徑；在其他電腦上開啟這個 Workspace 時，該路徑不一定存在。
            </p>
          )}
        </>
      )}
    </div>
  )
}
