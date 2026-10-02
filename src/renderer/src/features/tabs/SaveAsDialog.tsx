import { useMemo, useState, type FormEvent } from 'react'
import { ITEM_NAME_MAX } from '@shared/schemas/collection'
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
import { NativeSelect } from '@renderer/components/ui/native-select'
import { errorMessage } from '@renderer/lib/ipc'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { containerOptions, type RequestTab } from './tab-model'

function SaveAsForm({ tab }: { tab: RequestTab }) {
  const tree = useTreeStore((s) => s.tree)
  const options = useMemo(() => containerOptions(tree), [tree])
  const [name, setName] = useState(tab.draft?.name ?? tab.draftName)
  const [parentId, setParentId] = useState(
    options.find((o) => o.id === tab.draftParentId)?.id ?? options[0]?.id ?? ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await useTabsStore.getState().commitSaveAs(parentId, name)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>儲存請求</DialogTitle>
        <DialogDescription>選擇要放進哪個 Collection / 資料夾。</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
        <Label htmlFor="save-as-name">名稱</Label>
        <Input
          id="save-as-name"
          autoFocus
          maxLength={ITEM_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Label htmlFor="save-as-parent">位置</Label>
        {options.length > 0 ? (
          <NativeSelect
            id="save-as-parent"
            data-testid="save-as-parent"
            className="h-9"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <p className="text-sm text-muted-foreground">請先在左側建立一個 Collection。</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => useTabsStore.getState().cancelSaveAs()}
        >
          取消
        </Button>
        <Button type="submit" disabled={busy || !parentId || name.trim() === ''}>
          儲存
        </Button>
      </DialogFooter>
    </form>
  )
}

/** "Save As" for unsaved requests (new tab, history, deleted item). */
export function SaveAsDialog() {
  const tab = useTabsStore((s) => {
    const key = s.saveAs?.key
    const found = key ? s.tabs.find((t) => t.key === key) : undefined
    return found?.kind === 'request' ? found : undefined
  })
  return (
    <Dialog
      open={tab !== undefined}
      onOpenChange={(open) => !open && useTabsStore.getState().cancelSaveAs()}
    >
      <DialogContent data-testid="save-as-dialog">
        {tab && <SaveAsForm key={tab.key} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
