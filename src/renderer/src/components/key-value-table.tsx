import { Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { KeyValue } from '@shared/schemas/collection'
import { VariableInput } from '@renderer/components/variable-input'
import { newKeyValue } from '@renderer/lib/key-value'
import { cn } from '@renderer/lib/utils'

export interface KeyValueTableProps<T extends KeyValue> {
  rows: T[]
  onChange?: (rows: T[]) => void
  /** Creates a row when the user types into the trailing blank row. */
  createRow?: (patch: Partial<T>) => T
  keyPlaceholder?: string
  valuePlaceholder?: string
  readOnly?: boolean
  /** Replaces the value cell (e.g. a file picker for form-data). */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => ReactNode
  /** Extra cell between key and value (e.g. form-data text / file type). */
  renderExtra?: (row: T, update: (patch: Partial<T>) => void) => ReactNode
  'data-testid'?: string
}

export const KV_CELL_CLASS =
  'h-8 w-full min-w-0 bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40 disabled:cursor-default'

/**
 * Editable table of key / value rows with enable checkboxes. A blank row is always
 * shown at the bottom; typing into it adds a real row (so blank rows never make the
 * document "dirty").
 */
export function KeyValueTable<T extends KeyValue>({
  rows,
  onChange,
  createRow = (patch) => newKeyValue(patch) as T,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  readOnly = false,
  renderValue,
  renderExtra,
  ...rest
}: KeyValueTableProps<T>) {
  // The blank row reserves the id its real row will get, so React keeps the same <input>
  // (and focus) when the first character turns it into a real row.
  const [blankId, setBlankId] = useState(() => crypto.randomUUID())
  const update = (id: string, patch: Partial<T>) =>
    onChange?.(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => onChange?.(rows.filter((r) => r.id !== id))
  const add = (patch: Partial<T>) => {
    onChange?.([...rows, createRow({ ...patch, id: blankId })])
    setBlankId(crypto.randomUUID())
  }

  const renderRow = (row: T | null) => {
    const isBlank = row === null
    const set = (patch: Partial<T>) => (isBlank ? add(patch) : update(row.id, patch))
    return (
      <tr key={row?.id ?? blankId} className="group border-b last:border-b-0" data-testid="kv-row">
        <td className="w-8 border-r text-center">
          {!isBlank && (
            <input
              type="checkbox"
              aria-label="啟用"
              className="size-3.5 accent-primary align-middle"
              checked={row.enabled}
              disabled={readOnly}
              onChange={(e) => set({ enabled: e.target.checked } as Partial<T>)}
            />
          )}
        </td>
        <td className="w-[35%] border-r">
          <VariableInput
            aria-label="Key"
            className={cn(!isBlank && !row.enabled && 'line-through')}
            textClassName={KV_CELL_CLASS}
            muted={!isBlank && !row.enabled}
            placeholder={keyPlaceholder}
            value={row?.key ?? ''}
            disabled={readOnly}
            onChange={(e) => set({ key: e.target.value } as Partial<T>)}
          />
        </td>
        {renderExtra && <td className="w-20 border-r">{row && renderExtra(row, set)}</td>}
        <td className="border-r">
          {row && renderValue ? (
            renderValue(row, set)
          ) : (
            <VariableInput
              aria-label="Value"
              textClassName={KV_CELL_CLASS}
              muted={!isBlank && !row.enabled}
              placeholder={valuePlaceholder}
              value={row?.value ?? ''}
              disabled={readOnly}
              onChange={(e) => set({ value: e.target.value } as Partial<T>)}
            />
          )}
        </td>
        <td className="w-8 text-center">
          {!isBlank && !readOnly && (
            <button
              type="button"
              aria-label="刪除此列"
              className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
              onClick={() => remove(row.id)}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border" data-testid={rest['data-testid']}>
      <table className="w-full table-fixed border-collapse">
        <tbody>
          {rows.map((r) => renderRow(r))}
          {!readOnly && renderRow(null)}
        </tbody>
      </table>
    </div>
  )
}
