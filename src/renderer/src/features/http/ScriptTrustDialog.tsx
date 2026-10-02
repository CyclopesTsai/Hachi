import { ShieldQuestion } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useAppStore } from '@renderer/stores/app-store'
import { useTabsStore } from '@renderer/stores/tabs-store'

/** Asked once per Workspace before its scripts run (decision 84). */
export function ScriptTrustDialog() {
  const prompt = useTabsStore((s) => s.trustPrompt)
  const workspace = useAppStore((s) => s.currentWorkspace)
  const choose = useTabsStore.getState().resolveTrust
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && choose('cancel')}>
      <DialogContent data-testid="script-trust-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="size-5 text-primary" />
            信任這個 Workspace 的腳本？
          </DialogTitle>
          <DialogDescription>
            這個請求有 Pre-request / Post-response 腳本。
            {workspace ? `「${workspace.name}」` : '這個 Workspace '}
            的腳本可能來自匯入的檔案或 git，請確認來源可信。
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>腳本在沙箱中執行，無法讀寫檔案或連網。</li>
          <li>腳本可以讀取與修改變數（包含機密值），修改會顯示在回應的 Tests 分頁。</li>
          <li>選擇只記在這台電腦，之後可在 Workspace 設定取消。</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => choose('cancel')}>
            取消
          </Button>
          <Button variant="outline" onClick={() => choose('skip')}>
            這次不執行腳本
          </Button>
          <Button onClick={() => choose('trust')}>信任並執行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
