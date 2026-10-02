import { useState } from 'react'
import { wsCloseCodeSchema, type WsSettings } from '@shared/schemas/ws-request'
import { utf8Bytes } from '@shared/ws'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { useAppStore } from '@renderer/stores/app-store'

type TriState = 'default' | 'on' | 'off'
const toTri = (v: boolean | null): TriState => (v === null ? 'default' : v ? 'on' : 'off')
const fromTri = (v: TriState): boolean | null => (v === 'default' ? null : v === 'on')

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-muted-foreground">{label}</Label>
      <div className="flex min-h-8 flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const int = (value: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(Number(value) || 0)))

/** Subprotocols, connection options, heartbeat and the close frame. */
export function WsSettingsTab({
  subprotocols,
  onSubprotocolsChange,
  settings,
  onChange
}: {
  subprotocols: string[]
  onSubprotocolsChange: (value: string[]) => void
  settings: WsSettings
  onChange: (settings: WsSettings) => void
}) {
  const ws = useAppStore((s) => s.workspaceSettings)
  const proxyMode = useAppStore((s) => s.config?.proxy.mode ?? 'none')
  const set = (patch: Partial<WsSettings>) => onChange({ ...settings, ...patch })
  const hb = settings.heartbeat
  const setHb = (patch: Partial<WsSettings['heartbeat']>) => set({ heartbeat: { ...hb, ...patch } })
  // The close code is typed freely and only stored when valid (1000 or 3000–4999).
  const [closeCodeText, setCloseCodeText] = useState(String(settings.closeCode))
  const closeCodeValid = wsCloseCodeSchema.safeParse(Number(closeCodeText)).success
  const reasonBytes = utf8Bytes(settings.closeReason)

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-4" data-testid="ws-settings">
      <Row label="子協定">
        <textarea
          aria-label="子協定"
          className="min-h-16 w-72 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none select-text focus-visible:ring-2 focus-visible:ring-ring/50"
          placeholder={'每行一個，例如\nchat.v2'}
          spellCheck={false}
          value={subprotocols.join('\n')}
          onChange={(e) => onSubprotocolsChange(e.target.value.split('\n'))}
        />
        <span className="text-xs text-muted-foreground">
          Sec-WebSocket-Protocol，可用 {'{{變數}}'}
        </span>
      </Row>
      <Row label="連線逾時">
        <CheckboxLabel
          checked={settings.connectTimeoutMs === null}
          onChange={(e) =>
            set({ connectTimeoutMs: e.target.checked ? null : (ws?.timeoutMs ?? 30000) })
          }
        >
          使用 Workspace 預設{ws ? `（${ws.timeoutMs === 0 ? '不限' : `${ws.timeoutMs} ms`}）` : ''}
        </CheckboxLabel>
        {settings.connectTimeoutMs !== null && (
          <>
            <Input
              aria-label="連線逾時 (ms)"
              type="number"
              min={0}
              className="h-8 w-32"
              value={settings.connectTimeoutMs}
              onChange={(e) => set({ connectTimeoutMs: int(e.target.value, 0, 3_600_000) })}
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
          <option value="default">
            Workspace 預設{ws ? (ws.validateSSL ? '：開' : '：關') : ''}
          </option>
          <option value="on">開</option>
          <option value="off">關（不驗證憑證）</option>
        </NativeSelect>
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
      <Row label="心跳">
        <CheckboxLabel checked={hb.enabled} onChange={(e) => setHb({ enabled: e.target.checked })}>
          定時送出
        </CheckboxLabel>
        {hb.enabled && (
          <>
            <NativeSelect
              aria-label="心跳方式"
              value={hb.mode}
              onChange={(e) => setHb({ mode: e.target.value as 'ping' | 'text' })}
            >
              <option value="ping">WebSocket Ping</option>
              <option value="text">文字訊息</option>
            </NativeSelect>
            <span className="text-xs text-muted-foreground">每</span>
            <Input
              aria-label="心跳間隔（秒）"
              type="number"
              min={1}
              className="h-8 w-20"
              value={Math.round(hb.intervalMs / 1000)}
              onChange={(e) => setHb({ intervalMs: int(e.target.value, 1, 3600) * 1000 })}
            />
            <span className="text-xs text-muted-foreground">秒</span>
            {hb.mode === 'text' && (
              <Input
                aria-label="心跳訊息"
                className="h-8 w-56 font-mono text-xs"
                placeholder='例如 {"type":"ping"}'
                value={hb.payload}
                onChange={(e) => setHb({ payload: e.target.value })}
              />
            )}
          </>
        )}
      </Row>
      <Row label="中斷時送出">
        <span className="text-xs text-muted-foreground">Close Code</span>
        <Input
          aria-label="Close Code"
          type="number"
          className="h-8 w-24"
          aria-invalid={!closeCodeValid}
          value={closeCodeText}
          onChange={(e) => {
            setCloseCodeText(e.target.value)
            const code = Number(e.target.value)
            if (wsCloseCodeSchema.safeParse(code).success) set({ closeCode: code })
          }}
        />
        <Input
          aria-label="Close 原因"
          className="h-8 w-56"
          placeholder="原因（選填）"
          value={settings.closeReason}
          onChange={(e) => {
            if (utf8Bytes(e.target.value) <= 123) set({ closeReason: e.target.value })
          }}
        />
        <span
          className={closeCodeValid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
        >
          {closeCodeValid
            ? `1000 或 3000–4999；原因 ${reasonBytes}/123 bytes`
            : '必須是 1000 或 3000–4999'}
        </span>
      </Row>
      <p className="text-xs text-muted-foreground">
        設定在下次連線時生效。不提供自動重連：斷線後請按「連線」重新連線。
      </p>
    </div>
  )
}
