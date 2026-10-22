import { Lock } from 'lucide-react'
import { useState } from 'react'
import type { Variable } from '@shared/schemas/collection'
import { KV_CELL_CLASS, KeyValueTable } from '@renderer/components/key-value-table'
import { CheckboxLabel } from '@renderer/components/ui/native-select'
import { VariableInput } from '@renderer/components/variable-input'
import { newKeyValue } from '@renderer/lib/key-value'
import { cn } from '@renderer/lib/utils'
import { msg } from '@shared/i18n'

/**
 * Environment / Collection variables. Secret values are masked unless revealed and
 * are stored in `.hachi-secrets.json` instead of the committed file.
 */
export function VariablesTable({
  rows,
  onChange,
  'data-testid': testId
}: {
  rows: Variable[]
  onChange: (rows: Variable[]) => void
  'data-testid'?: string
}) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <KeyValueTable<Variable>
        rows={rows}
        onChange={onChange}
        data-testid={testId}
        createRow={(patch) => ({ ...newKeyValue(patch), secret: false, ...patch })}
        keyPlaceholder={msg().vars.table.name}
        valuePlaceholder={msg().vars.table.value}
        renderExtra={(row, update) => (
          <label
            className="flex h-8 cursor-default items-center justify-center gap-1 text-[11px] text-muted-foreground"
            title={msg().vars.table.secretTitle}
          >
            <input
              type="checkbox"
              aria-label={msg().vars.table.secret}
              className="size-3.5 accent-primary"
              checked={row.secret}
              onChange={(e) => update({ secret: e.target.checked })}
            />
            <Lock className={cn('size-3', row.secret && 'text-primary')} />
          </label>
        )}
        renderValue={(row, update) =>
          row.secret && !reveal ? (
            <input
              type="password"
              aria-label="Value"
              className={cn(KV_CELL_CLASS, !row.enabled && 'text-muted-foreground')}
              placeholder={msg().vars.table.secretValue}
              value={row.value}
              onChange={(e) => update({ value: e.target.value })}
            />
          ) : (
            <VariableInput
              aria-label="Value"
              textClassName={KV_CELL_CLASS}
              muted={!row.enabled}
              placeholder={msg().vars.table.value}
              value={row.value}
              onChange={(e) => update({ value: e.target.value })}
            />
          )
        }
      />
      <div className="flex items-center gap-4">
        <CheckboxLabel checked={reveal} onChange={(e) => setReveal(e.target.checked)}>
          {msg().vars.table.reveal}
        </CheckboxLabel>
        <span className="text-xs text-muted-foreground">
          {msg().vars.table.hintBefore} <Lock className="inline size-3" />{' '}
          {msg().vars.table.hintAfter}
        </span>
      </div>
    </div>
  )
}
