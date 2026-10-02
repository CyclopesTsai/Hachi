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
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useTransferStore } from '@renderer/stores/transfer-store'

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
        <DialogTitle>匯入 cURL</DialogTitle>
        <DialogDescription>
          貼上 cURL 指令（例如瀏覽器開發者工具的「Copy as cURL」），會開成未儲存的新分頁。
        </DialogDescription>
      </DialogHeader>
      <textarea
        autoFocus
        aria-label="cURL 指令"
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
          取消
        </Button>
        <Button type="submit" disabled={text.trim() === ''}>
          匯入
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
          <Button onClick={close}>確定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/**
 * Drop Postman Collection / Environment files (or a text file with a cURL command)
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
          <p className="font-medium">放開以匯入</p>
          <p className="text-muted-foreground">
            Postman Collection / Environment（.json），或內容是 cURL 指令的文字檔
          </p>
        </div>
      )}
    </div>
  )
}
