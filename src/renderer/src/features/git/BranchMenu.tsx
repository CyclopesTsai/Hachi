import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  History,
  Link,
  Loader2,
  Plus,
  RefreshCw
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { GitBranch as Branch } from '@shared/git'
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { useAppStore } from '@renderer/stores/app-store'
import { useGitStore } from '@renderer/stores/git-store'
import { gitInstallHint } from './git-names'
import { msg } from '@shared/i18n'

/** origin's URL (decision 113): needed before the first push of a new repository. */
function RemoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="git-remote-dialog">
        {/* A fresh form each time it opens. */}
        {open && <RemoteForm onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function RemoteForm({ onClose }: { onClose: () => void }) {
  const remote = useGitStore((s) => s.remote)
  const busy = useGitStore((s) => s.busy)
  const [url, setUrl] = useState('')

  useEffect(() => {
    // The current URL arrives later (git runs first): don't overwrite what was typed meanwhile.
    void useGitStore
      .getState()
      .loadRemote()
      .then(() => setUrl((typed) => typed || (useGitStore.getState().remote?.url ?? '')))
  }, [])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (await useGitStore.getState().setRemote(url.trim())) onClose()
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{msg().git.remoteTitle}</DialogTitle>
        <DialogDescription>
          {remote ? msg().git.remoteNow(remote.name, remote.url) : msg().git.remoteNone}
        </DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        aria-label={msg().git.remoteUrl}
        placeholder={msg().git.remotePlaceholder}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {msg().common.cancel}
        </Button>
        <Button type="submit" disabled={busy || url.trim() === ''}>
          {msg().common.save}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CreateBranchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const busy = useGitStore((s) => s.busy)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (await useGitStore.getState().createBranch(name.trim())) {
      setName('')
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="git-create-branch-dialog">
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{msg().git.branchTitle}</DialogTitle>
            <DialogDescription>{msg().git.branchDescription}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={msg().git.branchName}
            placeholder={msg().git.branchPlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {msg().common.cancel}
            </Button>
            <Button type="submit" disabled={busy || name.trim() === ''}>
              {msg().git.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Header: Git icon and the current branch (decision 115, like IntelliJ); the menu
 * switches to another branch or creates one. Hidden outside a Git repository.
 */
/** Outside a repository: a "Git" button offering git init, or how to install git. */
function NoRepoMenu({ missing }: { missing: boolean }) {
  const platform = useAppStore((s) => s.info?.platform)
  return (
    <DropdownMenu onOpenChange={(open) => open && void useGitStore.getState().refresh()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" data-testid="git-menu">
          <GitBranch className="text-muted-foreground" />
          Git
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {missing ? (
          <div className="flex flex-col gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{msg().git.missingTitle}</p>
            <p>{msg().git.missingMenu(gitInstallHint(platform))}</p>
            <p>{msg().git.reopenMenu}</p>
          </div>
        ) : (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{msg().git.notRepoMenu}</div>
            <DropdownMenuItem onSelect={() => void useGitStore.getState().init()}>
              <GitBranch />
              {msg().git.init}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function BranchMenu() {
  const status = useGitStore((s) => s.status)
  const branches = useGitStore((s) => s.branches)
  const running = useGitStore((s) => s.running)
  const [creating, setCreating] = useState(false)
  const [editingRemote, setEditingRemote] = useState(false)
  const [confirm, setConfirm] = useState<Branch | null>(null)
  if (status === null) return null
  if (status.state !== 'repo') return <NoRepoMenu missing={status.state === 'no-git'} />

  const changes = status.files.length
  // The current branch comes from the latest status: the list may still be loading.
  const isCurrent = (b: Branch) => !b.remote && b.name === status.branch
  const pick = (branch: Branch) => {
    if (isCurrent(branch)) return
    // Uncommitted changes come along to the other branch (git refuses if they clash).
    if (changes > 0) setConfirm(branch)
    else void useGitStore.getState().switchBranch(branch.name, branch.remote)
  }
  const local = branches.filter((b) => !b.remote)
  const remote = branches.filter((b) => b.remote)

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return
          void useGitStore.getState().loadBranches()
          void useGitStore.getState().refresh()
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-1.5 px-2"
            data-testid="branch-menu"
            title={status.upstream ? msg().git.tracking(status.upstream) : msg().git.currentBranch}
          >
            {running ? (
              <Loader2 className="animate-spin text-muted-foreground" />
            ) : (
              <GitBranch className="text-muted-foreground" />
            )}
            <span className="truncate" data-testid="current-branch">
              {status.branch ?? `HEAD ${status.head ?? ''}`}
            </span>
            {(status.ahead > 0 || status.behind > 0) && (
              <span className="flex items-center text-xs text-muted-foreground">
                {status.ahead > 0 && `↑${status.ahead}`}
                {status.behind > 0 && `↓${status.behind}`}
              </span>
            )}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] min-w-56 overflow-auto">
          <DropdownMenuItem onSelect={() => useGitStore.getState().openView('commit')}>
            <GitCommitHorizontal />
            Commit…
            {changes > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {msg().git.changeCount(changes)}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useGitStore.getState().openView('history')}>
            <History />
            History…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!status.hasRemote || running !== null}
            onSelect={() => void useGitStore.getState().fetch()}
          >
            <RefreshCw />
            Fetch
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!status.hasRemote || running !== null || status.merging}
            onSelect={() => void useGitStore.getState().pull()}
          >
            <ArrowDownToLine />
            Pull
            {status.behind > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {msg().git.commitCount(status.behind)}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!status.hasRemote || running !== null || status.empty}
            onSelect={() => void useGitStore.getState().push()}
          >
            <ArrowUpFromLine />
            Push
            {status.ahead > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {msg().git.commitCount(status.ahead)}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditingRemote(true)}>
            <Link />
            {msg().git.setRemote}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            {msg().git.createBranch}
          </DropdownMenuItem>
          {local.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {msg().git.localBranches}
              </div>
              {local.map((b) => (
                <DropdownMenuItem key={b.name} onSelect={() => pick(b)} data-testid="branch-item">
                  {isCurrent(b) ? <Check /> : <span className="size-4" />}
                  <span className="truncate">{b.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {remote.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {msg().git.remoteBranches}
              </div>
              {remote.map((b) => (
                <DropdownMenuItem key={b.name} onSelect={() => pick(b)}>
                  <span className="size-4" />
                  <span className="truncate">{b.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateBranchDialog open={creating} onClose={() => setCreating(false)} />
      <RemoteDialog open={editingRemote} onClose={() => setEditingRemote(false)} />
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent data-testid="git-switch-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{msg().git.switchTitle(confirm?.name ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>{msg().git.switchDescription(changes)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{msg().common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) void useGitStore.getState().switchBranch(confirm.name, confirm.remote)
              }}
            >
              {msg().git.switch}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
