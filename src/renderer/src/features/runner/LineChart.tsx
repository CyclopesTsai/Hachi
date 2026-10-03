import { useEffect, useRef, useState } from 'react'

export interface ChartSeries {
  name: string
  /** CSS color (a theme token such as var(--chart-1)). */
  color: string
  /** One value per x; null = no data for that second (the line breaks). */
  values: (number | null)[]
}

const HEIGHT = 140
const PAD = { top: 10, right: 44, bottom: 20, left: 44 }

function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exp >= value) return step * exp
  return 10 * exp
}

const formatValue = (v: number) =>
  v >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 10) / 10)

/**
 * Small single-axis line chart (dataviz rules: one y-scale, 2px lines, recessive grid,
 * legend + direct labels for 2 series, crosshair tooltip on hover). x = seconds.
 */
export function LineChart({
  title,
  unit,
  seconds,
  series,
  'data-testid': testId
}: {
  title: string
  unit: string
  seconds: number[]
  series: ChartSeries[]
  'data-testid'?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.floor(entry.contentRect.width)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const n = seconds.length
  const max = niceMax(
    Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)))
  )
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH

  const path = (values: (number | null)[]) => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    setHover(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))))
  }

  const lastIndex = (values: (number | null)[]) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i
    return -1
  }

  return (
    <figure className="flex flex-col gap-1" data-testid={testId}>
      <figcaption className="flex items-center gap-3 text-xs">
        <span className="font-medium">{title}</span>
        {series.length > 1 &&
          series.map((s) => (
            <span key={s.name} className="flex items-center gap-1 text-muted-foreground">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
      </figcaption>
      <div ref={box} className="relative">
        <svg width={width} height={HEIGHT} role="img" aria-label={title} className="block">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(max * t)}
                y2={y(max * t)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(max * t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {formatValue(max * t)}
              </text>
            </g>
          ))}
          {n > 0 && (
            <>
              <text
                x={x(0)}
                y={HEIGHT - 4}
                textAnchor="start"
                className="fill-muted-foreground text-[10px]"
              >
                {seconds[0]}s
              </text>
              {n > 1 && (
                <text
                  x={x(n - 1)}
                  y={HEIGHT - 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {seconds[n - 1]}s
                </text>
              )}
            </>
          )}
          {series.map((s) => (
            <path
              key={s.name}
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* Single points (a line needs two) are shown as markers. */}
          {series.map((s) =>
            s.values.map((v, i) =>
              v !== null &&
              (s.values[i - 1] ?? null) === null &&
              (s.values[i + 1] ?? null) === null ? (
                <circle key={`${s.name}-${i}`} cx={x(i)} cy={y(v)} r={4} fill={s.color} />
              ) : null
            )
          )}
          {/* Direct labels at the end of each line (2 series). */}
          {series.length > 1 &&
            series.map((s) => {
              const i = lastIndex(s.values)
              if (i < 0) return null
              return (
                <text
                  key={s.name}
                  x={x(i) + 6}
                  y={y(s.values[i] as number)}
                  dy="0.32em"
                  className="fill-muted-foreground text-[10px]"
                >
                  {s.name}
                </text>
              )
            })}
          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {series.map((s) => {
                const v = s.values[hover]
                return v === null || v === undefined ? null : (
                  <circle
                    key={s.name}
                    cx={x(hover)}
                    cy={y(v)}
                    r={4}
                    fill={s.color}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                )
              })}
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={Math.max(0, plotW)}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
            style={{
              left: Math.min(x(hover) + 8, width - 140),
              background: 'var(--background)'
            }}
          >
            <div className="text-muted-foreground">第 {seconds[hover]} 秒</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span>{s.name}</span>
                <span className="ml-auto pl-3 font-mono">
                  {s.values[hover] === null || s.values[hover] === undefined
                    ? '—'
                    : `${formatValue(s.values[hover] as number)} ${unit}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
