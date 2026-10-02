import { ArrowLeftRight, ChevronDown, Pencil, Settings, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorkspaceInfo } from '@shared/ipc/api'
import { AppLogo } from '@renderer/components/app-logo'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { CollectionSidebar } from '@renderer/features/collections/CollectionSidebar'
import { EditorHost } from '@renderer/features/http/EditorHost'
import { WorkspaceSettingsDialog } from '@renderer/features/settings/SettingsDialogs'
import { useAppStore } from '@renderer/stores/app-store'
import { DeleteWorkspaceDialog, RenameWorkspaceDialog } from './WorkspaceDialogs'

/** Main layout once a Workspace is open: header, Collection tree, item panel. */
export function WorkspaceShell({ workspace }: { workspace: WorkspaceInfo }) {
  const showWelcome = useAppStore((s) => s.showWelcome)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loadWorkspaceSettings = useAppStore((s) => s.loadWorkspaceSettings)

  useEffect(() => {
    void loadWorkspaceSettings()
  }, [workspace.id, loadWorkspaceSettings])

  return (
    <div className="flex h-full flex-col" data-testid="workspace-shell">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <AppLogo />
        <span className="text-muted-foreground">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 gap-1 px-2"
              data-testid="workspace-menu"
            >
              <span className="truncate font-medium" data-testid="current-workspace-name">
                {workspace.name}
              </span>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil />
              重新命名 Workspace…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings />
              Workspace 設定…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => showWelcome()}>
              <ArrowLeftRight />
              切換 Workspace…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              <Trash2 />
              刪除 Workspace…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground lg:inline"
          title={workspace.path}
        >
          {workspace.path}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <CollectionSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <EditorHost />
        </main>
      </div>

      <RenameWorkspaceDialog
        open={renaming}
        initialName={workspace.name}
        onOpenChange={setRenaming}
      />
      <WorkspaceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <DeleteWorkspaceDialog
        target={deleting ? workspace : null}
        onClose={() => setDeleting(false)}
      />
    </div>
  )
}
