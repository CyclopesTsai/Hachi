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
import { isDraftTab, tabTitle } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'

/**
 * Asks what to do with unsaved tabs before closing them, leaving the Workspace,
 * closing the window or re-reading files.
 */
export function UnsavedChangesDialog() {
  const prompt = useTabsStore((s) => s.prompt)
  const tabs = useTabsStore((s) => s.tabs)
  const tree = useTreeStore((s) => s.tree)
  const resolvePrompt = useTabsStore((s) => s.resolvePrompt)
  const isReload = prompt?.mode === 'discard'
  const affected = tabs.filter((t) => prompt?.keys.includes(t.key))
  const hasDrafts = affected.some(isDraftTab)

  return (
    <AlertDialog
      open={prompt !== null}
      onOpenChange={(open) => !open && void resolvePrompt('cancel')}
    >
      <AlertDialogContent data-testid="unsaved-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{isReload ? '放棄未儲存的修改？' : '要儲存修改嗎？'}</AlertDialogTitle>
          <AlertDialogDescription>
            {isReload
              ? '重新讀取會以磁碟上的檔案內容取代下列分頁未儲存的修改：'
              : '下列分頁有未儲存的修改：'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 list-disc overflow-auto pl-6 text-sm" data-testid="unsaved-list">
          {affected.map((t) => (
            <li key={t.key}>
              {tabTitle(t, tree)}
              {isDraftTab(t) && (
                <span className="text-muted-foreground">（新請求，儲存時會詢問位置）</span>
              )}
            </li>
          ))}
        </ul>
        {!isReload && hasDrafts && (
          <p className="text-xs text-muted-foreground">選擇「不儲存」時，新請求的內容會遺失。</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          {isReload ? (
            <AlertDialogAction variant="destructive" onClick={() => void resolvePrompt('discard')}>
              放棄並重新讀取
            </AlertDialogAction>
          ) : (
            <>
              <Button variant="outline" onClick={() => void resolvePrompt('discard')}>
                不儲存
              </Button>
              <AlertDialogAction onClick={() => void resolvePrompt('save')}>
                {affected.length > 1 ? '全部儲存' : '儲存'}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
