import { Lock } from 'lucide-react'
import { useState } from 'react'
import type { Variable } from '@shared/schemas/collection'
import { KV_CELL_CLASS, KeyValueTable } from '@renderer/components/key-value-table'
import { CheckboxLabel } from '@renderer/components/ui/native-select'
import { VariableInput } from '@renderer/components/variable-input'
import { newKeyValue } from '@renderer/lib/key-value'
import { cn } from '@renderer/lib/utils'

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
        keyPlaceholder="變數名稱"
        valuePlaceholder="值"
        renderExtra={(row, update) => (
          <label
            className="flex h-8 cursor-default items-center justify-center gap-1 text-[11px] text-muted-foreground"
            title="機密變數：值只存在這台電腦的 .hachi-secrets.json，不會寫進可提交的檔案"
          >
            <input
              type="checkbox"
              aria-label="機密"
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
              placeholder="機密值"
              value={row.value}
              onChange={(e) => update({ value: e.target.value })}
            />
          ) : (
            <VariableInput
              aria-label="Value"
              textClassName={KV_CELL_CLASS}
              muted={!row.enabled}
              placeholder="值"
              value={row.value}
              onChange={(e) => update({ value: e.target.value })}
            />
          )
        }
      />
      <div className="flex items-center gap-4">
        <CheckboxLabel checked={reveal} onChange={(e) => setReveal(e.target.checked)}>
          顯示機密值
        </CheckboxLabel>
        <span className="text-xs text-muted-foreground">
          勾選 <Lock className="inline size-3" /> 的變數為機密：值只存在這台電腦，不會被提交到 git。
        </span>
      </div>
    </div>
  )
}
