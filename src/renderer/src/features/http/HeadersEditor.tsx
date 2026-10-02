import { ArrowUpRight } from 'lucide-react'
import type { InheritedSettings } from '@shared/http'
import type { KeyValue } from '@shared/schemas/collection'
import { KeyValueTable } from '@renderer/components/key-value-table'
import { cn } from '@renderer/lib/utils'

/** Own headers (editable) plus the inherited ones (read-only, with their source). */
export function HeadersEditor({
  headers,
  onChange,
  inherited
}: {
  headers: KeyValue[]
  onChange: (headers: KeyValue[]) => void
  inherited: InheritedSettings
}) {
  const own = new Set(
    headers.filter((h) => h.enabled && h.key.trim()).map((h) => h.key.trim().toLowerCase())
  )
  return (
    <div className="flex flex-col gap-4 p-4">
      <KeyValueTable
        rows={headers}
        onChange={onChange}
        keyPlaceholder="Header"
        data-testid="headers-table"
      />
      {inherited.headers.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="inherited-headers">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUpRight className="size-3.5" />
            從上層繼承（唯讀，請到來源修改；同名的 Header 以這裡設定的為準）
          </p>
          <table className="w-full table-fixed overflow-hidden rounded-md border text-xs">
            <tbody>
              {inherited.headers.map((h) => {
                const overridden = own.has(h.key.trim().toLowerCase())
                return (
                  <tr key={`${h.sourceId}-${h.id}`} className="border-b last:border-b-0">
                    <td
                      className={cn(
                        'w-[35%] border-r px-2 py-1.5 font-mono',
                        overridden && 'line-through opacity-60'
                      )}
                    >
                      {h.key}
                    </td>
                    <td
                      className={cn(
                        'border-r px-2 py-1.5 font-mono break-all',
                        overridden && 'line-through opacity-60'
                      )}
                    >
                      {h.value}
                    </td>
                    <td className="w-40 px-2 py-1.5 text-muted-foreground">
                      {overridden ? '已被覆寫' : `來自 ${h.sourceName}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
