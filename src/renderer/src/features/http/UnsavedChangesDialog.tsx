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
import { isDraftTab, isTabDirty, tabTitle } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useMockStore } from '@renderer/stores/mock-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { isLive, useWsStore } from '@renderer/stores/ws-store'
import { msg } from '@shared/i18n'

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
  const sessions = useWsStore((s) => s.sessions)
  const affected = tabs.filter((t) => prompt?.keys.includes(t.key))
  const dirty = affected.filter(isTabDirty)
  const hasDrafts = dirty.some(isDraftTab)
  const live = (t: (typeof affected)[number]) => t.kind === 'websocket' && isLive(sessions[t.uid])
  // Only connected WebSocket tabs, nothing to save: just confirm the disconnect.
  const disconnectOnly = !isReload && dirty.length === 0

  return (
    <AlertDialog
      open={prompt !== null}
      onOpenChange={(open) => !open && void resolvePrompt('cancel')}
    >
      <AlertDialogContent data-testid="unsaved-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isReload
              ? msg().http.prompt.reloadTitle
              : disconnectOnly
                ? msg().http.prompt.disconnectTitle
                : msg().http.prompt.saveTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isReload
              ? msg().http.prompt.reloadDescription
              : disconnectOnly
                ? msg().http.prompt.disconnectDescription
                : msg().http.prompt.saveDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 list-disc overflow-auto pl-6 text-sm" data-testid="unsaved-list">
          {affected.map((t) => (
            <li key={t.key}>
              {tabTitle(t, tree, useMockStore.getState().list)}
              {isTabDirty(t) && isDraftTab(t) && (
                <span className="text-muted-foreground">{msg().http.prompt.newRequest}</span>
              )}
              {!isReload && live(t) && (
                <span className="text-muted-foreground">
                  {msg().http.prompt.connected(isTabDirty(t))}
                </span>
              )}
            </li>
          ))}
        </ul>
        {!isReload && hasDrafts && (
          <p className="text-xs text-muted-foreground">{msg().http.prompt.draftsLost}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{msg().common.cancel}</AlertDialogCancel>
          {isReload ? (
            <AlertDialogAction variant="destructive" onClick={() => void resolvePrompt('discard')}>
              {msg().http.prompt.discardReload}
            </AlertDialogAction>
          ) : disconnectOnly ? (
            <AlertDialogAction variant="destructive" onClick={() => void resolvePrompt('discard')}>
              {msg().http.prompt.disconnectClose}
            </AlertDialogAction>
          ) : (
            <>
              <Button variant="outline" onClick={() => void resolvePrompt('discard')}>
                {msg().http.prompt.dontSave}
              </Button>
              <AlertDialogAction onClick={() => void resolvePrompt('save')}>
                {dirty.length > 1 ? msg().http.prompt.saveAll : msg().common.save}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
