import { AlertTriangle, CircleX, FileDown } from 'lucide-react'
import {
  useEffect,
  useState,
  type ComponentProps,
  type DragEvent,
  type FormEvent,
  type ReactNode
} from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel, NativeSelect } from '@renderer/components/ui/native-select'
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useEnvStore } from '@renderer/stores/env-store'
import {
  EXPORT_FORMATS,
  exportFormatLabel,
  useTransferStore
} from '@renderer/stores/transfer-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import type { ExportFormat } from '@shared/ipc/api'
import { findNode } from '@shared/tree'
import { msg } from '@shared/i18n'

function CurlForm() {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent): void {
    e.preventDefault()
    try {
      useTransferStore.getState().importCurl(text)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{msg().transfer.curlTitle}</DialogTitle>
        <DialogDescription>{msg().transfer.curlDescription}</DialogDescription>
      </DialogHeader>
      <textarea
        autoFocus
        aria-label={msg().transfer.curlLabel}
        data-testid="curl-input"
        spellCheck={false}
        className="h-56 w-full resize-none rounded-md border border-input bg-transparent p-3 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        placeholder={
          "curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"Hachi\"}'"
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => useTransferStore.getState().setCurlOpen(false)}
        >
          {msg().common.cancel}
        </Button>
        <Button type="submit" disabled={text.trim() === ''}>
          {msg().transfer.import}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CurlImportDialog() {
  const open = useTransferStore((s) => s.curlOpen)
  return (
    <Dialog open={open} onOpenChange={(o) => useTransferStore.getState().setCurlOpen(o)}>
      <DialogContent className="sm:max-w-2xl">{open && <CurlForm />}</DialogContent>
    </Dialog>
  )
}

function ExportForm({ collectionId }: { collectionId: string }) {
  const name = useTreeStore((s) => findNode(s.tree, collectionId)?.node.name ?? '')
  const environments = useEnvStore((s) => s.list)
  const activeEnv = useEnvStore((s) => s.activeId)
  const [format, setFormat] = useState<ExportFormat>('postman')
  const [environmentId, setEnvironmentId] = useState<string>(activeEnv ?? '')
  const [busy, setBusy] = useState(false)
  const openApi = format === 'openapi-html' || format === 'openapi-json'

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    try {
      await useTransferStore
        .getState()
        .exportCollection(collectionId, format, openApi && environmentId ? environmentId : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{msg().transfer.exportTitle}</DialogTitle>
        <DialogDescription className="truncate">{name}</DialogDescription>
      </DialogHeader>
      <fieldset className="flex min-w-0 flex-col gap-1" data-testid="export-formats">
        <legend className="sr-only">{msg().transfer.format}</legend>
        {EXPORT_FORMATS.map((f) => (
          <label
            key={f}
            className={cn(
              'flex cursor-default items-start gap-2.5 rounded-md border px-3 py-2',
              format === f ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60'
            )}
          >
            <input
              type="radio"
              name="export-format"
              value={f}
              checked={format === f}
              onChange={() => setFormat(f)}
              className="mt-1 accent-primary"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{exportFormatLabel(f)}</span>
              <span className="text-xs text-muted-foreground">{msg().transfer.hints[f]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {openApi && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="export-env">{msg().transfer.environment}</Label>
          <NativeSelect
            id="export-env"
            data-testid="export-env"
            value={environmentId}
            onChange={(e) => setEnvironmentId(e.target.value)}
          >
            <option value="">{msg().transfer.noEnvironment}</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{msg().transfer.noSecrets}</p>
        </div>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => useTransferStore.getState().setExportId(null)}
        >
          {msg().common.cancel}
        </Button>
        <Button type="submit" disabled={busy}>
          {format === 'bruno' || format === 'bruno-yaml'
            ? msg().transfer.chooseFolder
            : msg().transfer.export}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ExportDialog() {
  const collectionId = useTransferStore((s) => s.exportId)
  return (
    <Dialog
      open={collectionId !== null}
      onOpenChange={(o) => !o && useTransferStore.getState().setExportId(null)}
    >
      <DialogContent className="sm:max-w-lg" data-testid="export-dialog">
        {collectionId !== null && <ExportForm collectionId={collectionId} />}
      </DialogContent>
    </Dialog>
  )
}

type BrunoChoice = NonNullable<ReturnType<typeof useTransferStore.getState>['brunoChoice']>

function BrunoPickForm({ choice }: { choice: BrunoChoice }) {
  const busy = useTransferStore((s) => s.busy)
  const [picked, setPicked] = useState(() => new Set(choice.collections.map((c) => c.path)))
  const all = picked.size === choice.collections.length
  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  function submit(e: FormEvent): void {
    e.preventDefault()
    void useTransferStore
      .getState()
      .importBrunoChoice(choice.collections.map((c) => c.path).filter((p) => picked.has(p)))
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{msg().transfer.brunoTitle}</DialogTitle>
        <DialogDescription>
          {msg().transfer.brunoDescription(choice.folder, choice.collections.length)}
        </DialogDescription>
      </DialogHeader>
      <CheckboxLabel
        checked={all}
        onChange={() => setPicked(all ? new Set() : new Set(choice.collections.map((c) => c.path)))}
      >
        {msg().transfer.selectAll}
      </CheckboxLabel>
      <ul
        className="flex max-h-[50vh] flex-col gap-0.5 overflow-auto rounded-md border p-1"
        data-testid="bruno-pick-list"
      >
        {choice.collections.map((c) => (
          <li key={c.path}>
            <label className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={picked.has(c.path)}
                onChange={() => toggle(c.path)}
              />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                {c.path || '.'} · {c.format === 'yaml' ? 'YAML' : '.bru'}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => useTransferStore.getState().cancelBrunoChoice()}
        >
          {msg().common.cancel}
        </Button>
        <Button type="submit" disabled={busy || picked.size === 0}>
          {msg().transfer.importCount(picked.size)}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** A chosen folder holds several Bruno collections: pick which to import (decision 107). */
export function BrunoPickDialog() {
  const choice = useTransferStore((s) => s.brunoChoice)
  return (
    <Dialog
      open={choice !== null}
      onOpenChange={(o) => !o && useTransferStore.getState().cancelBrunoChoice()}
    >
      <DialogContent className="sm:max-w-xl" data-testid="bruno-pick-dialog">
        {choice && <BrunoPickForm key={choice.scanId} choice={choice} />}
      </DialogContent>
    </Dialog>
  )
}

export function TransferResultDialog() {
  const result = useTransferStore((s) => s.result)
  const close = () => useTransferStore.getState().closeResult()
  return (
    <Dialog open={result !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl" data-testid="transfer-result">
        <DialogHeader>
          <DialogTitle>{result?.title}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto text-sm">
          {result?.entries.map((entry, i) => (
            <section key={i} className="flex flex-col gap-1">
              <h3 className="truncate font-medium" title={entry.title}>
                {entry.title}
              </h3>
              {entry.error && (
                <p className="flex items-start gap-1.5 text-destructive">
                  <CircleX className="mt-0.5 size-4 shrink-0" />
                  {entry.error}
                </p>
              )}
              {entry.lines.map((line, j) => (
                <p key={j} className="break-all text-muted-foreground">
                  {line}
                </p>
              ))}
              {entry.warnings.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 rounded-md bg-muted/60 p-2">
                  {entry.warnings.map((w, j) => (
                    <li key={j} className="flex items-start gap-1.5 text-xs">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      <span className="break-all">{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={close}>{msg().common.ok}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/**
 * Drop Postman Collection / Environment or Bruno JSON files (or a text file with a cURL command)
 * anywhere on the Workspace window to import them (decision 68).
 */
export function FileDropZone({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<'div'>) {
  const [over, setOver] = useState(false)

  // Files dropped outside the zone (e.g. on a dialog) must not navigate the window.
  useEffect(() => {
    const prevent = (e: globalThis.DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <div
      {...rest}
      className={cn('relative', className)}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => {
        // Only when leaving the zone itself, not when moving between its children.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        void useTransferStore.getState().importDropped(Array.from(e.dataTransfer.files))
      }}
    >
      {children}
      {over && (
        <div
          className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/85 text-sm"
          data-testid="drop-overlay"
        >
          <FileDown className="size-8 text-primary" />
          <p className="font-medium">{msg().transfer.dropTitle}</p>
          <p className="text-muted-foreground">{msg().transfer.dropHint}</p>
        </div>
      )}
    </div>
  )
}
