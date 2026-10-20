/** Badge colors of an HTTP status code (response area, saved results in the tree). */
export function statusColor(status: number): string {
  if (status >= 500) return 'bg-red-500/15 text-red-600 dark:text-red-400'
  if (status >= 400) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
  if (status >= 300) return 'bg-sky-500/15 text-sky-700 dark:text-sky-400'
  return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
}

/** Text color only (small labels). */
export function statusTextColor(status: number): string {
  if (status >= 500) return 'text-red-600 dark:text-red-400'
  if (status >= 400) return 'text-amber-700 dark:text-amber-400'
  if (status >= 300) return 'text-sky-700 dark:text-sky-400'
  return 'text-emerald-700 dark:text-emerald-400'
}
