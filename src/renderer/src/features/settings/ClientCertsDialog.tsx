import { useState } from 'react'
import { KeyRound, Pencil, Trash2 } from 'lucide-react'
import { clientCertFiles, clientCertHostLabel } from '@shared/client-certs'
import { msg } from '@shared/i18n'
import {
  CLIENT_CERT_TYPES,
  clientCertificateSchema,
  type ClientCertificate,
  type ClientCertType
} from '@shared/schemas/app-config'
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
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'

/** An entry being added or edited; the port as typed. */
interface Draft {
  id: string
  enabled: boolean
  host: string
  portText: string
  type: ClientCertType
  certPath: string
  keyPath: string
  pfxPath: string
  passphrase: string
}

const toDraft = (entry: ClientCertificate): Draft => ({
  ...entry,
  portText: entry.port === null ? '' : String(entry.port)
})

const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(),
  enabled: true,
  host: '',
  portText: '',
  type: 'pem',
  certPath: '',
  keyPath: '',
  pfxPath: '',
  passphrase: ''
})

/** The draft as an entry, or why it is not one yet. */
function fromDraft(draft: Draft): { entry: ClientCertificate } | { error: string } {
  const m = msg().settings.clientCerts
  const portText = draft.portText.trim()
  const port = portText === '' ? null : Number(portText)
  if (port !== null && !Number.isInteger(port)) return { error: m.badPort }
  const { portText: _, ...rest } = draft
  const parsed = clientCertificateSchema.safeParse({ ...rest, port })
  if (parsed.success) return { entry: parsed.data }
  return { error: parsed.error.issues[0]?.path[0] === 'port' ? m.badPort : m.badHost }
}

function FileRow({
  label,
  path,
  title,
  testId,
  onChange
}: {
  label: string
  path: string
  title: string
  testId: string
  onChange: (path: string) => void
}) {
  const m = msg().settings.clientCerts
  const name = path.split(/[\\/]/).pop() ?? path
  const dir = path.slice(0, path.length - name.length)
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      {path ? (
        <div className="flex min-w-0 flex-col" title={path} data-testid={testId} data-path={path}>
          <span className="truncate font-mono text-sm">{name}</span>
          {/* The end of a long folder path matters most: cut it at the start. */}
          <span className="truncate text-left font-mono text-xs text-muted-foreground [direction:rtl]">
            <bdi>{dir}</bdi>
          </span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground" data-testid={testId} data-path="">
          {m.noFile}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          void unwrap(window.hachi.dialog.selectFile({ title })).then((p) => p && onChange(p))
        }
      >
        {m.choose}
      </Button>
    </div>
  )
}

function EntryForm({
  initial,
  onCancel,
  onDone
}: {
  initial: Draft
  onCancel: () => void
  onDone: (entry: ClientCertificate) => Promise<void>
}) {
  const m = msg().settings.clientCerts
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  async function done(): Promise<void> {
    const result = fromDraft(draft)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Read the files now: a wrong path or passphrase shows here, not when sending.
      const check = await unwrap(window.hachi.config.checkClientCertificate(result.entry))
      if (check.error) setError(check.error)
      else await onDone(result.entry)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="client-cert-form">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
        <Label htmlFor="client-cert-host" className="text-muted-foreground">
          {m.host}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="client-cert-host"
            className="h-8 font-mono text-xs"
            placeholder="api.example.com"
            value={draft.host}
            onChange={(e) => set({ host: e.target.value })}
          />
          <Label htmlFor="client-cert-port" className="shrink-0 text-muted-foreground">
            {m.port}
          </Label>
          <Input
            id="client-cert-port"
            className="h-8 w-20 shrink-0 font-mono text-xs"
            inputMode="numeric"
            placeholder={m.portPlaceholder}
            value={draft.portText}
            onChange={(e) => set({ portText: e.target.value })}
          />
        </div>
        <span />
        <p className="text-xs text-muted-foreground">{m.hostHint}</p>
        <span className="text-sm text-muted-foreground">{m.type}</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label={m.type}>
          {CLIENT_CERT_TYPES.map((type) => (
            <label key={type} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="client-cert-type"
                className="accent-primary"
                checked={draft.type === type}
                onChange={() => set({ type })}
              />
              {m.types[type]}
            </label>
          ))}
        </div>
      </div>
      {draft.type === 'pem' ? (
        <>
          <FileRow
            label={m.certFile}
            path={draft.certPath}
            title={m.pickTitle.cert}
            testId="client-cert-cert-path"
            onChange={(certPath) => set({ certPath })}
          />
          <FileRow
            label={m.keyFile}
            path={draft.keyPath}
            title={m.pickTitle.key}
            testId="client-cert-key-path"
            onChange={(keyPath) => set({ keyPath })}
          />
        </>
      ) : (
        <FileRow
          label={m.pfxFile}
          path={draft.pfxPath}
          title={m.pickTitle.pfx}
          testId="client-cert-pfx-path"
          onChange={(pfxPath) => set({ pfxPath })}
        />
      )}
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
        <Label htmlFor="client-cert-pass" className="text-muted-foreground">
          {m.passphrase}
        </Label>
        <Input
          id="client-cert-pass"
          type="password"
          className="h-8"
          value={draft.passphrase}
          onChange={(e) => set({ passphrase: e.target.value })}
        />
        <span />
        <p className="text-xs text-muted-foreground">{m.passphraseHint}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm break-words text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {msg().common.cancel}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void done()}>
          {busy ? m.checking : m.done}
        </Button>
      </DialogFooter>
    </div>
  )
}

/** Client certificates of this computer (decision 147): a list saved as it changes. */
export function ClientCertsDialog() {
  const open = useAppStore((s) => s.clientCertsOpen)
  const setOpen = useAppStore((s) => s.setClientCertsOpen)
  const list = useAppStore((s) => s.config?.clientCertificates)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const m = msg().settings.clientCerts
  const entries = list ?? []

  async function save(next: ClientCertificate[]): Promise<void> {
    setError(null)
    await updateConfig({ clientCertificates: next })
  }

  async function toggle(entry: ClientCertificate, enabled: boolean): Promise<void> {
    try {
      if (enabled) {
        const check = await unwrap(window.hachi.config.checkClientCertificate(entry))
        if (check.error) {
          setError(check.error)
          return
        }
      }
      await save(entries.map((e) => (e.id === entry.id ? { ...e, enabled } : e)))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove(entry: ClientCertificate): Promise<void> {
    if (!window.confirm(m.removeConfirm(clientCertHostLabel(entry)))) return
    try {
      await save(entries.filter((e) => e.id !== entry.id))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setEditing(null)
          setError(null)
        }
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-2xl"
        data-testid="client-certs"
        // Esc in the form goes back to the list.
        onEscapeKeyDown={(e) => {
          if (editing) {
            e.preventDefault()
            setEditing(null)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editing
              ? entries.some((e) => e.id === editing.id)
                ? m.editTitle(editing.host)
                : m.addTitle
              : m.title}
          </DialogTitle>
          <DialogDescription>{m.description}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <div className="min-h-0 overflow-y-auto">
            <EntryForm
              key={editing.id}
              initial={editing}
              onCancel={() => setEditing(null)}
              onDone={async (entry) => {
                const exists = entries.some((e) => e.id === entry.id)
                await save(
                  exists ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry]
                )
                setEditing(null)
              }}
            />
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{m.empty}</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-3 py-2"
                      data-testid="client-cert-row"
                      data-host={clientCertHostLabel(entry)}
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 shrink-0 accent-primary"
                        aria-label={m.enabled}
                        checked={entry.enabled}
                        onChange={(e) => void toggle(entry, e.target.checked)}
                      />
                      <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-mono text-sm">
                          {clientCertHostLabel(entry)}
                          {entry.port === null && (
                            <span className="ml-2 font-sans text-xs text-muted-foreground">
                              {m.anyPort}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.type === 'pfx' ? 'PKCS#12' : 'PEM'} · {clientCertFiles(entry)}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={m.edit}
                        title={m.edit}
                        onClick={() => {
                          setError(null)
                          setEditing(toDraft(entry))
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={m.remove}
                        title={m.remove}
                        onClick={() => void remove(entry)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm break-words text-destructive">
                  {error}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{m.rule}</p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(null)
                  setEditing(emptyDraft())
                }}
              >
                {m.add}
              </Button>
              <DialogClose asChild>
                <Button type="button">{msg().common.close}</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
