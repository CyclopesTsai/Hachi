import { useState, type FormEvent } from 'react'
import { WORKSPACE_NAME_MAX } from '@shared/schemas/workspace'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
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
import { errorMessage } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'

export function RenameWorkspaceDialog({
  open,
  initialName,
  onOpenChange
}: {
  open: boolean
  initialName: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rename-workspace-dialog">
        {/* Remount the form each time so it starts from the current name. */}
        {open && <RenameForm initialName={initialName} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({ initialName, onDone }: { initialName: string; onDone: () => void }) {
  const renameWorkspace = useAppStore((s) => s.renameWorkspace)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await renameWorkspace(name.trim())
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>重新命名 Workspace</DialogTitle>
        <DialogDescription>只會變更顯示名稱，資料夾位置不變。</DialogDescription>
      </DialogHeader>
      <Input
        aria-label="Workspace 名稱"
        value={name}
        maxLength={WORKSPACE_NAME_MAX}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            取消
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy || !name.trim()}>
          儲存
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Confirms moving a Workspace folder to the system trash. */
export function DeleteWorkspaceDialog({
  target,
  onClose
}: {
  target: { name: string; path: string } | null
  onClose: () => void
}) {
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)
  const [error, setError] = useState<string | null>(null)

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
    >
      <AlertDialogContent data-testid="delete-workspace-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>刪除 Workspace「{target?.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            整個資料夾（包含所有 Collections、環境與歷史紀錄）會移到系統垃圾桶：
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{target?.path}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault() // keep the dialog open until the result is known
              if (!target) return
              deleteWorkspace(target.path)
                .then(onClose)
                .catch((err: unknown) => setError(errorMessage(err)))
            }}
          >
            移到垃圾桶
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
