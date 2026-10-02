import { AlertTriangle, Check, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ScriptLog, ScriptReport, ScriptTestResult } from '@shared/scripts'
import { formatDuration } from '@shared/http'
import { cn } from '@renderer/lib/utils'

const SCOPE_LABEL = { runtime: '暫存變數', environment: '環境', collection: 'Collection' } as const
const BY_LABEL = {
  preRequest: 'Pre-request',
  postResponse: 'Post-response',
  extraction: '擷取'
} as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

function ResultLine({
  passed,
  label,
  detail,
  testId
}: {
  passed: boolean
  label: string
  detail?: string
  testId: string
}) {
  return (
    <li className="flex items-start gap-2 text-xs" data-testid={testId} data-passed={passed}>
      {passed ? (
        <Check className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <X className="mt-px size-3.5 shrink-0 text-red-600 dark:text-red-400" />
      )}
      <span className="min-w-0 break-all">
        <span className={cn(!passed && 'text-red-700 dark:text-red-400')}>{label}</span>
        {detail && <span className="ml-2 text-muted-foreground">{detail}</span>}
      </span>
    </li>
  )
}

function ScriptError({ phase, error }: { phase: string; error: string }) {
  return (
    <p
      className="flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-400"
      data-testid="script-error"
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <span className="break-all select-text">
        {phase} 腳本錯誤：{error}
      </span>
    </p>
  )
}

function testLines(tests: ScriptTestResult[], prefix: string) {
  return tests.map((t, i) => (
    <ResultLine
      key={`${prefix}-${i}`}
      testId="script-test"
      passed={t.passed}
      label={t.name}
      detail={t.error}
    />
  ))
}

/** Results of assertions, script tests, extractions and the variables they changed. */
export function TestsPanel({ report }: { report: ScriptReport }) {
  const scriptTests = [...(report.preRequest?.tests ?? []), ...(report.postResponse?.tests ?? [])]
  const nothing =
    report.assertions.length === 0 &&
    scriptTests.length === 0 &&
    report.extractions.length === 0 &&
    report.changes.length === 0 &&
    !report.preRequest?.error &&
    !report.postResponse?.error
  return (
    <div
      className="flex h-full flex-col gap-4 overflow-auto p-3 select-text"
      data-testid="tests-panel"
    >
      {report.scriptsSkipped && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="size-3.5" />
          這次沒有執行腳本（只執行擷取與斷言）。
        </p>
      )}
      {report.preRequest?.error && (
        <ScriptError phase="Pre-request" error={report.preRequest.error} />
      )}
      {report.postResponse?.error && (
        <ScriptError phase="Post-response" error={report.postResponse.error} />
      )}
      {report.assertions.length > 0 && (
        <Section title="斷言">
          <ul className="flex flex-col gap-1">
            {report.assertions.map((a) => (
              <ResultLine
                key={a.id}
                testId="assertion-result"
                passed={a.passed}
                label={a.label}
                detail={a.error ?? `實際值：${a.actual}`}
              />
            ))}
          </ul>
        </Section>
      )}
      {scriptTests.length > 0 && (
        <Section title="腳本測試">
          <ul className="flex flex-col gap-1">
            {testLines(report.preRequest?.tests ?? [], 'pre')}
            {testLines(report.postResponse?.tests ?? [], 'post')}
          </ul>
        </Section>
      )}
      {report.extractions.length > 0 && (
        <Section title="擷取">
          <ul className="flex flex-col gap-1">
            {report.extractions.map((e) => (
              <ResultLine
                key={e.id}
                testId="extraction-result"
                passed={e.error === undefined}
                label={`${e.variable}（${SCOPE_LABEL[e.scope]}）`}
                detail={e.error ?? `= ${e.value ?? ''}`}
              />
            ))}
          </ul>
        </Section>
      )}
      {(report.changes.length > 0 || report.changeErrors.length > 0) && (
        <Section title="變數變更">
          <ul className="flex flex-col gap-1 text-xs" data-testid="variable-changes">
            {report.changes.map((c, i) => (
              <li
                key={i}
                className={cn(
                  'flex gap-2 break-all',
                  c.scope !== 'runtime' && 'text-amber-700 dark:text-amber-400'
                )}
                data-scope={c.scope}
              >
                <span className="shrink-0 text-muted-foreground">
                  [{BY_LABEL[c.by]} → {SCOPE_LABEL[c.scope]}]
                </span>
                <span className="font-mono">
                  {c.value === null ? `刪除 ${c.name}` : `${c.name} = ${c.value}`}
                </span>
              </li>
            ))}
            {report.changeErrors.map((e, i) => (
              <li key={`err-${i}`} className="text-red-700 dark:text-red-400">
                {e}
              </li>
            ))}
          </ul>
          {report.changes.some((c) => c.scope !== 'runtime') && (
            <p className="text-xs text-muted-foreground">
              標成橘色的變更已寫入環境 / Collection 的檔案。
            </p>
          )}
        </Section>
      )}
      {nothing && <p className="text-sm text-muted-foreground">沒有斷言或測試結果。</p>}
    </div>
  )
}

const LEVEL_CLASS: Record<ScriptLog['level'], string> = {
  log: '',
  info: 'text-sky-700 dark:text-sky-400',
  warn: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-700 dark:text-red-400'
}

export function ConsolePanel({ report }: { report: ScriptReport }) {
  const phases = [
    ['Pre-request', report.preRequest],
    ['Post-response', report.postResponse]
  ] as const
  const ran = phases.filter(([, p]) => p !== null)
  if (ran.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">沒有執行腳本。</p>
  }
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3" data-testid="console-panel">
      {ran.map(([name, p]) => (
        <section key={name} className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            {name} · {formatDuration(p?.durationMs ?? 0)}
          </h4>
          {p && p.logs.length === 0 && !p.error && (
            <p className="text-xs text-muted-foreground">（沒有輸出）</p>
          )}
          <ul className="flex flex-col font-mono text-xs select-text">
            {p?.logs.map((l, i) => (
              <li
                key={i}
                className={cn(
                  'border-b py-0.5 break-all whitespace-pre-wrap last:border-b-0',
                  LEVEL_CLASS[l.level]
                )}
                data-testid="console-line"
              >
                {l.text}
              </li>
            ))}
            {p?.error && <li className={cn('py-0.5 break-all', LEVEL_CLASS.error)}>✖ {p.error}</li>}
          </ul>
        </section>
      ))}
    </div>
  )
}
