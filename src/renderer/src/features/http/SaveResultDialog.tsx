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
        <DialogTitle>儲存結果</DialogTitle>
        <DialogDescription>
          把這次的請求與回應存在請求底下（唯讀，會跟著 Workspace 進 git）。機密變數的值會換回
          {' {{名稱}}'}，Authorization、Cookie 等憑證 Header 會隱藏。
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
        <Label htmlFor="save-result-name">名稱</Label>
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
          取消
        </Button>
        <Button type="submit" disabled={busy || name.trim() === ''}>
          儲存
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
      ? '請先儲存請求，才能把結果存在它底下'
      : tooLarge
        ? `回應超過 ${EXAMPLE_BODY_MAX_BYTES / 1024 / 1024} MB，無法儲存結果`
        : null
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid="save-result"
        disabled={reason !== null}
        title={reason ?? '把這次的請求與回應存在請求底下'}
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus />
        儲存結果
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
