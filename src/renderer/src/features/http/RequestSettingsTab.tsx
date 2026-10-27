import {
  HTTP_VERSIONS,
  type HttpRequestSettings,
  type HttpVersionSetting
} from '@shared/schemas/http-request'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { useAppStore } from '@renderer/stores/app-store'
import { msg } from '@shared/i18n'

type TriState = 'default' | 'on' | 'off'
const toTri = (v: boolean | null): TriState => (v === null ? 'default' : v ? 'on' : 'off')
const fromTri = (v: TriState): boolean | null => (v === 'default' ? null : v === 'on')

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  )
}

/** Per-request overrides of the Workspace defaults. */
export function RequestSettingsTab({
  settings,
  onChange
}: {
  settings: HttpRequestSettings
  onChange: (settings: HttpRequestSettings) => void
}) {
  const ws = useAppStore((s) => s.workspaceSettings)
  const proxyMode = useAppStore((s) => s.config?.proxy.mode ?? 'none')
  const set = (patch: Partial<HttpRequestSettings>) => onChange({ ...settings, ...patch })
  const m = msg().http.settings
  const onOff = (v: boolean | undefined) => (v === undefined ? '' : v ? m.on : m.off)

  return (
    <div className="flex max-w-xl flex-col gap-4 p-4" data-testid="request-settings">
      <Row label="Timeout">
        <CheckboxLabel
          checked={settings.timeoutMs === null}
          onChange={(e) => set({ timeoutMs: e.target.checked ? null : (ws?.timeoutMs ?? 30000) })}
        >
          {m.workspaceDefault}
          {ws ? m.timeoutDefault(ws.timeoutMs === 0 ? m.noLimit : `${ws.timeoutMs} ms`) : ''}
        </CheckboxLabel>
        {settings.timeoutMs !== null && (
          <>
            <Input
              aria-label="Timeout (ms)"
              type="number"
              min={0}
              className="h-8 w-32"
              value={settings.timeoutMs}
              onChange={(e) =>
                set({ timeoutMs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
            <span className="text-xs text-muted-foreground">{m.timeoutUnit}</span>
          </>
        )}
      </Row>
      <Row label={m.ssl}>
        <NativeSelect
          aria-label={m.ssl}
          value={toTri(settings.validateSSL)}
          onChange={(e) => set({ validateSSL: fromTri(e.target.value as TriState) })}
        >
          <option value="default">
            {m.workspaceDefault}
            {onOff(ws?.validateSSL)}
          </option>
          <option value="on">{m.sslOn}</option>
          <option value="off">{m.sslOff}</option>
        </NativeSelect>
      </Row>
      <Row label={m.redirects}>
        <NativeSelect
          aria-label={m.redirects}
          value={toTri(settings.followRedirects)}
          onChange={(e) => set({ followRedirects: fromTri(e.target.value as TriState) })}
        >
          <option value="default">
            {m.workspaceDefault}
            {onOff(ws?.followRedirects)}
          </option>
          <option value="on">{m.redirectsOn}</option>
          <option value="off">{m.redirectsOff}</option>
        </NativeSelect>
        {ws && (
          <span className="text-xs text-muted-foreground">{m.maxRedirects(ws.maxRedirects)}</span>
        )}
      </Row>
      <Row label={m.httpVersion}>
        <NativeSelect
          aria-label={m.httpVersion}
          data-testid="http-version"
          value={settings.httpVersion}
          onChange={(e) => set({ httpVersion: e.target.value as HttpVersionSetting })}
        >
          {HTTP_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {m.httpVersions[v]}
            </option>
          ))}
        </NativeSelect>
        <span className="text-xs text-muted-foreground">
          {m.httpVersionHint[settings.httpVersion]}
        </span>
      </Row>
      <Row label="Proxy">
        <CheckboxLabel
          checked={settings.useProxy}
          onChange={(e) => set({ useProxy: e.target.checked })}
        >
          {m.useProxy}
        </CheckboxLabel>
        <span className="text-xs text-muted-foreground">{m.proxyNow(proxyMode)}</span>
      </Row>
      <Row label="Cookie">
        <CheckboxLabel
          checked={settings.useCookieJar}
          data-testid="use-cookie-jar"
          onChange={(e) => set({ useCookieJar: e.target.checked })}
        >
          {m.useCookieJar}
        </CheckboxLabel>
        <span className="text-xs text-muted-foreground">{m.cookieJarHint}</span>
      </Row>
    </div>
  )
}
