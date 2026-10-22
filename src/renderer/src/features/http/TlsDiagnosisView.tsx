import { ArrowDown, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { TlsCertInfo, TlsDiagnosis } from '@shared/http'
import { cn } from '@renderer/lib/utils'
import { msg } from '@shared/i18n'

const ROLE = (cert: TlsCertInfo, index: number, total: number) =>
  index === 0
    ? msg().tls.roles.leaf
    : cert.selfSigned || index === total - 1
      ? msg().tls.roles.root
      : msg().tls.roles.intermediate

const date = (iso: string) => iso.slice(0, 10)

export function Badge({
  tone,
  children
}: {
  tone: 'ok' | 'bad' | 'warn' | 'muted'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap',
        tone === 'ok' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        tone === 'bad' && 'bg-red-500/15 text-red-700 dark:text-red-400',
        tone === 'warn' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        tone === 'muted' && 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function CertCard({
  cert,
  role,
  hostProblem
}: {
  cert: TlsCertInfo
  role: string
  hostProblem: boolean
}) {
  const problem = cert.expired || cert.notYetValid || cert.badSignature || hostProblem
  const b = msg().tls.badges
  return (
    <div
      className={cn('rounded-md border bg-card p-2.5 text-xs', problem && 'border-destructive/60')}
      data-testid="tls-cert"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">{role}</span>
        <span className="font-medium break-all" data-testid="tls-cert-name">
          {cert.name}
        </span>
        <div className="flex-1" />
        {cert.trusted && <Badge tone="ok">{b.trustedRoot}</Badge>}
        {cert.source === 'trust-store' && <Badge tone="muted">{b.fromStore}</Badge>}
        {cert.selfSigned && !cert.trusted && <Badge tone="bad">{b.selfSigned}</Badge>}
        {cert.expired && <Badge tone="bad">{b.expired}</Badge>}
        {cert.notYetValid && <Badge tone="bad">{b.notYetValid}</Badge>}
        {cert.badSignature && <Badge tone="bad">{b.badSignature}</Badge>}
        {hostProblem && <Badge tone="bad">{b.hostMismatch}</Badge>}
      </div>
      <dl className="mt-1.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-muted-foreground select-text">
        <dt>{msg().tls.issuer}</dt>
        <dd className="break-all text-foreground">{cert.issuerName}</dd>
        <dt>{msg().tls.validity}</dt>
        <dd className={cn((cert.expired || cert.notYetValid) && 'text-destructive')}>
          {date(cert.validFrom)} – {date(cert.validTo)}
        </dd>
        {cert.altNames.length > 0 && (
          <>
            <dt>{msg().tls.names}</dt>
            <dd className="break-all">{msg().common.list(cert.altNames)}</dd>
          </>
        )}
        <dt>SHA-256</dt>
        <dd className="font-mono text-[10px] break-all">{cert.fingerprint256}</dd>
      </dl>
    </div>
  )
}

const Link = () => (
  <div className="flex justify-center py-0.5 text-muted-foreground">
    <ArrowDown className="size-3.5" />
  </div>
)

/** Chain diagram + verdict of a TLS failure (decision 132). */
export function TlsDiagnosisView({
  diagnosis,
  title,
  action
}: {
  diagnosis: TlsDiagnosis
  /** Instead of "憑證檢查：<summary>" (the check dialog, decision 142). */
  title?: string
  /** Shown under the advice (e.g. the button to check every platform). */
  action?: React.ReactNode
}) {
  const d = diagnosis
  const Icon =
    d.verdict === 'ok' ? ShieldCheck : d.verdict === 'unavailable' ? ShieldQuestion : ShieldAlert
  return (
    <section
      className="flex max-w-2xl flex-col gap-2"
      data-testid="tls-diagnosis"
      data-verdict={d.verdict}
    >
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4 shrink-0" />
        {title ?? msg().tls.heading(d.summary)}
      </h3>
      {d.advice && <p className="text-xs text-muted-foreground">{d.advice}</p>}
      {action}
      {d.chain.length > 0 && (
        <div className="flex flex-col">
          <p className="mb-1 text-xs text-muted-foreground">
            {msg().tls.chainSent(`${d.host}:${d.port}`)}
          </p>
          {d.chain.map((cert, i) => (
            <div key={`${cert.fingerprint256}-${i}`}>
              {i > 0 && <Link />}
              <CertCard
                cert={cert}
                role={ROLE(cert, i, d.chain.length + (d.missing ? 1 : 0))}
                hostProblem={i === 0 && d.verdict === 'hostname-mismatch'}
              />
            </div>
          ))}
          {d.missing && (
            <>
              <Link />
              <div
                className="rounded-md border border-dashed border-destructive/60 p-2.5 text-xs"
                data-testid="tls-missing"
              >
                <p>
                  <span className="text-muted-foreground">{msg().tls.missing}</span>
                  <span className="font-medium">{d.missing.name}</span>
                  {d.verdict === 'incomplete-chain' ? msg().tls.notSent : msg().tls.notTrusted}
                </p>
                {d.missing.aiaUrl && (
                  <p className="mt-1 break-all text-muted-foreground select-text">
                    {msg().tls.aia(d.missing.aiaUrl)}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {d.opensslError && (
        <p className="font-mono text-[11px] text-muted-foreground">
          {msg().tls.verifyError(d.opensslError)}
        </p>
      )}
    </section>
  )
}
