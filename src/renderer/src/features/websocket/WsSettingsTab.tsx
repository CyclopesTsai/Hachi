import { useState } from 'react'
import { wsCloseCodeSchema, type WsSettings } from '@shared/schemas/ws-request'
import { utf8Bytes } from '@shared/ws'
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
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-3">
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
  const m = msg().ws.settings
  const h = msg().http.settings
  const set = (patch: Partial<WsSettings>) => onChange({ ...settings, ...patch })
  const hb = settings.heartbeat
  const setHb = (patch: Partial<WsSettings['heartbeat']>) => set({ heartbeat: { ...hb, ...patch } })
  // The close code is typed freely and only stored when valid (1000 or 3000–4999).
  const [closeCodeText, setCloseCodeText] = useState(String(settings.closeCode))
  const closeCodeValid = wsCloseCodeSchema.safeParse(Number(closeCodeText)).success
  const reasonBytes = utf8Bytes(settings.closeReason)

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-4" data-testid="ws-settings">
      <Row label={m.subprotocols}>
        <textarea
          aria-label={m.subprotocols}
          className="min-h-16 w-72 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none select-text focus-visible:ring-2 focus-visible:ring-ring/50"
          placeholder={m.subprotocolsPlaceholder}
          spellCheck={false}
          value={subprotocols.join('\n')}
          onChange={(e) => onSubprotocolsChange(e.target.value.split('\n'))}
        />
        <span className="text-xs text-muted-foreground">{m.subprotocolsHint}</span>
      </Row>
      <Row label={m.timeout}>
        <CheckboxLabel
          checked={settings.connectTimeoutMs === null}
          onChange={(e) =>
            set({ connectTimeoutMs: e.target.checked ? null : (ws?.timeoutMs ?? 30000) })
          }
        >
          {h.workspaceDefault}
          {ws ? h.timeoutDefault(ws.timeoutMs === 0 ? h.noLimit : `${ws.timeoutMs} ms`) : ''}
        </CheckboxLabel>
        {settings.connectTimeoutMs !== null && (
          <>
            <Input
              aria-label={m.timeoutLabel}
              type="number"
              min={0}
              className="h-8 w-32"
              value={settings.connectTimeoutMs}
              onChange={(e) => set({ connectTimeoutMs: int(e.target.value, 0, 3_600_000) })}
            />
            <span className="text-xs text-muted-foreground">{h.timeoutUnit}</span>
          </>
        )}
      </Row>
      <Row label={h.ssl}>
        <NativeSelect
          aria-label={h.ssl}
          value={toTri(settings.validateSSL)}
          onChange={(e) => set({ validateSSL: fromTri(e.target.value as TriState) })}
        >
          <option value="default">
            {h.workspaceDefault}
            {ws ? (ws.validateSSL ? h.on : h.off) : ''}
          </option>
          <option value="on">{h.sslOn}</option>
          <option value="off">{h.sslOff}</option>
        </NativeSelect>
      </Row>
      <Row label="Proxy">
        <CheckboxLabel
          checked={settings.useProxy}
          onChange={(e) => set({ useProxy: e.target.checked })}
        >
          {h.useProxy}
        </CheckboxLabel>
        <span className="text-xs text-muted-foreground">{h.proxyNow(proxyMode)}</span>
      </Row>
      <Row label={m.heartbeat}>
        <CheckboxLabel checked={hb.enabled} onChange={(e) => setHb({ enabled: e.target.checked })}>
          {m.heartbeatOn}
        </CheckboxLabel>
        {hb.enabled && (
          <>
            <NativeSelect
              aria-label={m.heartbeatMode}
              value={hb.mode}
              onChange={(e) => setHb({ mode: e.target.value as 'ping' | 'text' })}
            >
              <option value="ping">WebSocket Ping</option>
              <option value="text">{m.heartbeatText}</option>
            </NativeSelect>
            <span className="text-xs text-muted-foreground">{m.every}</span>
            <Input
              aria-label={m.intervalLabel}
              type="number"
              min={1}
              className="h-8 w-20"
              value={Math.round(hb.intervalMs / 1000)}
              onChange={(e) => setHb({ intervalMs: int(e.target.value, 1, 3600) * 1000 })}
            />
            <span className="text-xs text-muted-foreground">{m.seconds}</span>
            {hb.mode === 'text' && (
              <Input
                aria-label={m.payloadLabel}
                className="h-8 w-56 font-mono text-xs"
                placeholder={m.payloadPlaceholder}
                value={hb.payload}
                onChange={(e) => setHb({ payload: e.target.value })}
              />
            )}
          </>
        )}
      </Row>
      <Row label={m.onClose}>
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
          aria-label={m.reasonLabel}
          className="h-8 w-56"
          placeholder={m.reasonPlaceholder}
          value={settings.closeReason}
          onChange={(e) => {
            if (utf8Bytes(e.target.value) <= 123) set({ closeReason: e.target.value })
          }}
        />
        <span
          className={closeCodeValid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
        >
          {closeCodeValid ? m.closeHint(reasonBytes) : m.closeInvalid}
        </span>
      </Row>
      <p className="text-xs text-muted-foreground">{m.note}</p>
    </div>
  )
}
