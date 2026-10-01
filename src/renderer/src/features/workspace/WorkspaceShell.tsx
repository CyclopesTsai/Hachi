import { ArrowLeftRight, FolderTree } from 'lucide-react'
import type { WorkspaceInfo } from '@shared/ipc/api'
import { AppLogo } from '@renderer/components/app-logo'
import { Button } from '@renderer/components/ui/button'
import { useAppStore } from '@renderer/stores/app-store'

/**
 * Main layout once a Workspace is open. Phase 0 only shows the frame;
 * the Collection tree (Phase 1) and request editors (Phase 2+) plug in here.
 */
export function WorkspaceShell({ workspace }: { workspace: WorkspaceInfo }) {
  const showWelcome = useAppStore((s) => s.showWelcome)

  return (
    <div className="flex h-full flex-col" data-testid="workspace-shell">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <AppLogo />
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-sm font-medium" data-testid="current-workspace-name">
          {workspace.name}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => showWelcome()}>
          <ArrowLeftRight />
          切換 Workspace
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/40">
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <FolderTree className="size-3.5" />
            Collections
          </div>
          <p className="px-3 text-sm text-muted-foreground">
            Collection 樹狀清單將於 Phase 1 加入。
          </p>
        </aside>

        <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-lg font-medium">Workspace 已就緒</p>
          <p
            className="max-w-md font-mono text-xs break-all text-muted-foreground"
            title={workspace.path}
          >
            {workspace.path}
          </p>
        </main>
      </div>
    </div>
  )
}
