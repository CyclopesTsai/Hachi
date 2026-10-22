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
import { msg } from '@shared/i18n'

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
            {msg().http.scriptTrust.title}
          </DialogTitle>
          <DialogDescription>
            {msg().http.scriptTrust.description(workspace?.name ?? null)}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>{msg().http.scriptTrust.sandbox}</li>
          <li>{msg().http.scriptTrust.variables}</li>
          <li>{msg().http.scriptTrust.remembered}</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => choose('cancel')}>
            {msg().common.cancel}
          </Button>
          <Button variant="outline" onClick={() => choose('skip')}>
            {msg().http.scriptTrust.skip}
          </Button>
          <Button onClick={() => choose('trust')}>{msg().http.scriptTrust.trust}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
