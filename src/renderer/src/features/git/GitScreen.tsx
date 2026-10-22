import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  ArrowUpFromLine,
  ChevronRight,
  Folder,
  GitBranch,
  List,
  ListTree,
  Loader2,
  RefreshCw,
  Undo2
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { GitChangeKind, GitFileChange, GitRepoStatus } from '@shared/git'
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
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { CheckboxLabel } from '@renderer/components/ui/native-select'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/stores/app-store'
import { useGitStore } from '@renderer/stores/git-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { buildChangeTree, type ChangeFolder, type ChangeNode } from './change-tree'
import { DiffView } from './DiffView'
import { GitHistory } from './GitHistory'
import { fileIndex, gitInstallHint, labelFor, type FileLabel } from './git-names'
import { msg } from '@shared/i18n'

/** While the Git screen is open, changes made by saving files show up without a click. */
const POLL_MS = 4000

const KINDS: Record<GitChangeKind, { letter: string; className: string }> = {
  modified: { letter: 'M', className: 'text-amber-600 dark:text-amber-400' },
  added: { letter: 'A', className: 'text-emerald-600 dark:text-emerald-400' },
  untracked: { letter: 'U', className: 'text-emerald-600 dark:text-emerald-400' },
  deleted: { letter: 'D', className: 'text-red-600 dark:text-red-400' },
  renamed: { letter: 'R', className: 'text-sky-600 dark:text-sky-400' },
  conflicted: { letter: '!', className: 'text-red-600 dark:text-red-400' }
}

function NoGit() {
  const platform = useAppStore((s) => s.info?.platform)
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3 text-sm text-muted-foreground"
      data-testid="git-missing"
    >
      <p>{msg().git.missing(gitInstallHint(platform))}</p>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => void useGitStore.getState().refresh()}
      >
        <RefreshCw />
        {msg().git.detectAgain}
      </Button>
    </div>
  )
}

function NotRepo() {
  const busy = useGitStore((s) => s.busy)
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3 text-sm text-muted-foreground"
      data-testid="git-not-repo"
    >
      <p>{msg().git.notRepo}</p>
      <p className="text-xs">{msg().git.notRepoHint}</p>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={() => void useGitStore.getState().init()}
      >
        {msg().git.init}
      </Button>
    </div>
  )
}

function FileRow({
  file,
  label,
  checked,
  selected,
  onDiscard,
  depth = 0,
  name
}: {
  file: GitFileChange
  label: FileLabel
  checked: boolean
  selected: boolean
  onDiscard: () => void
  /** Tree view: indentation level, and the short name inside its folder. */
  depth?: number
  name?: string
}) {
  const kind = { ...KINDS[file.kind], label: msg().git.kinds[file.kind] }
  const open = () => {
    if (!label.itemId) return
    useGitStore.getState().closeView()
    useTabsStore.getState().openItem(label.itemId)
  }
  return (
    // The whole row selects the file (decision 122: no dead spots between its parts).
    <li
      className={cn(
        'group flex h-7 cursor-default items-center gap-1.5 rounded-sm pr-1 text-sm hover:bg-accent/70',
        selected && 'bg-accent'
      )}
      style={{ paddingLeft: 4 + depth * 20 }}
      aria-selected={selected}
      data-testid="git-file"
      data-path={file.path}
      title={`${file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}${label.itemId ? msg().git.openHint : ''}`}
      onClick={() => void useGitStore.getState().select(file.path)}
      onDoubleClick={open}
    >
      <input
        type="checkbox"
        className="size-3.5 shrink-0 accent-primary"
        aria-label={`Commit ${label.title}`}
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={() => useGitStore.getState().toggle(file.path)}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-baseline gap-1.5 self-stretch text-left"
        onClick={(e) => {
          e.stopPropagation()
          void useGitStore.getState().select(file.path)
        }}
      >
        <span className="my-auto truncate">{name ?? label.title}</span>
        {name === undefined && (
          <span className="my-auto truncate text-[11px] text-muted-foreground">
            {file.path.slice(0, file.path.lastIndexOf('/') + 1)}
          </span>
        )}
      </button>
      {file.kind !== 'conflicted' && (
        <button
          type="button"
          className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground"
          title={msg().git.discardTitle}
          aria-label={msg().git.discardLabel(label.title)}
          onClick={(e) => {
            e.stopPropagation()
            onDiscard()
          }}
        >
          <Undo2 className="size-3.5" />
        </button>
      )}
      <span
        className={cn(
          'w-3 shrink-0 text-center font-mono text-[11px] font-semibold',
          kind.className
        )}
        title={kind.label}
      >
        {kind.letter}
      </span>
    </li>
  )
}

/** A folder of the tree view: open / close, and check every file below at once. */
function FolderRow({
  folder,
  depth,
  open,
  onToggle
}: {
  folder: ChangeFolder
  depth: number
  open: boolean
  onToggle: () => void
}) {
  const unchecked = useGitStore((s) => s.unchecked)
  const checkedCount = folder.paths.filter((p) => !unchecked.has(p)).length
  return (
    <li
      className="flex h-7 cursor-default items-center gap-1.5 rounded-sm pr-1 text-sm hover:bg-accent/70"
      style={{ paddingLeft: 4 + depth * 20 }}
      data-testid="git-folder"
      title={folder.key}
      onClick={onToggle}
    >
      <input
        type="checkbox"
        className="size-3.5 shrink-0 accent-primary"
        aria-label={msg().git.commitFolder(folder.name)}
        checked={checkedCount === folder.paths.length}
        ref={(el) => {
          if (el) el.indeterminate = checkedCount > 0 && checkedCount < folder.paths.length
        }}
        onClick={(e) => e.stopPropagation()}
        onChange={() =>
          useGitStore.getState().setChecked(folder.paths, checkedCount !== folder.paths.length)
        }
      />
      <ChevronRight
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-90'
        )}
      />
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{folder.paths.length}</span>
    </li>
  )
}

function DiscardDialog({
  target,
  onClose
}: {
  target: { file: GitFileChange; label: FileLabel } | null
  onClose: () => void
}) {
  const isNew = target?.file.kind === 'untracked' || target?.file.kind === 'added'
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="git-discard-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{msg().git.discardConfirm(target?.label.title ?? '')}</AlertDialogTitle>
          <AlertDialogDescription>
            {isNew ? msg().git.discardNew : msg().git.discardModified}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
          {target?.file.path}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel>{msg().common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (target) void useGitStore.getState().discard(target.file.path, target.label.itemId)
            }}
          >
            {msg().git.discard}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** user.name / user.email are missing: asked once, then the commit continues. */
function IdentityDialog() {
  const open = useGitStore((s) => s.askIdentity)
  const busy = useGitStore((s) => s.busy)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [global, setGlobal] = useState(false)

  function submit(e: FormEvent): void {
    e.preventDefault()
    void useGitStore.getState().saveIdentity({ name: name.trim(), email: email.trim() }, global)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useGitStore.getState().cancelIdentity()}>
      <DialogContent data-testid="git-identity-dialog">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{msg().git.identityTitle}</DialogTitle>
            <DialogDescription>{msg().git.identityDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-name">{msg().git.name}</Label>
            <Input id="git-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-email">Email</Label>
            <Input
              id="git-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <CheckboxLabel checked={global} onChange={(e) => setGlobal(e.target.checked)}>
            {msg().git.identityGlobal}
          </CheckboxLabel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => useGitStore.getState().cancelIdentity()}
            >
              {msg().common.cancel}
            </Button>
            <Button type="submit" disabled={busy || name.trim() === '' || email.trim() === ''}>
              {msg().git.saveAndCommit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RepoScreen({ status }: { status: GitRepoStatus }) {
  const tree = useTreeStore((s) => s.tree)
  const message = useGitStore((s) => s.message)
  const unchecked = useGitStore((s) => s.unchecked)
  const busy = useGitStore((s) => s.busy)
  const selected = useGitStore((s) => s.selected)
  const diff = useGitStore((s) => s.diff)
  const [discarding, setDiscarding] = useState<{ file: GitFileChange; label: FileLabel } | null>(
    null
  )
  const index = useMemo(() => fileIndex(tree), [tree])
  const treeView = useAppStore((s) => s.config?.ui.gitChangesTree ?? true)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const changeTree = useMemo(() => buildChangeTree(status.files, tree), [status.files, tree])
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const renderTree = (nodes: ChangeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      if (node.kind === 'folder') {
        const open = !closed.has(node.key)
        return [
          <FolderRow
            key={`d:${node.key}`}
            folder={node}
            depth={depth}
            open={open}
            onToggle={() =>
              setClosed((prev) => {
                const next = new Set(prev)
                if (open) next.add(node.key)
                else next.delete(node.key)
                return next
              })
            }
          />,
          ...(open ? renderTree(node.children, depth + 1) : [])
        ]
      }
      const label = labelFor(index, node.file.path)
      return [
        <FileRow
          key={node.key}
          file={node.file}
          label={label}
          name={node.name}
          depth={depth}
          checked={!unchecked.has(node.file.path)}
          selected={selected === node.file.path}
          onDiscard={() => setDiscarding({ file: node.file, label })}
        />
      ]
    })
  const committing = useGitStore((s) => s.committing)
  const checkedCount = status.files.filter((f) => !unchecked.has(f.path)).length
  const selectedChange = status.files.find((f) => f.path === selected)
  const allChecked = status.files.length > 0 && checkedCount === status.files.length

  return (
    <div className="flex min-h-0 flex-1" data-testid="git-panel">
      <aside className="flex w-96 shrink-0 flex-col gap-2 border-r bg-muted/40 p-2">
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground" data-testid="git-branch">
            {status.branch ?? `HEAD ${status.head ?? ''}`}
          </span>
          {status.upstream && (status.ahead > 0 || status.behind > 0) && (
            <span
              className="flex shrink-0 items-center gap-1"
              title={msg().git.relativeTo(status.upstream)}
            >
              {status.ahead > 0 && (
                <span className="flex items-center">
                  <ArrowUp className="size-3" />
                  {status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center">
                  <ArrowDown className="size-3" />
                  {status.behind}
                </span>
              )}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            title={msg().git.refresh}
            aria-label={msg().git.refreshStatus}
            onClick={() => void useGitStore.getState().refresh()}
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {msg().git.changes(status.files.length)}
          </span>
          <div className="flex-1" />
          {status.files.length > 0 && (
            <CheckboxLabel
              checked={allChecked}
              onChange={() => useGitStore.getState().setAll(!allChecked)}
            >
              {msg().git.selectAll}
            </CheckboxLabel>
          )}
          <div
            className="flex items-center rounded-md border"
            role="group"
            aria-label={msg().git.viewMode}
          >
            {(
              [
                [true, ListTree, msg().git.treeView],
                [false, List, msg().git.listView]
              ] as const
            ).map(([value, Icon, title]) => (
              <button
                key={title}
                type="button"
                title={title}
                aria-label={title}
                aria-pressed={treeView === value}
                data-testid={value ? 'git-view-tree' : 'git-view-list'}
                className={cn(
                  'p-1 text-muted-foreground hover:text-foreground',
                  treeView === value && 'bg-accent text-foreground'
                )}
                onClick={() => void updateConfig({ ui: { gitChangesTree: value } })}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
        {status.files.length === 0 ? (
          <p className="flex-1 px-1 text-sm text-muted-foreground" data-testid="git-clean">
            {msg().git.clean}
          </p>
        ) : (
          <ul
            className={cn(
              'min-h-0 flex-1 overflow-auto',
              committing && 'pointer-events-none opacity-60'
            )}
            aria-busy={committing}
          >
            {treeView
              ? renderTree(changeTree, 0)
              : status.files.map((file) => {
                  const label = labelFor(index, file.path)
                  return (
                    <FileRow
                      key={file.path}
                      file={file}
                      label={label}
                      checked={!unchecked.has(file.path)}
                      selected={selected === file.path}
                      onDiscard={() => setDiscarding({ file, label })}
                    />
                  )
                })}
          </ul>
        )}
        {status.merging ? (
          <MergeBox conflicts={status.files.filter((f) => f.kind === 'conflicted').length} />
        ) : (
          <>
            <textarea
              aria-label={msg().git.message}
              data-testid="git-message"
              disabled={committing}
              placeholder={msg().git.message}
              rows={4}
              value={message}
              onChange={(e) => useGitStore.getState().setMessage(e.target.value)}
              className="w-full shrink-0 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button
              size="sm"
              className="shrink-0"
              data-testid="git-commit"
              disabled={busy || checkedCount === 0 || message.trim() === ''}
              onClick={() => void useGitStore.getState().commit()}
            >
              {committing && <Loader2 className="animate-spin" />}
              {committing ? msg().git.committing : msg().git.commit(checkedCount)}
            </Button>
            {committing && (
              <p className="text-xs text-muted-foreground" data-testid="git-committing">
                {msg().git.committingHint(checkedCount)}
              </p>
            )}
          </>
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selectedChange?.kind === 'conflicted' && <ConflictBar path={selectedChange.path} />}
        {diff ? (
          <DiffView diff={diff} />
        ) : (
          <p className="m-auto text-sm text-muted-foreground">
            {selected ? msg().git.loading : msg().git.pickFile}
          </p>
        )}
      </section>
      <DiscardDialog target={discarding} onClose={() => setDiscarding(null)} />
    </div>
  )
}

/** Pull stopped on conflicts (decision 114): settle each file, then finish or abort. */
function MergeBox({ conflicts }: { conflicts: number }) {
  const busy = useGitStore((s) => s.busy)
  const [aborting, setAborting] = useState(false)
  return (
    <div
      className="flex shrink-0 flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
      data-testid="git-merge"
    >
      <p className="font-medium">
        {conflicts > 0 ? msg().git.merging(conflicts) : msg().git.mergeReady}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          data-testid="git-finish-merge"
          disabled={busy || conflicts > 0}
          onClick={() => void useGitStore.getState().finishMerge()}
        >
          {msg().git.finishMerge}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setAborting(true)}>
          {msg().git.abortMergeMenu}
        </Button>
      </div>
      <AlertDialog open={aborting} onOpenChange={setAborting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{msg().git.abortTitle}</AlertDialogTitle>
            <AlertDialogDescription>{msg().git.abortDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{msg().common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void useGitStore.getState().abortMerge()}
            >
              {msg().git.abortMerge}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Choices for the selected conflicted file (decision 114). */
function ConflictBar({ path }: { path: string }) {
  const busy = useGitStore((s) => s.busy)
  const resolve = (how: 'ours' | 'theirs' | 'resolved') =>
    void useGitStore.getState().resolve(path, how)
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-xs"
      data-testid="git-conflict"
    >
      <span className="font-medium">{msg().git.conflict}</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve('ours')}>
        {msg().git.ours}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve('theirs')}>
        {msg().git.theirs}
      </Button>
      <span className="text-muted-foreground">{msg().git.or}</span>
      <Button size="sm" variant="ghost" onClick={() => void useGitStore.getState().openFile(path)}>
        {msg().git.editExternally}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve('resolved')}>
        {msg().git.markResolved}
      </Button>
    </div>
  )
}

/** Fetch / Pull / Push in the Git screen's bar (decision 113). */
function RemoteButtons() {
  const status = useGitStore((s) => s.status)
  const running = useGitStore((s) => s.running)
  if (status?.state !== 'repo' || !status.hasRemote) return null
  const spin = (op: string) => (running === op ? <Loader2 className="animate-spin" /> : null)
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        data-testid="git-fetch"
        disabled={running !== null}
        onClick={() => void useGitStore.getState().fetch()}
      >
        {spin('fetch') ?? <RefreshCw />}
        Fetch
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="git-pull"
        disabled={running !== null || status.merging}
        onClick={() => void useGitStore.getState().pull()}
      >
        {spin('pull') ?? <ArrowDownToLine />}
        Pull{status.behind > 0 ? msg().git.count(status.behind) : ''}
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="git-push"
        disabled={running !== null || status.empty}
        onClick={() => void useGitStore.getState().push()}
      >
        {spin('push') ?? <ArrowUpFromLine />}
        Push{status.ahead > 0 ? msg().git.count(status.ahead) : ''}
      </Button>
    </div>
  )
}

/**
 * The Git screen (decision 119): replaces the sidebar and tabs until 返回; opened from
 * the header's Git menu.
 */
export function GitScreen() {
  const status = useGitStore((s) => s.status)
  const view = useGitStore((s) => s.view)
  const error = useGitStore((s) => s.error)

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void useGitStore.getState().refresh()
    }
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="git-screen">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          data-testid="git-back"
          onClick={() => useGitStore.getState().closeView()}
        >
          <ArrowLeft />
          {msg().git.back}
        </Button>
        <div role="tablist" aria-label="Git" className="flex items-center gap-0.5">
          {(
            [
              ['commit', 'Commit'],
              ['history', 'History']
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              data-testid={`git-tab-${v}`}
              className={cn(
                'rounded-sm px-2.5 py-1 text-sm',
                view === v ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => useGitStore.getState().openView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <RemoteButtons />
      </div>
      {status === null ? null : status.state === 'no-git' ? (
        <NoGit />
      ) : status.state === 'not-repo' ? (
        <NotRepo />
      ) : view === 'history' ? (
        <GitHistory />
      ) : (
        <RepoScreen status={status} />
      )}
      {error && (
        <p
          role="alert"
          className="m-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs break-words text-destructive"
          data-testid="git-error"
        >
          {error}
        </p>
      )}
      <IdentityDialog />
    </div>
  )
}
