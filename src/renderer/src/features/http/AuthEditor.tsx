import { useEffect, useState } from 'react'
import { ArrowUpRight, KeyRound, Loader2 } from 'lucide-react'
import type { InheritedSettings, OAuth2TokenStatus } from '@shared/http'
import {
  authSchema,
  type Auth,
  type OAuth2Auth,
  type OAuth2Grant
} from '@shared/schemas/collection'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { VariableInput } from '@renderer/components/variable-input'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useEnvStore } from '@renderer/stores/env-store'

/** Text field that highlights `{{variables}}` (styled like <Input>). */
function VarField({
  label,
  value,
  readOnly,
  placeholder,
  onChange
}: {
  label: string
  value: string
  readOnly?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <VariableInput
      aria-label={label}
      className={cn(
        'h-8 rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        readOnly && 'bg-muted shadow-none'
      )}
      textClassName="px-3 font-mono text-xs"
      muted={readOnly}
      readOnly={readOnly}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

const AUTH_LABELS: Record<Auth['type'], string> = {
  inherit: '沿用上層（Inherit）',
  none: 'None',
  bearer: 'Bearer Token',
  basic: 'Basic Auth',
  apiKey: 'API Key',
  oauth2: 'OAuth 2.0',
  digest: 'Digest Auth',
  awsSigV4: 'AWS Signature'
}

/** Only an HTTP request can answer a Digest challenge or be signed for AWS. */
const HTTP_ONLY: Auth['type'][] = ['digest', 'awsSigV4']

const GRANT_LABELS: Record<OAuth2Grant, string> = {
  client_credentials: 'Client Credentials',
  password: 'Password',
  authorization_code: 'Authorization Code'
}

const defaultsFor = (type: Auth['type']): Auth => authSchema.parse({ type })

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function SecretField({
  label,
  value,
  readOnly,
  onChange
}: {
  label: string
  value: string
  readOnly?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Input
      aria-label={label}
      type="password"
      className={cn(
        'h-8 font-mono text-xs',
        readOnly && 'bg-muted text-muted-foreground shadow-none'
      )}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

const timeLeft = (expiresAt: number) => {
  const minutes = Math.round((expiresAt - Date.now()) / 60_000)
  return minutes >= 120 ? `${Math.round(minutes / 60)} 小時` : `${Math.max(minutes, 0)} 分鐘`
}

/** Token kept in memory for these settings (decision 128): status + 取得 / 清除. */
function OAuth2TokenPanel({ auth, scopeId }: { auth: OAuth2Auth; scopeId: string | null }) {
  const environmentId = useEnvStore((s) => s.activeId)
  const [status, setStatus] = useState<OAuth2TokenStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = { parentId: scopeId, environmentId, auth }
  const key = JSON.stringify(input)

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => {
      void unwrap(window.hachi.auth.oauth2Status(JSON.parse(key) as typeof input))
        .catch(() => null)
        .then((next) => {
          if (alive) setStatus(next)
        })
    }
    load()
    // Tokens also change when requests are sent (client credentials / refresh).
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key, tick])

  const obtain = async () => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await unwrap(window.hachi.auth.oauth2Obtain(input)))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    setError(null)
    await unwrap(window.hachi.auth.oauth2Clear(input)).catch(() => undefined)
    setTick((t) => t + 1)
  }

  const browser = auth.grantType === 'authorization_code'
  let text = '還沒有 Token'
  if (status?.state === 'valid') {
    text =
      status.expiresAt === null
        ? '已取得 Token'
        : `已取得 Token（剩 ${timeLeft(status.expiresAt)}）`
  } else if (status?.state === 'expired') {
    text = status.refreshable ? 'Token 已過期，送出時會自動更新' : 'Token 已過期'
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3"
      data-testid="oauth2-token"
    >
      <div className="flex items-center gap-2 text-xs">
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        <span data-testid="oauth2-token-status">{text}</span>
        <div className="flex-1" />
        {busy && browser ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void window.hachi.auth.oauth2Cancel(input)}
          >
            取消
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void obtain()}>
          {busy && <Loader2 className="animate-spin" />}
          取得 Token
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !status || status.state === 'none'}
          onClick={() => void clear()}
        >
          清除
        </Button>
      </div>
      {busy && browser && (
        <p className="text-xs text-muted-foreground">已開啟瀏覽器，完成授權後會自動回到這裡…</p>
      )}
      {error && <p className="text-xs break-all text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Token 只存在記憶體，關閉 Hachi 後清除。
        {browser ? '送出請求前要先取得 Token。' : '送出時沒有 Token 會自動取得。'}
      </p>
    </div>
  )
}

function OAuth2Fields({
  auth,
  set,
  readOnly
}: {
  auth: OAuth2Auth
  set: (patch: Partial<OAuth2Auth>) => void
  readOnly?: boolean
}) {
  const code = auth.grantType === 'authorization_code'
  return (
    <>
      <Field label="Grant Type">
        <NativeSelect
          aria-label="Grant Type"
          value={auth.grantType}
          disabled={readOnly}
          onChange={(e) => set({ grantType: e.target.value as OAuth2Grant })}
          className="w-56"
        >
          {(Object.keys(GRANT_LABELS) as OAuth2Grant[]).map((g) => (
            <option key={g} value={g}>
              {GRANT_LABELS[g]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {code && (
        <Field label="Auth URL">
          <VarField
            label="Auth URL"
            value={auth.authUrl}
            readOnly={readOnly}
            onChange={(authUrl) => set({ authUrl })}
          />
        </Field>
      )}
      <Field label="Access Token URL">
        <VarField
          label="Access Token URL"
          value={auth.accessTokenUrl}
          readOnly={readOnly}
          onChange={(accessTokenUrl) => set({ accessTokenUrl })}
        />
      </Field>
      {code && (
        <Field label="Callback URL">
          <VarField
            label="Callback URL"
            value={auth.callbackUrl}
            readOnly={readOnly}
            placeholder="http://127.0.0.1:<自動選擇>/callback"
            onChange={(callbackUrl) => set({ callbackUrl })}
          />
        </Field>
      )}
      <Field label="Client ID">
        <VarField
          label="Client ID"
          value={auth.clientId}
          readOnly={readOnly}
          onChange={(clientId) => set({ clientId })}
        />
      </Field>
      <Field label="Client Secret">
        <SecretField
          label="Client Secret"
          value={auth.clientSecret}
          readOnly={readOnly}
          onChange={(clientSecret) => set({ clientSecret })}
        />
      </Field>
      {auth.grantType === 'password' && (
        <>
          <Field label="Username">
            <VarField
              label="OAuth Username"
              value={auth.username}
              readOnly={readOnly}
              onChange={(username) => set({ username })}
            />
          </Field>
          <Field label="Password">
            <SecretField
              label="OAuth Password"
              value={auth.password}
              readOnly={readOnly}
              onChange={(password) => set({ password })}
            />
          </Field>
        </>
      )}
      <Field label="Scope">
        <VarField
          label="Scope"
          value={auth.scope}
          readOnly={readOnly}
          placeholder="以空白分隔"
          onChange={(scope) => set({ scope })}
        />
      </Field>
      <Field label="Client 驗證">
        <NativeSelect
          aria-label="Client 驗證"
          value={auth.clientAuth}
          disabled={readOnly}
          onChange={(e) => set({ clientAuth: e.target.value as 'header' | 'body' })}
          className="w-56"
        >
          <option value="header">Basic Auth Header</option>
          <option value="body">放在 Body</option>
        </NativeSelect>
      </Field>
      <Field label="Header 前綴">
        <Input
          aria-label="Header 前綴"
          className={cn('h-8 w-40 font-mono text-xs', readOnly && 'bg-muted shadow-none')}
          value={auth.headerPrefix}
          readOnly={readOnly}
          onChange={(e) => set({ headerPrefix: e.target.value })}
        />
      </Field>
      {code && (
        <Field label="PKCE">
          <CheckboxLabel
            checked={auth.pkce}
            disabled={readOnly}
            onChange={(e) => set({ pkce: e.target.checked })}
          >
            使用 PKCE（S256）
          </CheckboxLabel>
        </Field>
      )}
    </>
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
          <VarField
            label="Token"
            value={auth.token}
            readOnly={readOnly}
            onChange={(token) => set({ token })}
          />
        </Field>
      )
    case 'basic':
      return (
        <>
          <Field label="Username">
            <VarField
              label="Username"
              value={auth.username}
              readOnly={readOnly}
              onChange={(username) => set({ username })}
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
            <VarField
              label="Key"
              value={auth.key}
              readOnly={readOnly}
              onChange={(key) => set({ key })}
            />
          </Field>
          <Field label="Value">
            <VarField
              label="Value"
              value={auth.value}
              readOnly={readOnly}
              onChange={(value) => set({ value })}
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
    case 'digest':
      return (
        <>
          <Field label="Username">
            <VarField
              label="Username"
              value={auth.username}
              readOnly={readOnly}
              onChange={(username) => set({ username })}
            />
          </Field>
          <Field label="Password">
            <SecretField
              label="Password"
              value={auth.password}
              readOnly={readOnly}
              onChange={(password) => set({ password })}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            先送出一次，伺服器回 401 時依它的 Digest challenge 再送一次。
          </p>
        </>
      )
    case 'awsSigV4':
      return (
        <>
          <Field label="Access Key">
            <VarField
              label="Access Key"
              value={auth.accessKeyId}
              readOnly={readOnly}
              onChange={(accessKeyId) => set({ accessKeyId })}
            />
          </Field>
          <Field label="Secret Key">
            <SecretField
              label="Secret Key"
              value={auth.secretAccessKey}
              readOnly={readOnly}
              onChange={(secretAccessKey) => set({ secretAccessKey })}
            />
          </Field>
          <Field label="Session Token">
            <SecretField
              label="Session Token"
              value={auth.sessionToken}
              readOnly={readOnly}
              onChange={(sessionToken) => set({ sessionToken })}
            />
          </Field>
          <Field label="Region">
            <VarField
              label="Region"
              value={auth.region}
              readOnly={readOnly}
              placeholder="us-east-1"
              onChange={(region) => set({ region })}
            />
          </Field>
          <Field label="Service">
            <VarField
              label="Service"
              value={auth.service}
              readOnly={readOnly}
              placeholder="execute-api、s3…"
              onChange={(service) => set({ service })}
            />
          </Field>
        </>
      )
    case 'oauth2':
      return <OAuth2Fields auth={auth} set={set} readOnly={readOnly} />
    default:
      return <p className="text-sm text-muted-foreground">不使用驗證。</p>
  }
}

export function AuthEditor({
  auth,
  onChange,
  inherited,
  scopeId,
  allowInherit = true,
  websocket = false
}: {
  auth: Auth
  onChange: (auth: Auth) => void
  inherited: InheritedSettings
  /** Item whose variables resolve the OAuth 2.0 settings (request's parent / container). */
  scopeId: string | null
  /** Collections have nothing above them to inherit from. */
  allowInherit?: boolean
  /** WebSocket: no Digest / AWS Signature. */
  websocket?: boolean
}) {
  const types = (Object.keys(AUTH_LABELS) as Auth['type'][]).filter(
    (t) => (allowInherit || t !== 'inherit') && (!websocket || !HTTP_ONLY.includes(t))
  )
  const shown = auth.type === 'inherit' ? inherited.auth?.auth : auth
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
      {shown?.type === 'oauth2' && <OAuth2TokenPanel auth={shown} scopeId={scopeId} />}
      {websocket && shown && HTTP_ONLY.includes(shown.type) && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          WebSocket 不支援 {AUTH_LABELS[shown.type]}，連線時不會帶驗證資訊。
        </p>
      )}
    </div>
  )
}
