import { useState, type FormEvent } from 'react'
import { msg } from '@shared/i18n'
import {
  APP_COPYRIGHT,
  APP_LICENSE,
  APP_LICENSE_URL,
  APP_NAME,
  APP_SOURCE_URL
} from '@shared/app-info'
import {
  PROXY_MODES,
  WS_MESSAGE_LIMIT_MAX,
  WS_MESSAGE_LIMIT_MIN,
  type ClientCertificate,
  type ProxySettings,
  type Theme
} from '@shared/schemas/app-config'
import { HISTORY_LIMIT_MAX, HISTORY_LIMIT_MIN } from '@shared/schemas/history'
import { MAX_REDIRECTS_LIMIT, type WorkspaceSettings } from '@shared/schemas/workspace'
import { SCRIPT_TOTAL_TIMEOUT_MAX_MS } from '@shared/scripts'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel } from '@renderer/components/ui/native-select'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'
import { useHistoryStore } from '@renderer/stores/history-store'
import { LanguageSelect } from './LanguageSelect'

function Row({
  label,
  htmlFor,
  children
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3">
      <Label htmlFor={htmlFor} className="text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Footer({ busy, error }: { busy: boolean; error: string | null }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {msg().common.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {msg().common.save}
        </Button>
      </DialogFooter>
    </>
  )
}

const clampInt = (value: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(Number(value) || 0)))

function WorkspaceSettingsForm({
  initial,
  onDone
}: {
  initial: WorkspaceSettings
  onDone: () => void
}) {
  const save = useAppStore((s) => s.saveWorkspaceSettings)
  const initiallyTrusted = useAppStore((s) => {
    const path = s.currentWorkspace?.path
    return !!path && !!s.config?.scripts.trustedWorkspaces.includes(path)
  })
  const initiallyFiles = useAppStore((s) => {
    const path = s.currentWorkspace?.path
    return !!path && !!s.config?.fileAccess.trustedWorkspaces.includes(path)
  })
  const [value, setValue] = useState(initial)
  const [trusted, setTrusted] = useState(initiallyTrusted)
  const [filesTrusted, setFilesTrusted] = useState(initiallyFiles)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    try {
      await save(value)
      if (trusted !== initiallyTrusted) {
        const config = await unwrap(window.hachi.workspace.setScriptTrust({ trusted }))
        useAppStore.getState().configChanged(config)
      }
      if (filesTrusted !== initiallyFiles) {
        const config = await unwrap(window.hachi.workspace.setFileTrust({ trusted: filesTrusted }))
        useAppStore.getState().configChanged(config)
      }
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const m = msg().settings.workspace
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{m.title}</DialogTitle>
        <DialogDescription>{m.description}</DialogDescription>
      </DialogHeader>
      <Row label="Timeout (ms)" htmlFor="ws-timeout">
        <Input
          id="ws-timeout"
          type="number"
          min={0}
          className="h-8 w-36"
          value={value.timeoutMs}
          onChange={(e) =>
            setValue({ ...value, timeoutMs: clampInt(e.target.value, 0, 3_600_000) })
          }
        />
        <span className="text-xs text-muted-foreground">{msg().common.unlimited}</span>
      </Row>
      <Row label={m.ssl}>
        <CheckboxLabel
          checked={value.validateSSL}
          onChange={(e) => setValue({ ...value, validateSSL: e.target.checked })}
        >
          {m.sslCheck}
        </CheckboxLabel>
      </Row>
      <Row label={m.redirects}>
        <CheckboxLabel
          checked={value.followRedirects}
          onChange={(e) => setValue({ ...value, followRedirects: e.target.checked })}
        >
          {m.redirectsFollow}
        </CheckboxLabel>
      </Row>
      <Row label={m.maxRedirects} htmlFor="ws-max-redirects">
        <Input
          id="ws-max-redirects"
          type="number"
          min={0}
          max={MAX_REDIRECTS_LIMIT}
          className="h-8 w-24"
          value={value.maxRedirects}
          onChange={(e) =>
            setValue({ ...value, maxRedirects: clampInt(e.target.value, 0, MAX_REDIRECTS_LIMIT) })
          }
        />
        <span className="text-xs text-muted-foreground">
          {m.maxRedirectsHint(MAX_REDIRECTS_LIMIT)}
        </span>
      </Row>
      <Row label="Git">
        <div className="flex flex-col gap-1">
          <CheckboxLabel
            checked={value.gitAutoFetch}
            data-testid="git-auto-fetch"
            onChange={(e) => setValue({ ...value, gitAutoFetch: e.target.checked })}
          >
            {m.gitAutoFetch}
          </CheckboxLabel>
          <span className="text-xs text-muted-foreground">{m.gitAutoFetchHint}</span>
        </div>
      </Row>
      <Row label={m.scriptTimeout} htmlFor="ws-script-timeout">
        <Input
          id="ws-script-timeout"
          type="number"
          min={1}
          max={SCRIPT_TOTAL_TIMEOUT_MAX_MS / 1000}
          className="h-8 w-24"
          data-testid="script-timeout"
          value={value.scriptTimeoutMs / 1000}
          onChange={(e) =>
            setValue({
              ...value,
              scriptTimeoutMs:
                clampInt(e.target.value, 1, SCRIPT_TOTAL_TIMEOUT_MAX_MS / 1000) * 1000
            })
          }
        />
        <span className="text-xs text-muted-foreground">{m.scriptTimeoutHint}</span>
      </Row>
      <Row label={m.scripts}>
        <div className="flex flex-col gap-1">
          <CheckboxLabel
            checked={trusted}
            data-testid="trust-scripts"
            onChange={(e) => setTrusted(e.target.checked)}
          >
            {m.trustScripts}
          </CheckboxLabel>
          <span className="text-xs text-muted-foreground">{m.trustScriptsHint}</span>
        </div>
      </Row>
      <Row label={m.files}>
        <div className="flex flex-col gap-1">
          <CheckboxLabel
            checked={filesTrusted}
            data-testid="trust-files"
            onChange={(e) => setFilesTrusted(e.target.checked)}
          >
            {m.trustFiles}
          </CheckboxLabel>
          <span className="text-xs text-muted-foreground">{m.trustFilesHint}</span>
        </div>
      </Row>
      <Footer busy={busy} error={error} />
    </form>
  )
}

export function WorkspaceSettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const settings = useAppStore((s) => s.workspaceSettings)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="workspace-settings-dialog">
        {open && settings && (
          <WorkspaceSettingsForm initial={settings} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

const THEMES: Theme[] = ['system', 'light', 'dark']

/** Interface language (issue #6): applied right away, like the appearance. */
function LanguageRow() {
  return (
    <Row label={msg().settings.app.language}>
      <LanguageSelect />
    </Row>
  )
}

/** Appearance (decision 93): applied right away, not with the form's 儲存. */
function ThemeRow() {
  const theme = useAppStore((s) => s.config?.theme ?? 'system')
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [error, setError] = useState<string | null>(null)
  const m = msg().settings.app
  return (
    <Row label={m.theme}>
      <div className="flex gap-4 text-sm" role="radiogroup" aria-label={m.theme}>
        {THEMES.map((t) => (
          <label key={t} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="theme"
              className="accent-primary"
              checked={theme === t}
              onChange={() =>
                void updateConfig({ theme: t }).then(
                  () => setError(null),
                  (err: unknown) => setError(errorMessage(err))
                )
              }
            />
            {m.themes[t]}
          </label>
        ))}
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </Row>
  )
}

const NO_CERTS: ClientCertificate[] = []

function AppSettingsForm({
  initial,
  initialHistoryLimit,
  initialMessageLimit,
  onDone
}: {
  initial: ProxySettings
  initialHistoryLimit: number
  initialMessageLimit: number
  onDone: () => void
}) {
  const updateConfig = useAppStore((s) => s.updateConfig)
  const setClientCertsOpen = useAppStore((s) => s.setClientCertsOpen)
  const certs = useAppStore((s) => s.config?.clientCertificates) ?? NO_CERTS
  const usage = useHistoryStore((s) => s.usage)
  const [proxy, setProxy] = useState(initial)
  const [bypassText, setBypassText] = useState(initial.bypass.join('\n'))
  const [historyLimit, setHistoryLimit] = useState(String(initialHistoryLimit))
  const [messageLimitText, setMessageLimitText] = useState(String(initialMessageLimit))
  const messageLimit = clampInt(messageLimitText, WS_MESSAGE_LIMIT_MIN, WS_MESSAGE_LIMIT_MAX)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ProxySettings>) => setProxy({ ...proxy, ...patch })
  const limit = clampInt(historyLimit, HISTORY_LIMIT_MIN, HISTORY_LIMIT_MAX)
  const willRemove = usage && limit < usage.total ? usage.total - limit : 0

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (willRemove > 0 && !window.confirm(msg().settings.app.historyConfirm(limit, willRemove))) {
      return
    }
    setBusy(true)
    try {
      const bypass = bypassText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
      await updateConfig({
        proxy: { ...proxy, url: proxy.url.trim(), bypass },
        history: { maxEntries: limit },
        websocket: { messageLimit }
      })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const m = msg().settings.app
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{m.title}</DialogTitle>
        <DialogDescription>{m.description}</DialogDescription>
      </DialogHeader>
      <LanguageRow />
      <ThemeRow />
      <span className="text-sm font-medium">Proxy</span>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={m.proxyMode}>
        {PROXY_MODES.map((mode) => (
          <label key={mode} className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="proxy-mode"
              className="accent-primary"
              checked={proxy.mode === mode}
              onChange={() => set({ mode })}
            />
            {m.proxyModes[mode]}
          </label>
        ))}
      </div>
      {proxy.mode === 'custom' && (
        <>
          <Row label="Proxy URL" htmlFor="proxy-url">
            <Input
              id="proxy-url"
              className="h-8 font-mono text-xs"
              placeholder="http://proxy.example.com:3128"
              value={proxy.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          </Row>
          <Row label={m.proxyUser} htmlFor="proxy-user">
            <Input
              id="proxy-user"
              className="h-8"
              value={proxy.username}
              onChange={(e) => set({ username: e.target.value })}
            />
          </Row>
          <Row label={m.proxyPassword} htmlFor="proxy-pass">
            <Input
              id="proxy-pass"
              type="password"
              className="h-8"
              value={proxy.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </Row>
          <p className="text-xs text-muted-foreground">{m.proxyPasswordHint}</p>
        </>
      )}
      {proxy.mode !== 'none' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="proxy-bypass" className="text-muted-foreground">
            {m.proxyBypass}
          </Label>
          <textarea
            id="proxy-bypass"
            className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 select-text"
            value={bypassText}
            onChange={(e) => setBypassText(e.target.value)}
          />
        </div>
      )}
      <div className="flex flex-col gap-2 border-t pt-3">
        <Row label={m.historyLimit} htmlFor="history-limit">
          <Input
            id="history-limit"
            type="number"
            min={HISTORY_LIMIT_MIN}
            max={HISTORY_LIMIT_MAX}
            className="h-8 w-24"
            value={historyLimit}
            onChange={(e) => setHistoryLimit(e.target.value)}
            onBlur={() => setHistoryLimit(String(limit))}
          />
          <span className="text-xs text-muted-foreground">
            {m.historyLimitHint(HISTORY_LIMIT_MIN, HISTORY_LIMIT_MAX)}
          </span>
        </Row>
        {usage && <p className="text-xs text-muted-foreground">{m.historyUsage(usage.total)}</p>}
        <Row label={m.wsMessages} htmlFor="ws-message-limit">
          <Input
            id="ws-message-limit"
            type="number"
            min={WS_MESSAGE_LIMIT_MIN}
            max={WS_MESSAGE_LIMIT_MAX}
            className="h-8 w-24"
            value={messageLimitText}
            onChange={(e) => setMessageLimitText(e.target.value)}
            onBlur={() => setMessageLimitText(String(messageLimit))}
          />
          <span className="text-xs text-muted-foreground">
            {m.wsMessagesHint(WS_MESSAGE_LIMIT_MIN, WS_MESSAGE_LIMIT_MAX)}
          </span>
        </Row>
        <Row label={m.clientCerts}>
          <span className="text-sm" data-testid="client-certs-count">
            {m.clientCertsCount(certs.filter((c) => c.enabled).length, certs.length)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="client-certs-manage"
            onClick={() => setClientCertsOpen(true)}
          >
            {m.clientCertsManage}
          </Button>
        </Row>
      </div>
      <Footer busy={busy} error={error} />
    </form>
  )
}

/** Appropriate Legal Notices (AGPL-3.0 section 5(d)). Links open in the system browser. */
function LegalNotice() {
  const version = useAppStore((s) => s.info?.version)
  return (
    <div
      className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground"
      data-testid="legal-notice"
    >
      <p className="font-medium text-foreground">
        {APP_NAME} {version}
      </p>
      <p>{APP_COPYRIGHT}</p>
      <p>{msg().settings.legal.notice(APP_NAME, APP_LICENSE)}</p>
      <p className="flex gap-3">
        <a
          className="text-primary underline-offset-2 hover:underline"
          href={APP_LICENSE_URL}
          target="_blank"
          rel="noreferrer"
        >
          {msg().settings.legal.license}
        </a>
        <a
          className="text-primary underline-offset-2 hover:underline"
          href={APP_SOURCE_URL}
          target="_blank"
          rel="noreferrer"
        >
          {msg().settings.legal.source}
        </a>
      </p>
    </div>
  )
}

export function AppSettingsDialog() {
  const open = useAppStore((s) => s.appSettingsOpen)
  const setOpen = useAppStore((s) => s.setAppSettingsOpen)
  const proxy = useAppStore((s) => s.config?.proxy)
  const historyLimit = useAppStore((s) => s.config?.history.maxEntries)
  const messageLimit = useAppStore((s) => s.config?.websocket.messageLimit)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="app-settings-dialog" className="max-w-lg">
        {open && proxy && historyLimit !== undefined && messageLimit !== undefined && (
          <AppSettingsForm
            initial={proxy}
            initialHistoryLimit={historyLimit}
            initialMessageLimit={messageLimit}
            onDone={() => setOpen(false)}
          />
        )}
        <LegalNotice />
      </DialogContent>
    </Dialog>
  )
}
