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
import { msg } from '@shared/i18n'

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
            {msg().http.fileTrust.title}
          </DialogTitle>
          <DialogDescription>
            {msg().http.fileTrust.description(workspace?.name ?? null)}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 list-disc overflow-auto pl-5 font-mono text-xs break-all">
          {prompt?.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{msg().http.fileTrust.hint}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => choose(false)}>
            {msg().common.cancel}
          </Button>
          <Button onClick={() => choose(true)}>{msg().http.fileTrust.allow}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
