import type { RequestNode } from '@shared/tree'
import { cn } from '@renderer/lib/utils'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-amber-600 dark:text-amber-400',
  PUT: 'text-sky-600 dark:text-sky-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-red-600 dark:text-red-400'
}

/** Short colored label in front of a request: the HTTP method, or "WS". */
export function RequestBadge({
  node,
  method,
  className
}: {
  node: Pick<RequestNode, 'requestType' | 'method'>
  /** Overrides the saved method (e.g. the unsaved method of an open tab). */
  method?: string
  className?: string
}) {
  const label = node.requestType === 'websocket' ? 'WS' : (method ?? node.method ?? 'GET')
  const color =
    node.requestType === 'websocket'
      ? 'text-teal-600 dark:text-teal-400'
      : (METHOD_COLORS[label] ?? 'text-muted-foreground')
  return (
    <span
      className={cn(
        'w-11 shrink-0 text-right font-mono text-[10px] font-semibold',
        color,
        className
      )}
    >
      {label === 'OPTIONS' ? 'OPT' : label === 'DELETE' ? 'DEL' : label}
    </span>
  )
}
