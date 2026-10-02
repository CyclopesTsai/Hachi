import type { HttpRequestSettings } from '@shared/schemas/http-request'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { useAppStore } from '@renderer/stores/app-store'

type TriState = 'default' | 'on' | 'off'
const toTri = (v: boolean | null): TriState => (v === null ? 'default' : v ? 'on' : 'off')
const fromTri = (v: TriState): boolean | null => (v === 'default' ? null : v === 'on')

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
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
  const onOff = (v: boolean | undefined) => (v === undefined ? '' : v ? '：開' : '：關')

  return (
    <div className="flex max-w-xl flex-col gap-4 p-4" data-testid="request-settings">
      <Row label="Timeout">
        <CheckboxLabel
          checked={settings.timeoutMs === null}
          onChange={(e) => set({ timeoutMs: e.target.checked ? null : (ws?.timeoutMs ?? 30000) })}
        >
          使用 Workspace 預設{ws ? `（${ws.timeoutMs === 0 ? '不限' : `${ws.timeoutMs} ms`}）` : ''}
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
            <span className="text-xs text-muted-foreground">ms（0 = 不限）</span>
          </>
        )}
      </Row>
      <Row label="SSL 憑證驗證">
        <NativeSelect
          aria-label="SSL 憑證驗證"
          value={toTri(settings.validateSSL)}
          onChange={(e) => set({ validateSSL: fromTri(e.target.value as TriState) })}
        >
          <option value="default">Workspace 預設{onOff(ws?.validateSSL)}</option>
          <option value="on">開</option>
          <option value="off">關（不驗證憑證）</option>
        </NativeSelect>
      </Row>
      <Row label="跟隨重新導向">
        <NativeSelect
          aria-label="跟隨重新導向"
          value={toTri(settings.followRedirects)}
          onChange={(e) => set({ followRedirects: fromTri(e.target.value as TriState) })}
        >
          <option value="default">Workspace 預設{onOff(ws?.followRedirects)}</option>
          <option value="on">跟隨</option>
          <option value="off">不跟隨</option>
        </NativeSelect>
        {ws && <span className="text-xs text-muted-foreground">最多 {ws.maxRedirects} 次</span>}
      </Row>
      <Row label="Proxy">
        <CheckboxLabel
          checked={settings.useProxy}
          onChange={(e) => set({ useProxy: e.target.checked })}
        >
          使用 App 的 Proxy 設定
        </CheckboxLabel>
        <span className="text-xs text-muted-foreground">
          目前：{proxyMode === 'none' ? '未設定' : proxyMode === 'system' ? '系統 Proxy' : '自訂'}
        </span>
      </Row>
    </div>
  )
}
