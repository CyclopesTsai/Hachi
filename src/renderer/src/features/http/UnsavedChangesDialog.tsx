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
import { useEditorStore } from '@renderer/stores/editor-store'

/** Asks what to do with unsaved edits before switching items or re-reading files. */
export function UnsavedChangesDialog() {
  const pending = useEditorStore((s) => s.pending)
  const resolvePending = useEditorStore((s) => s.resolvePending)
  const isReload = pending?.type === 'reload'

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && void resolvePending('cancel')}
    >
      <AlertDialogContent data-testid="unsaved-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{isReload ? '放棄未儲存的修改？' : '要儲存修改嗎？'}</AlertDialogTitle>
          <AlertDialogDescription>
            {isReload
              ? '重新讀取會以磁碟上的檔案內容取代目前未儲存的修改。'
              : '目前開啟的項目有未儲存的修改。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          {isReload ? (
            <AlertDialogAction variant="destructive" onClick={() => void resolvePending('discard')}>
              放棄並重新讀取
            </AlertDialogAction>
          ) : (
            <>
              <Button variant="outline" onClick={() => void resolvePending('discard')}>
                不儲存
              </Button>
              <AlertDialogAction onClick={() => void resolvePending('save')}>
                儲存
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
