import {
  AlertTriangle,
  KeyRound,
  Lightbulb,
  Loader2,
  RotateCw,
  ShieldCheck,
  ShieldOff
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  TlsCcadbResult,
  TlsCheckItem,
  TlsCheckResult,
  TlsProgramResult,
  TlsTrustResult
} from '@shared/http'
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
import { msg } from '@shared/i18n'

/** Root program inclusion from CCADB (issue #7), under the platforms. */
function CcadbSection({ ccadb, onRefresh }: { ccadb: TlsCcadbResult; onRefresh(): void }) {
  const day = ccadb.fetchedAt?.slice(0, 10)
  return (
    <section className="flex flex-col gap-1.5" data-testid="ccadb">
      <div className="flex items-center gap-2 text-xs">
        <h3 className="font-medium text-muted-foreground">{msg().tls.ccadbTitle}</h3>
        {day && <span className="text-muted-foreground">{msg().tls.ccadbDate(day)}</span>}
        <div className="flex-1" />
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-xs"
          onClick={onRefresh}
          data-testid="ccadb-refresh"
        >
          {ccadb.programs.length === 0 ? msg().tls.retry : msg().tls.update}
        </Button>
      </div>
      {ccadb.programs.length === 0 ? (
        <p
          className="rounded-md border p-3 text-xs text-muted-foreground select-text"
          data-testid="ccadb-unavailable"
        >
          {msg().tls.ccadbNeedsNetwork(ccadb.error)}
        </p>
      ) : (
        <>
          {ccadb.error && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3.5 shrink-0" />
              {msg().tls.ccadbStale(ccadb.error, day ?? '')}
            </p>
          )}
          <div className="divide-y rounded-md border">
            {ccadb.programs.map((p) => {
              const [text, tone] = [msg().tls.programBadges[p.status], PROGRAM_TONE[p.status]]
              return (
                <div
                  key={p.program}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-3 py-2 text-xs"
                  data-testid="ccadb-row"
                  data-program={p.program}
                  data-status={p.status}
                >
                  <div className="pt-px">
                    <Badge tone={tone}>{text}</Badge>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p>
                      <span className="font-medium">{p.label}</span>
                      {p.root && <span className="text-muted-foreground"> · {p.root}</span>}
                    </p>
                    {p.reasons.map((r) => (
                      <p key={r} className="break-words text-destructive select-text">
                        {r}
                      </p>
                    ))}
                    {p.notes.map((n) => (
                      <p key={n} className="break-words text-muted-foreground select-text">
                        {n}
                      </p>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">{msg().tls.ccadbPrivacy}</p>
    </section>
  )
}

const TRUST_TONE: Record<TlsTrustResult['status'], 'ok' | 'bad' | 'muted'> = {
  pass: 'ok',
  fail: 'bad',
  unsupported: 'muted',
  error: 'muted'
}
const CHECK_TONE: Record<TlsCheckItem['status'], 'ok' | 'bad' | 'warn' | 'muted'> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'bad',
  info: 'muted'
}
const PROGRAM_TONE: Record<TlsProgramResult['status'], 'ok' | 'bad'> = {
  included: 'ok',
  'not-included': 'bad',
  restricted: 'bad'
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
        const [text, tone] = [msg().tls.trustBadges[row.status], TRUST_TONE[row.status]]
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
        const [text, tone] = [msg().tls.checkBadges[item.status], CHECK_TONE[item.status]]
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

/** http:// / ws://: no certificate to check; say what the plain connection means. */
function Insecure({ scheme }: { scheme: 'http' | 'ws' }) {
  const secure = scheme === 'http' ? 'https://' : 'wss://'
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
      data-testid="tls-insecure"
    >
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
        <ShieldOff className="size-4 shrink-0" />
        {msg().tls.insecureTitle(scheme)}
      </h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 select-text">
        <li>{msg().tls.insecurePlain}</li>
        <li>{msg().tls.insecureApps(scheme)}</li>
        <li>{msg().tls.insecureUse(secure)}</li>
      </ul>
    </section>
  )
}

function Result({ result, onRefreshCcadb }: { result: TlsCheckResult; onRefreshCcadb(): void }) {
  const d = result.diagnosis
  if (result.insecure) return <Insecure scheme={result.insecure} />
  return (
    <div className="flex flex-col gap-4">
      {result.unresolvedVariables.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {msg().common.unresolvedVars(result.unresolvedVariables)}
        </p>
      )}
      {result.clientCertificate && (
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="tls-client-cert"
        >
          <KeyRound className="size-3.5 shrink-0" />
          {msg().tls.clientCert(result.clientCertificate.host, result.clientCertificate.files)}
        </p>
      )}
      {result.trust.length > 0 && (
        <Section title={msg().tls.platforms}>
          <TrustTable rows={result.trust} />
        </Section>
      )}
      {result.ccadb && <CcadbSection ccadb={result.ccadb} onRefresh={onRefreshCcadb} />}
      {result.advice.length > 0 && (
        <Section title={msg().tls.advice}>
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
        <Section title={msg().tls.otherChecks}>
          <CheckList items={result.checks} />
        </Section>
      )}
      <TlsDiagnosisView
        diagnosis={d}
        title={
          d.verdict === 'unavailable'
            ? d.summary
            : d.verdict === 'ok'
              ? msg().tls.chain
              : msg().tls.chainHachi(d.summary)
        }
      />
    </div>
  )
}

function CheckView({ input }: { input: HttpCheckTlsInput }) {
  const [request, setRequest] = useState(input)
  const [result, setResult] = useState<TlsCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = result === null && error === null

  useEffect(() => {
    let cancelled = false
    unwrap(window.hachi.http.checkTls(request))
      .then((r) => !cancelled && setResult(r))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [request])

  /** `refreshCcadb`: download the CCADB reports again too. */
  const again = (refreshCcadb = false) => {
    setResult(null)
    setError(null)
    setRequest({ ...input, refreshCcadb })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{msg().tls.title}</DialogTitle>
        <DialogDescription className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {result ? `${result.host}:${result.port} · ` : ''}
            {result?.insecure ? msg().tls.notEncrypted : msg().tls.readOnly}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => again()}
            data-testid="tls-check-again"
          >
            <RotateCw />
            {msg().tls.again}
          </Button>
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading && (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {msg().tls.checking}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && <Result result={result} onRefreshCcadb={() => again(true)} />}
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
  label,
  variant = 'outline',
  'data-testid': testId = 'tls-check-button'
}: {
  /** Read when the dialog opens. */
  input: () => HttpCheckTlsInput
  label?: string
  variant?: 'outline' | 'link'
  'data-testid'?: string
}) {
  const [opened, setOpened] = useState<HttpCheckTlsInput | null>(null)
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={cn(variant === 'link' && 'h-auto px-0 text-xs')}
        data-testid={testId}
        title={msg().tls.buttonTitle}
        onClick={() => setOpened(input())}
      >
        {variant === 'outline' && <ShieldCheck />}
        {label ?? msg().tls.button}
      </Button>
      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl" data-testid="tls-check">
          {opened && <CheckView input={opened} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
