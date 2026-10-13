import { ArrowDown, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { TlsCertInfo, TlsDiagnosis } from '@shared/http'
import { cn } from '@renderer/lib/utils'

const ROLE = (cert: TlsCertInfo, index: number, total: number) =>
  index === 0 ? '網站憑證' : cert.selfSigned || index === total - 1 ? '根憑證' : '中繼憑證'

const date = (iso: string) => iso.slice(0, 10)

function Badge({ tone, children }: { tone: 'ok' | 'bad' | 'muted'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-px text-[11px] font-medium',
        tone === 'ok' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        tone === 'bad' && 'bg-red-500/15 text-red-700 dark:text-red-400',
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
        {cert.trusted && <Badge tone="ok">受信任的根憑證</Badge>}
        {cert.source === 'trust-store' && <Badge tone="muted">來自信任清單</Badge>}
        {cert.selfSigned && !cert.trusted && <Badge tone="bad">自簽、不受信任</Badge>}
        {cert.expired && <Badge tone="bad">已過期</Badge>}
        {cert.notYetValid && <Badge tone="bad">尚未生效</Badge>}
        {cert.badSignature && <Badge tone="bad">簽章對不上</Badge>}
        {hostProblem && <Badge tone="bad">網域不符</Badge>}
      </div>
      <dl className="mt-1.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-muted-foreground select-text">
        <dt>簽發者</dt>
        <dd className="break-all text-foreground">{cert.issuerName}</dd>
        <dt>有效期間</dt>
        <dd className={cn((cert.expired || cert.notYetValid) && 'text-destructive')}>
          {date(cert.validFrom)} – {date(cert.validTo)}
        </dd>
        {cert.altNames.length > 0 && (
          <>
            <dt>適用名稱</dt>
            <dd className="break-all">{cert.altNames.join('、')}</dd>
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
export function TlsDiagnosisView({ diagnosis }: { diagnosis: TlsDiagnosis }) {
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
        憑證檢查：{d.summary}
      </h3>
      <p className="text-xs text-muted-foreground">{d.advice}</p>
      {d.chain.length > 0 && (
        <div className="flex flex-col">
          <p className="mb-1 text-xs text-muted-foreground">
            {d.host}:{d.port} 送出的憑證鏈（上面的由下面的簽發）
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
                  <span className="text-muted-foreground">缺少：</span>
                  <span className="font-medium">{d.missing.name}</span>
                  {d.verdict === 'incomplete-chain' ? '（伺服器沒有送出）' : '（不在信任清單中）'}
                </p>
                {d.missing.aiaUrl && (
                  <p className="mt-1 break-all text-muted-foreground select-text">
                    憑證中的下載位置（AIA）：{d.missing.aiaUrl}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {d.opensslError && (
        <p className="font-mono text-[11px] text-muted-foreground">驗證錯誤：{d.opensslError}</p>
      )}
    </section>
  )
}
