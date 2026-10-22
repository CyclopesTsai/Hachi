import { BookmarkPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { HttpResponseData } from '@shared/http'
import { ITEM_NAME_MAX } from '@shared/schemas/collection'
import { EXAMPLE_BODY_MAX_BYTES } from '@shared/schemas/example'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { errorMessage } from '@renderer/lib/ipc'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import type { RequestTab } from '@renderer/features/tabs/tab-model'
import { msg } from '@shared/i18n'

const pad = (n: number) => String(n).padStart(2, '0')

/** "200 OK · 2026/10/20 18:30" */
function defaultResultName(result: HttpResponseData, now = new Date()): string {
  const status = `${result.status} ${result.statusText}`.trim()
  const date = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`
  const when = `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  return `${status} · ${when}`
}

function SaveResultForm({
  requestId,
  result,
  onClose
}: {
  requestId: string
  result: HttpResponseData
  onClose: () => void
}) {
  const [name, setName] = useState(() => defaultResultName(result))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const id = await useTreeStore.getState().saveExample(requestId, result.runId, name)
      onClose()
      useTabsStore.getState().openExample(id, { preview: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{msg().http.saveResult.title}</DialogTitle>
        <DialogDescription>{msg().http.saveResult.description}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
        <Label htmlFor="save-result-name">{msg().http.saveResult.name}</Label>
        <Input
          id="save-result-name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          maxLength={ITEM_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {msg().common.cancel}
        </Button>
        <Button type="submit" disabled={busy || name.trim() === ''}>
          {msg().common.save}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * 「儲存結果」 in the response area (decision 140): only for saved requests, and for
 * bodies up to 1 MB.
 */
export function SaveResultButton({ tab, result }: { tab: RequestTab; result: HttpResponseData }) {
  const [open, setOpen] = useState(false)
  const tooLarge = result.bodyBytes > EXAMPLE_BODY_MAX_BYTES
  const reason =
    tab.itemId === null
      ? msg().http.saveResult.saveRequestFirst
      : tooLarge
        ? msg().http.saveResult.tooLarge(EXAMPLE_BODY_MAX_BYTES / 1024 / 1024)
        : null
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid="save-result"
        disabled={reason !== null}
        title={reason ?? msg().http.saveResult.buttonTitle}
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus />
        {msg().http.saveResult.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="save-result-dialog">
          {open && tab.itemId && (
            <SaveResultForm requestId={tab.itemId} result={result} onClose={() => setOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
