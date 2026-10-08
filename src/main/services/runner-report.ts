/**
 * Collection Runner HTML report (decision 130): one offline file (inline CSS and SVG,
 * no scripts) with the settings and totals, throughput / latency charts, per-request
 * statistics, status codes and the failed rows.
 */
import type { RunnerRow, RunnerRowDetail, RunnerStats, TimelinePoint } from '@shared/runner'

export interface RunnerResultData {
  hachi: 'runner-result'
  version: 1
  target: string
  environment: string | null
  startedAt: string
  durationMs: number
  status: string
  message: string | null
  settings: {
    iterations: number | null
    durationSec: number | null
    concurrency: number
    delayMs: number
    stopOnFailure: boolean
    keepBodies: boolean
    dataFile: string | null
    skipScripts: boolean
  }
  requests: { id: string; name: string; method: string; path: string }[]
  skipped: string[]
  stats: RunnerStats
  rows: (RunnerRow | RunnerRowDetail)[]
}

/** Failed rows listed in the report; the rest are only counted. */
export const REPORT_FAILED_ROWS = 1000
/** Chart columns; longer runs are grouped into buckets. */
const CHART_POINTS = 240

const STATUS_TEXT: Record<string, string> = {
  done: '完成',
  stopped: '已停止',
  cancelled: '已取消',
  error: '錯誤',
  running: '執行中'
}

export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )

const ms = (value: number) =>
  value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value).toLocaleString()} ms`
const pct = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`

function duration(totalMs: number): string {
  const s = Math.round(totalMs / 1000)
  if (s < 60) return `${(totalMs / 1000).toFixed(1)} 秒`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h} 小時 ${m} 分 ${s % 60} 秒` : `${m} 分 ${s % 60} 秒`
}

/** Groups seconds into at most CHART_POINTS buckets (sum of requests, max latency). */
export function bucketTimeline(timeline: readonly TimelinePoint[]): {
  seconds: number
  points: { start: number; requests: number; p50: number | null; p95: number | null }[]
} {
  const last = timeline.length === 0 ? 0 : (timeline[timeline.length - 1] as TimelinePoint).second
  const size = Math.max(1, Math.ceil((last + 1) / CHART_POINTS))
  const points = new Map<
    number,
    { start: number; requests: number; p50: number | null; p95: number | null }
  >()
  for (const t of timeline) {
    const start = Math.floor(t.second / size) * size
    const p = points.get(start) ?? { start, requests: 0, p50: null, p95: null }
    p.requests += t.requests
    if (t.p50 !== null) p.p50 = Math.max(p.p50 ?? 0, t.p50)
    if (t.p95 !== null) p.p95 = Math.max(p.p95 ?? 0, t.p95)
    points.set(start, p)
  }
  return { seconds: size, points: [...points.values()].sort((a, b) => a.start - b.start) }
}

const W = 720
const H = 180
const PAD = { left: 52, right: 12, top: 12, bottom: 24 }

function axis(maxY: number, label: (v: number) => string, lastX: number): string {
  const lines: string[] = []
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + ((H - PAD.top - PAD.bottom) * i) / 4
    const value = maxY * (1 - i / 4)
    lines.push(
      `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}" class="grid"/>`,
      `<text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(label(value))}</text>`
    )
  }
  lines.push(
    `<text x="${PAD.left}" y="${H - 6}">0 s</text>`,
    `<text x="${W - PAD.right}" y="${H - 6}" text-anchor="end">${lastX} s</text>`
  )
  return lines.join('')
}

function throughputChart(timeline: readonly TimelinePoint[]): string {
  const { seconds, points } = bucketTimeline(timeline)
  if (points.length === 0) return '<p class="muted">沒有資料</p>'
  const rate = points.map((p) => p.requests / seconds)
  const maxY = Math.max(1, ...rate) * 1.1
  const lastX = (points[points.length - 1]?.start ?? 0) + seconds
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const barW = Math.max(1, (plotW * seconds) / Math.max(lastX, 1) - 1)
  const bars = points
    .map((p, i) => {
      const h = ((rate[i] as number) / maxY) * plotH
      const x = PAD.left + (plotW * p.start) / Math.max(lastX, 1)
      return `<rect x="${x.toFixed(1)}" y="${(PAD.top + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" class="bar"><title>${p.start} s：${(rate[i] as number).toFixed(1)} 個/秒</title></rect>`
    })
    .join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每秒完成數">${axis(maxY, (v) => v.toFixed(v < 10 ? 1 : 0), lastX)}${bars}</svg>`
}

function latencyChart(timeline: readonly TimelinePoint[]): string {
  const { seconds, points } = bucketTimeline(timeline)
  const values = points.flatMap((p) => [p.p50, p.p95]).filter((v): v is number => v !== null)
  if (values.length === 0) return '<p class="muted">沒有資料</p>'
  const maxY = Math.max(1, ...values) * 1.1
  const lastX = (points[points.length - 1]?.start ?? 0) + seconds
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const line = (key: 'p50' | 'p95') =>
    points
      .filter((p) => p[key] !== null)
      .map((p, i) => {
        const x = PAD.left + (plotW * (p.start + seconds / 2)) / Math.max(lastX, 1)
        const y = PAD.top + plotH - ((p[key] as number) / maxY) * plotH
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="回應時間">${axis(maxY, (v) => ms(v), lastX)}<path d="${line('p95')}" class="line p95"/><path d="${line('p50')}" class="line p50"/></svg>
<p class="legend"><span class="key p50"></span>p50 <span class="key p95"></span>p95（每 ${seconds} 秒的最大值）</p>`
}

function statusBars(codes: Record<string, number>, total: number): string {
  const entries = Object.entries(codes).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return '<p class="muted">沒有資料</p>'
  return `<table class="bars">${entries
    .map(([code, count]) => {
      const share = total === 0 ? 0 : count / total
      const kind = /^2/.test(code) ? 'ok' : /^3/.test(code) ? 'info' : 'bad'
      return `<tr><th>${escapeHtml(code)}</th><td><div class="meter"><span class="${kind}" style="width:${(share * 100).toFixed(1)}%"></span></div></td><td class="num">${count.toLocaleString()}</td><td class="num muted">${pct(share)}</td></tr>`
    })
    .join('')}</table>`
}

function failureDetails(row: RunnerRow | RunnerRowDetail): string {
  const parts: string[] = []
  if (row.errorMessage) parts.push(row.errorMessage)
  if ('scriptReport' in row && row.scriptReport) {
    const r = row.scriptReport
    if (r.preRequest?.error) parts.push(`Pre-request：${r.preRequest.error}`)
    if (r.postResponse?.error) parts.push(`Post-response：${r.postResponse.error}`)
    for (const t of [...(r.preRequest?.tests ?? []), ...(r.postResponse?.tests ?? [])]) {
      if (!t.passed) parts.push(`✗ ${t.name}${t.error ? `：${t.error}` : ''}`)
    }
    for (const a of r.assertions) {
      if (!a.passed) parts.push(`✗ ${a.label}（實際：${a.actual}）${a.error ? `：${a.error}` : ''}`)
    }
  } else if (row.testsTotal > row.testsPassed) {
    parts.push(`${row.testsTotal - row.testsPassed} 個測試 / 斷言失敗（詳細內容沒有保留）`)
  }
  return parts.map((p) => `<div>${escapeHtml(p)}</div>`).join('')
}

export function buildRunnerReport(data: RunnerResultData): string {
  const { stats, settings } = data
  const total = stats.total
  const lat = total.latency
  const failed = data.rows.filter((r) => r.failed)
  const responded = Object.values(stats.statusCodes).reduce((a, b) => a + b, 0)
  const throughput = data.durationMs > 0 ? (total.count / data.durationMs) * 1000 : 0
  const end =
    settings.durationSec !== null
      ? `持續 ${settings.durationSec.toLocaleString()} 秒`
      : `每個 worker ${settings.iterations?.toLocaleString()} 輪`

  const card = (label: string, value: string, kind = '') =>
    `<div class="card ${kind}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`

  const statRows = [...stats.items, total]
    .map((s) => {
      const l = s.latency
      const cells = l
        ? [l.avg, l.min, l.p50, l.p90, l.p95, l.p99, l.max]
            .map((v) => `<td class="num">${ms(v)}</td>`)
            .join('')
        : '<td colspan="7" class="muted">沒有回應</td>'
      const name = s.itemId === '' ? '<strong>總計</strong>' : escapeHtml(s.name)
      return `<tr${s.itemId === '' ? ' class="total"' : ''}><th>${name}</th><td class="num">${s.count.toLocaleString()}</td><td class="num${s.failed > 0 ? ' bad' : ''}">${s.failed.toLocaleString()}</td><td class="num">${pct(s.errorRate)}</td><td class="num">${s.testsPassed}/${s.testsPassed + s.testsFailed}</td>${cells}</tr>`
    })
    .join('')

  const errorCodes = Object.entries(stats.errorCodes)
  const failedRows = failed
    .slice(0, REPORT_FAILED_ROWS)
    .map(
      (r) =>
        `<tr><td class="num">${r.index + 1}</td><td class="num">${r.round + 1}</td><td>${escapeHtml(r.name)}</td><td class="mono">${escapeHtml(r.method)} ${escapeHtml(r.url)}</td><td class="num">${r.status ?? escapeHtml(r.errorCode ?? '—')}</td><td class="num">${ms(r.timeMs)}</td><td class="detail">${failureDetails(r)}</td></tr>`
    )
    .join('')

  const info: [string, string][] = [
    ['Collection / 資料夾', data.target],
    ['環境', data.environment ?? '無'],
    ['開始時間', new Date(data.startedAt).toLocaleString()],
    ['總耗時', duration(data.durationMs)],
    ['結束條件', end],
    ['並行數', String(settings.concurrency)],
    ['請求間隔', `${settings.delayMs} ms`],
    ['資料檔', settings.dataFile ?? '無'],
    ['失敗時停止', settings.stopOnFailure ? '是' : '否'],
    ['腳本', settings.skipScripts ? '這次不執行' : '執行']
  ]

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Hachi">
<title>Runner 報告：${escapeHtml(data.target)}</title>
<style>
:root{--bg:#eceff4;--panel:#fff;--fg:#2e3440;--muted:#6b7385;--line:#d8dee9;--accent:#5e81ac;--ok:#a3be8c;--info:#88c0d0;--bad:#bf616a;--p95:#d08770}
@media (prefers-color-scheme:dark){:root{--bg:#242933;--panel:#2e3440;--fg:#e5e9f0;--muted:#a3abbc;--line:#434c5e;--accent:#88c0d0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
section,.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
.status{display:inline-block;padding:1px 8px;border-radius:4px;font-size:12px;font-weight:600;background:var(--line)}
.status.done{background:color-mix(in srgb,var(--ok) 30%,transparent)}.status.stopped,.status.error{background:color-mix(in srgb,var(--bad) 30%,transparent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.card .label{color:var(--muted);font-size:12px}.card .value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.card.bad .value{color:var(--bad)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
thead th{color:var(--muted);font-weight:500;white-space:nowrap}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.total th,tr.total td{font-weight:600}td.bad{color:var(--bad);font-weight:600}.detail div+div{margin-top:2px}
.scroll{overflow-x:auto}svg{width:100%;height:auto;display:block}svg text{font-size:11px;fill:var(--muted)}
svg .grid{stroke:var(--line);stroke-width:1}svg .bar{fill:var(--accent)}svg .line{fill:none;stroke-width:2}svg .p50{stroke:var(--accent)}svg .p95{stroke:var(--p95)}
.legend{margin:6px 0 0;color:var(--muted);font-size:12px}.key{display:inline-block;width:12px;height:3px;vertical-align:middle;margin:0 4px 0 10px}.key.p50{background:var(--accent)}.key.p95{background:var(--p95)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px}.charts h3{font-size:13px;margin:0 0 6px;color:var(--muted);font-weight:500}
.bars th{width:70px}.meter{background:var(--line);border-radius:3px;height:10px;overflow:hidden}.meter span{display:block;height:100%}.meter .ok{background:var(--ok)}.meter .info{background:var(--info)}.meter .bad{background:var(--bad)}
footer{margin-top:32px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<main>
<h1>Collection Runner：${escapeHtml(data.target)}</h1>
<div><span class="status ${escapeHtml(data.status)}">${escapeHtml(STATUS_TEXT[data.status] ?? data.status)}</span>${data.message ? ` <span class="muted">${escapeHtml(data.message)}</span>` : ''}</div>
<div class="cards">
${card('請求數', total.count.toLocaleString())}
${card('失敗', `${total.failed.toLocaleString()}（${pct(total.errorRate)}）`, total.failed > 0 ? 'bad' : '')}
${card('每秒完成', throughput.toFixed(throughput < 10 ? 2 : 1))}
${card('平均回應時間', lat ? ms(lat.avg) : '—')}
${card('p95', lat ? ms(lat.p95) : '—')}
${card('測試 / 斷言', `${total.testsPassed}/${total.testsPassed + total.testsFailed}`, total.testsFailed > 0 ? 'bad' : '')}
</div>

<h2>執行設定</h2>
<section><dl>${info.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
${data.skipped.length > 0 ? `<p class="muted">未執行：${data.skipped.map(escapeHtml).join('、')}</p>` : ''}</section>

<h2>圖表</h2>
<div class="charts">
<section><h3>每秒完成數</h3>${throughputChart(stats.timeline)}</section>
<section><h3>回應時間</h3>${latencyChart(stats.timeline)}</section>
</div>

<h2>每個請求的統計</h2>
<section class="scroll"><table>
<thead><tr><th>請求</th><th class="num">次數</th><th class="num">失敗</th><th class="num">錯誤率</th><th class="num">測試</th><th class="num">平均</th><th class="num">最小</th><th class="num">p50</th><th class="num">p90</th><th class="num">p95</th><th class="num">p99</th><th class="num">最大</th></tr></thead>
<tbody>${statRows}</tbody></table></section>

<h2>狀態碼分布</h2>
<section>${statusBars(stats.statusCodes, responded)}
${errorCodes.length > 0 ? `<p class="muted">沒有回應：${errorCodes.map(([c, n]) => `${escapeHtml(c)} × ${n.toLocaleString()}`).join('、')}</p>` : ''}</section>

<h2>失敗的請求（${failed.length.toLocaleString()}）</h2>
<section class="scroll">${
    failed.length === 0
      ? '<p class="muted">沒有失敗的請求。</p>'
      : `<table><thead><tr><th class="num">#</th><th class="num">輪</th><th>請求</th><th>網址</th><th class="num">狀態</th><th class="num">時間</th><th>原因</th></tr></thead><tbody>${failedRows}</tbody></table>${
          failed.length > REPORT_FAILED_ROWS
            ? `<p class="muted">只列出前 ${REPORT_FAILED_ROWS.toLocaleString()} 筆。</p>`
            : ''
        }`
  }</section>

<footer>由 Hachi 產生 · ${escapeHtml(new Date().toLocaleString())}</footer>
</main>
</body>
</html>
`
}
