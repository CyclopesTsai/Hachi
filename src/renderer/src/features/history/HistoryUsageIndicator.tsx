import { cn } from '@renderer/lib/utils'
import { useHistoryStore } from '@renderer/stores/history-store'

const RADIUS = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Small ring chart: how much of the history limit (shared by all Workspaces) is used.
 * Clicking it opens the History panel.
 */
export function HistoryUsageIndicator() {
  const usage = useHistoryStore((s) => s.usage)
  if (!usage) return null
  const ratio = usage.max > 0 ? Math.min(usage.total / usage.max, 1) : 0
  const percent = Math.round(ratio * 100)
  const tone =
    ratio >= 1
      ? 'text-amber-600 dark:text-amber-400'
      : ratio >= 0.9
        ? 'text-amber-500'
        : 'text-primary'
  return (
    <button
      type="button"
      data-testid="history-usage"
      data-percent={percent}
      className="flex items-center gap-1.5 rounded-sm px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={[
        `歷史紀錄：${usage.total} / ${usage.max} 筆（所有 Workspace 共用）`,
        `目前 Workspace：${usage.workspace} 筆`,
        ratio >= 1 ? '已達上限：新的紀錄會取代最舊的紀錄' : null,
        '上限可在 App 設定調整；點一下開啟歷史紀錄'
      ]
        .filter(Boolean)
        .join('\n')}
      onClick={() => useHistoryStore.getState().setSidebarMode('history')}
    >
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r={RADIUS} fill="none" strokeWidth="2.5" className="stroke-border" />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          strokeWidth="2.5"
          stroke="currentColor"
          strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
          className={cn(tone)}
        />
      </svg>
      <span>歷史 {percent}%</span>
    </button>
  )
}
