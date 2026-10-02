import type { HttpHistoryEntry } from '@shared/schemas/history'

export interface HistoryGroup {
  label: string
  entries: HttpHistoryEntry[]
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Groups entries (newest first) by local day: 今天 / 昨天 / date. */
export function groupByDay(entries: readonly HttpHistoryEntry[], now: Date): HistoryGroup[] {
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const groups: HistoryGroup[] = []
  for (const entry of entries) {
    const date = new Date(entry.sentAt)
    const key = dayKey(date)
    const label =
      key === today
        ? '今天'
        : key === yesterday
          ? '昨天'
          : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    const last = groups.at(-1)
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}
