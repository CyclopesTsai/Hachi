import { AlertTriangle, Lightbulb, Loader2, RotateCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TlsCheckItem, TlsCheckResult, TlsTrustResult } from '@shared/http'
import type { HttpCheckTlsInput } from '@shared/ipc/api'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { Badge, TlsDiagnosisView } from './TlsDiagnosisView'

const TRUST_BADGE: Record<TlsTrustResult['status'], [string, 'ok' | 'bad' | 'muted']> = {
  pass: ['信任', 'ok'],
  fail: ['不信任', 'bad'],
  unsupported: ['不適用', 'muted'],
  error: ['無法檢查', 'muted']
}

const CHECK_BADGE: Record<TlsCheckItem['status'], [string, 'ok' | 'bad' | 'warn' | 'muted']> = {
  pass: ['通過', 'ok'],
  warn: ['注意', 'warn'],
  fail: ['不符', 'bad'],
  info: ['說明', 'muted']
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function TrustTable({ rows }: { rows: TlsTrustResult[] }) {
  return (
    <div className="divide-y rounded-md border" data-testid="tls-trust">
      {rows.map((row) => {
        const [text, tone] = TRUST_BADGE[row.status]
        return (
          <div
            key={row.source}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-3 py-2 text-xs"
            data-testid="tls-trust-row"
            data-source={row.source}
            data-status={row.status}
          >
            <div className="pt-px">
              <Badge tone={tone}>{text}</Badge>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p>
                <span className="font-medium">{row.label}</span>
                <span className="text-muted-foreground"> · {row.clients}</span>
              </p>
              {row.reasons.map((reason) => (
                <p
                  key={reason}
                  className={cn(
                    'break-words select-text',
                    row.status === 'fail' ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {reason}
                </p>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CheckList({ items }: { items: TlsCheckItem[] }) {
  return (
    <div className="divide-y rounded-md border" data-testid="tls-checks">
      {items.map((item) => {
        const [text, tone] = CHECK_BADGE[item.status]
        return (
          <div
            key={item.id}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-3 py-2 text-xs"
            data-testid="tls-check-item"
            data-id={item.id}
            data-status={item.status}
          >
            <div className="pt-px">
              <Badge tone={tone}>{text}</Badge>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-medium">{item.label}</p>
              <p className="break-words text-muted-foreground select-text">{item.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Result({ result }: { result: TlsCheckResult }) {
  const d = result.diagnosis
  return (
    <div className="flex flex-col gap-4">
      {result.unresolvedVariables.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          找不到的變數：{result.unresolvedVariables.map((n) => `{{${n}}}`).join('、')}
        </p>
      )}
      {result.trust.length > 0 && (
        <Section title="各平台是否信任">
          <TrustTable rows={result.trust} />
        </Section>
      )}
      {result.advice.length > 0 && (
        <Section title="建議">
          <ul
            className="flex flex-col gap-1.5 rounded-md border bg-muted p-3 text-xs"
            data-testid="tls-advice"
          >
            {result.advice.map((a) => (
              <li key={a} className="flex gap-1.5 select-text">
                <Lightbulb className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {result.checks.length > 0 && (
        <Section title="其他檢查">
          <CheckList items={result.checks} />
        </Section>
      )}
      <TlsDiagnosisView
        diagnosis={d}
        title={
          d.verdict === 'unavailable'
            ? d.summary
            : d.verdict === 'ok'
              ? '憑證鏈'
              : `憑證鏈（Hachi：${d.summary}）`
        }
      />
    </div>
  )
}

function CheckView({ input }: { input: HttpCheckTlsInput }) {
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<TlsCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = result === null && error === null

  useEffect(() => {
    let cancelled = false
    unwrap(window.hachi.http.checkTls(input))
      .then((r) => !cancelled && setResult(r))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [input, run])

  const again = () => {
    setResult(null)
    setError(null)
    setRun((n) => n + 1)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>憑證檢查</DialogTitle>
        <DialogDescription className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {result ? `${result.host}:${result.port} · ` : ''}
            只讀取伺服器送出的憑證，不會修改任何信任設定
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={again}
            data-testid="tls-check-again"
          >
            <RotateCw />
            重新檢查
          </Button>
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading && (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            檢查中…（會連線幾次並請作業系統驗證，可能需要十幾秒）
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && <Result result={result} />}
      </div>
    </>
  )
}

/**
 * The certificate check (decision 142): which platforms trust the server's chain, plus
 * TLS versions, OCSP, SCTs and Apple's rules. Works whether or not the request succeeds.
 */
export function TlsCheckButton({
  input,
  label = '憑證',
  variant = 'outline',
  disabled = false,
  'data-testid': testId = 'tls-check-button'
}: {
  /** Read when the dialog opens. */
  input: () => HttpCheckTlsInput
  label?: string
  variant?: 'outline' | 'link'
  disabled?: boolean
  'data-testid'?: string
}) {
  const [opened, setOpened] = useState<HttpCheckTlsInput | null>(null)
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={cn(variant === 'link' && 'h-auto px-0 text-xs')}
        disabled={disabled}
        data-testid={testId}
        title="檢查伺服器憑證：Hachi、Mozilla、作業系統與 iOS 是否信任"
        onClick={() => setOpened(input())}
      >
        {variant === 'outline' && <ShieldCheck />}
        {label}
      </Button>
      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl" data-testid="tls-check">
          {opened && <CheckView input={opened} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
