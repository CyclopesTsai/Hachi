import { FileWarning } from 'lucide-react'
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

/** {{$file:…}} wants files outside the Workspace folder: asked once per Workspace (decision 134). */
export function FileTrustDialog() {
  const prompt = useTabsStore((s) => s.fileTrustPrompt)
  const workspace = useAppStore((s) => s.currentWorkspace)
  const choose = (allow: boolean) => useTabsStore.getState().fileTrustPrompt?.resolve(allow)
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && choose(false)}>
      <DialogContent data-testid="file-trust-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="size-5 text-primary" />
            允許讀取 Workspace 以外的檔案？
          </DialogTitle>
          <DialogDescription>
            這個請求用 {'{{$file:…}}'} 讀取下列檔案，內容會送到請求的伺服器。
            {workspace ? `「${workspace.name}」` : '這個 Workspace '}
            的請求可能來自匯入的檔案或 git，請確認來源可信。
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 list-disc overflow-auto pl-5 font-mono text-xs break-all">
          {prompt?.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Workspace 資料夾內的檔案不需要允許。選擇只記在這台電腦，之後可在 Workspace 設定取消。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => choose(false)}>
            取消
          </Button>
          <Button onClick={() => choose(true)}>允許並送出</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
