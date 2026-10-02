import { ArrowUpRight } from 'lucide-react'
import type { InheritedSettings } from '@shared/http'
import type { Auth } from '@shared/schemas/collection'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { cn } from '@renderer/lib/utils'

const AUTH_LABELS: Record<Auth['type'], string> = {
  inherit: '沿用上層（Inherit）',
  none: 'None',
  bearer: 'Bearer Token',
  basic: 'Basic Auth',
  apiKey: 'API Key'
}

function defaultsFor(type: Auth['type']): Auth {
  switch (type) {
    case 'bearer':
      return { type, token: '' }
    case 'basic':
      return { type, username: '', password: '' }
    case 'apiKey':
      return { type, key: '', value: '', in: 'header' }
    default:
      return { type }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

/** Fields of one auth type. Read-only when showing inherited auth. */
function AuthFields({
  auth,
  onChange,
  readOnly
}: {
  auth: Auth
  onChange?: (auth: Auth) => void
  readOnly?: boolean
}) {
  const set = (patch: Partial<Auth>) => onChange?.({ ...auth, ...patch } as Auth)
  const input = cn(
    'font-mono text-xs h-8',
    readOnly && 'bg-muted text-muted-foreground shadow-none'
  )
  switch (auth.type) {
    case 'bearer':
      return (
        <Field label="Token">
          <Input
            aria-label="Token"
            className={input}
            value={auth.token}
            readOnly={readOnly}
            onChange={(e) => set({ token: e.target.value })}
          />
        </Field>
      )
    case 'basic':
      return (
        <>
          <Field label="Username">
            <Input
              aria-label="Username"
              className={input}
              value={auth.username}
              readOnly={readOnly}
              onChange={(e) => set({ username: e.target.value })}
            />
          </Field>
          <Field label="Password">
            <Input
              aria-label="Password"
              type="password"
              className={input}
              value={auth.password}
              readOnly={readOnly}
              onChange={(e) => set({ password: e.target.value })}
            />
          </Field>
        </>
      )
    case 'apiKey':
      return (
        <>
          <Field label="Key">
            <Input
              aria-label="Key"
              className={input}
              value={auth.key}
              readOnly={readOnly}
              onChange={(e) => set({ key: e.target.value })}
            />
          </Field>
          <Field label="Value">
            <Input
              aria-label="Value"
              className={input}
              value={auth.value}
              readOnly={readOnly}
              onChange={(e) => set({ value: e.target.value })}
            />
          </Field>
          <Field label="加在">
            <NativeSelect
              aria-label="加在"
              value={auth.in}
              disabled={readOnly}
              onChange={(e) => set({ in: e.target.value as 'header' | 'query' })}
              className="w-40"
            >
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </NativeSelect>
          </Field>
        </>
      )
    default:
      return <p className="text-sm text-muted-foreground">不使用驗證。</p>
  }
}

export function AuthEditor({
  auth,
  onChange,
  inherited,
  allowInherit = true
}: {
  auth: Auth
  onChange: (auth: Auth) => void
  inherited: InheritedSettings
  /** Collections have nothing above them to inherit from. */
  allowInherit?: boolean
}) {
  const types = (Object.keys(AUTH_LABELS) as Auth['type'][]).filter(
    (t) => allowInherit || t !== 'inherit'
  )
  return (
    <div className="flex max-w-xl flex-col gap-4 p-4" data-testid="auth-editor">
      <Field label="類型">
        <NativeSelect
          aria-label="驗證類型"
          className="w-56"
          value={auth.type}
          onChange={(e) => onChange(defaultsFor(e.target.value as Auth['type']))}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {AUTH_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {auth.type === 'inherit' ? (
        <div
          className="flex flex-col gap-3 rounded-md border border-dashed bg-muted/40 p-3"
          data-testid="inherited-auth"
        >
          {inherited.auth ? (
            <>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpRight className="size-3.5 shrink-0" />
                <span>
                  {'沿用自「'}
                  <span className="font-medium text-foreground">{inherited.auth.sourceName}</span>
                  {`」：${AUTH_LABELS[inherited.auth.auth.type]}（唯讀，請到「${inherited.auth.sourceName}」修改）`}
                </span>
              </p>
              <div className="flex flex-col gap-3">
                <AuthFields auth={inherited.auth.auth} readOnly />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              上層沒有設定驗證，發送時不會帶驗證資訊。
            </p>
          )}
        </div>
      ) : (
        <AuthFields auth={auth} onChange={onChange} />
      )}
    </div>
  )
}
