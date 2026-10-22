import { Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  assertionOperatorLabel,
  assertionTargetLabel,
  extractionSourceLabel,
  UNARY_OPERATORS,
  VALUE_TYPES
} from '@shared/assertions'
import {
  ASSERTION_OPERATORS,
  ASSERTION_TARGETS,
  EXTRACTION_SOURCES,
  type Assertion,
  type Extraction,
  type RequestScripts
} from '@shared/schemas/http-request'
import { CodeEditor } from '@renderer/components/code-editor'
import { KV_CELL_CLASS } from '@renderer/components/key-value-table'
import { Button } from '@renderer/components/ui/button'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { VariableInput } from '@renderer/components/variable-input'
import { cn } from '@renderer/lib/utils'
import { ScriptDocsDialog } from './ScriptDocsDialog'
import { msg } from '@shared/i18n'

type Phase = 'preRequest' | 'postResponse'

const PHASES: { id: Phase; label: string }[] = [
  { id: 'preRequest', label: 'Pre-request' },
  { id: 'postResponse', label: 'Post-response' }
]

export function ScriptsTab({
  scripts,
  onChange,
  container = false,
  inheritedFrom = [],
  children
}: {
  scripts: RequestScripts
  onChange: (scripts: RequestScripts) => void
  /** Scripts of a collection / folder: they run for every request inside (decision 126). */
  container?: boolean
  /** Collections / folders above whose scripts run too. */
  inheritedFrom?: string[]
  /** Extra controls above the editor (the collection's script order). */
  children?: ReactNode
}) {
  const [docsOpen, setDocsOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>(
    scripts.preRequest.trim() === '' && scripts.postResponse.trim() !== ''
      ? 'postResponse'
      : 'preRequest'
  )
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3" data-testid="scripts-tab">
      <div className="flex items-center gap-3">
        <div
          className="flex rounded-md border p-0.5"
          role="radiogroup"
          aria-label={msg().scripts.editor.scripts}
        >
          {PHASES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={phase === p.id}
              onClick={() => setPhase(p.id)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2 py-0.5 text-xs',
                phase === p.id
                  ? 'bg-accent font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
              {scripts[p.id].trim() !== '' && <span className="size-1.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {container
            ? phase === 'preRequest'
              ? msg().scripts.editor.containerPre
              : msg().scripts.editor.containerPost
            : phase === 'preRequest'
              ? msg().scripts.editor.pre
              : msg().scripts.editor.post}
        </span>
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          data-testid="script-docs-open"
          onClick={() => setDocsOpen(true)}
        >
          {msg().scripts.editor.api}
        </button>
      </div>
      <ScriptDocsDialog open={docsOpen} onOpenChange={setDocsOpen} phase={phase} />
      {children}
      {inheritedFrom.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="inherited-scripts">
          {msg().scripts.editor.alsoRuns(inheritedFrom)}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border" data-testid="script-editor">
        <CodeEditor
          key={phase}
          aria-label={
            phase === 'preRequest' ? msg().scripts.editor.preLabel : msg().scripts.editor.postLabel
          }
          className="h-full"
          language="javascript"
          value={scripts[phase]}
          onChange={(value) => onChange({ ...scripts, [phase]: value })}
        />
      </div>
    </div>
  )
}

const newAssertion = (): Assertion => ({
  id: crypto.randomUUID(),
  enabled: true,
  target: 'status',
  path: '',
  operator: 'eq',
  expected: '200'
})

const newExtraction = (): Extraction => ({
  id: crypto.randomUUID(),
  enabled: true,
  source: 'jsonBody',
  path: '',
  variable: '',
  scope: 'runtime'
})

const SELECT = 'h-8 w-full border-0 bg-transparent px-1 text-xs shadow-none dark:bg-transparent'

function needsPath(target: Assertion['target']) {
  return target === 'header' || target === 'jsonBody'
}

function AssertionRow({
  row,
  onChange,
  onRemove
}: {
  row: Assertion
  onChange: (row: Assertion) => void
  onRemove: () => void
}) {
  const set = (patch: Partial<Assertion>) => onChange({ ...row, ...patch })
  const unary = UNARY_OPERATORS.includes(row.operator)
  return (
    <tr className="group border-b last:border-b-0" data-testid="assertion-row">
      <td className="w-8 border-r text-center">
        <input
          type="checkbox"
          aria-label={msg().scripts.editor.enabled}
          className="size-3.5 accent-primary"
          checked={row.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
      </td>
      <td className="w-32 border-r">
        <NativeSelect
          aria-label={msg().scripts.editor.target}
          className={SELECT}
          value={row.target}
          onChange={(e) => set({ target: e.target.value as Assertion['target'] })}
        >
          {ASSERTION_TARGETS.map((t) => (
            <option key={t} value={t}>
              {assertionTargetLabel(t)}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="border-r">
        <input
          aria-label={msg().scripts.editor.path}
          className={KV_CELL_CLASS}
          disabled={!needsPath(row.target)}
          placeholder={
            row.target === 'header'
              ? msg().scripts.editor.headerName
              : row.target === 'jsonBody'
                ? 'data.items[0].id'
                : ''
          }
          value={needsPath(row.target) ? row.path : ''}
          onChange={(e) => set({ path: e.target.value })}
        />
      </td>
      <td className="w-32 border-r">
        <NativeSelect
          aria-label={msg().scripts.editor.condition}
          className={SELECT}
          value={row.operator}
          onChange={(e) => set({ operator: e.target.value as Assertion['operator'] })}
        >
          {ASSERTION_OPERATORS.map((o) => (
            <option key={o} value={o}>
              {assertionOperatorLabel(o)}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="border-r">
        {row.operator === 'isType' ? (
          <NativeSelect
            aria-label={msg().scripts.editor.expected}
            className={SELECT}
            value={row.expected}
            onChange={(e) => set({ expected: e.target.value })}
          >
            {VALUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <VariableInput
            aria-label={msg().scripts.editor.expected}
            className="h-8"
            textClassName={cn(KV_CELL_CLASS, 'h-8')}
            disabled={unary}
            placeholder={unary ? '' : msg().scripts.editor.expectedPlaceholder}
            value={unary ? '' : row.expected}
            onChange={(e) => set({ expected: e.target.value })}
          />
        )}
      </td>
      <td className="w-8 text-center">
        <button
          type="button"
          aria-label={msg().scripts.editor.delete}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  )
}

function ExtractionRow({
  row,
  onChange,
  onRemove
}: {
  row: Extraction
  onChange: (row: Extraction) => void
  onRemove: () => void
}) {
  const set = (patch: Partial<Extraction>) => onChange({ ...row, ...patch })
  return (
    <tr className="group border-b last:border-b-0" data-testid="extraction-row">
      <td className="w-8 border-r text-center">
        <input
          type="checkbox"
          aria-label={msg().scripts.editor.enabled}
          className="size-3.5 accent-primary"
          checked={row.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
      </td>
      <td className="w-32 border-r">
        <NativeSelect
          aria-label={msg().scripts.editor.source}
          className={SELECT}
          value={row.source}
          onChange={(e) => set({ source: e.target.value as Extraction['source'] })}
        >
          {EXTRACTION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {extractionSourceLabel(s)}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="border-r">
        <input
          aria-label={msg().scripts.editor.path}
          className={KV_CELL_CLASS}
          disabled={row.source === 'status'}
          placeholder={
            row.source === 'jsonBody'
              ? msg().scripts.editor.jsonPathPlaceholder
              : row.source === 'header'
                ? msg().scripts.editor.headerName
                : row.source === 'body'
                  ? msg().scripts.editor.regexPlaceholder
                  : ''
          }
          value={row.source === 'status' ? '' : row.path}
          onChange={(e) => set({ path: e.target.value })}
        />
      </td>
      <td className="w-40 border-r">
        <input
          aria-label={msg().scripts.editor.variable}
          className={KV_CELL_CLASS}
          placeholder={msg().scripts.editor.variable}
          value={row.variable}
          onChange={(e) => set({ variable: e.target.value })}
        />
      </td>
      <td className="w-28 border-r">
        <NativeSelect
          aria-label={msg().scripts.editor.saveTo}
          className={SELECT}
          value={row.scope}
          onChange={(e) => set({ scope: e.target.value as Extraction['scope'] })}
        >
          <option value="runtime">{msg().scripts.editor.runtime}</option>
          <option value="environment">{msg().scripts.editor.environment}</option>
        </NativeSelect>
      </td>
      <td className="w-8 text-center">
        <button
          type="button"
          aria-label={msg().scripts.editor.delete}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  )
}

export function TestsTab({
  assertions,
  extractions,
  onChange
}: {
  assertions: Assertion[]
  extractions: Extraction[]
  onChange: (patch: { assertions?: Assertion[]; extractions?: Extraction[] }) => void
}) {
  return (
    <div className="flex flex-col gap-5 p-4" data-testid="tests-tab">
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{msg().scripts.editor.capturesTitle}</h3>
          <span className="text-xs text-muted-foreground">{msg().scripts.editor.capturesHint}</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ extractions: [...extractions, newExtraction()] })}
          >
            <Plus />
            {msg().scripts.editor.addCapture}
          </Button>
        </div>
        {extractions.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full table-fixed" data-testid="extractions-table">
              <tbody>
                {extractions.map((row) => (
                  <ExtractionRow
                    key={row.id}
                    row={row}
                    onChange={(next) =>
                      onChange({
                        extractions: extractions.map((r) => (r.id === row.id ? next : r))
                      })
                    }
                    onRemove={() =>
                      onChange({ extractions: extractions.filter((r) => r.id !== row.id) })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{msg().scripts.editor.assertionsTitle}</h3>
          <span className="text-xs text-muted-foreground">
            {msg().scripts.editor.assertionsHint} <code>data.items[0].id</code>
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ assertions: [...assertions, newAssertion()] })}
          >
            <Plus />
            {msg().scripts.editor.addAssertion}
          </Button>
        </div>
        {assertions.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full table-fixed" data-testid="assertions-table">
              <tbody>
                {assertions.map((row) => (
                  <AssertionRow
                    key={row.id}
                    row={row}
                    onChange={(next) =>
                      onChange({ assertions: assertions.map((r) => (r.id === row.id ? next : r)) })
                    }
                    onRemove={() =>
                      onChange({ assertions: assertions.filter((r) => r.id !== row.id) })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
