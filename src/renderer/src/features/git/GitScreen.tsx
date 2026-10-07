import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  ArrowUpFromLine,
  GitBranch,
  Loader2,
  RefreshCw,
  Undo2
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
import { DiffView } from './DiffView'
import { fileIndex, gitInstallHint, labelFor, type FileLabel } from './git-names'

/** While the Git screen is open, changes made by saving files show up without a click. */
const POLL_MS = 4000

const KINDS: Record<GitChangeKind, { letter: string; label: string; className: string }> = {
  modified: { letter: 'M', label: '已修改', className: 'text-amber-600 dark:text-amber-400' },
  added: { letter: 'A', label: '新增', className: 'text-emerald-600 dark:text-emerald-400' },
  untracked: { letter: 'U', label: '新檔案', className: 'text-emerald-600 dark:text-emerald-400' },
  deleted: { letter: 'D', label: '已刪除', className: 'text-red-600 dark:text-red-400' },
  renamed: { letter: 'R', label: '已更名', className: 'text-sky-600 dark:text-sky-400' },
  conflicted: { letter: '!', label: '衝突', className: 'text-red-600 dark:text-red-400' }
}

function NoGit() {
  const platform = useAppStore((s) => s.info?.platform)
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3 text-sm text-muted-foreground"
      data-testid="git-missing"
    >
      <p>找不到 git。Hachi 使用這台電腦安裝的 git：{gitInstallHint(platform)}</p>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => void useGitStore.getState().refresh()}
      >
        <RefreshCw />
        重新偵測
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
      <p>這個 Workspace 不在 Git repo 中。</p>
      <p className="text-xs">
        建立後會在 Workspace 資料夾中產生 .git；機密變數與歷史紀錄已在 .gitignore 中，不會被提交。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={() => void useGitStore.getState().init()}
      >
        建立 Git repo（git init）
      </Button>
    </div>
  )
}

function FileRow({
  file,
  label,
  checked,
  selected,
  onDiscard
}: {
  file: GitFileChange
  label: FileLabel
  checked: boolean
  selected: boolean
  onDiscard: () => void
}) {
  const kind = KINDS[file.kind]
  return (
    <li
      className={cn(
        'group flex h-7 items-center gap-1.5 rounded-sm px-1 text-sm hover:bg-accent/70',
        selected && 'bg-accent'
      )}
      aria-selected={selected}
      data-testid="git-file"
      data-path={file.path}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
    >
      <input
        type="checkbox"
        className="size-3.5 shrink-0 accent-primary"
        aria-label={`Commit ${label.title}`}
        checked={checked}
        onChange={() => useGitStore.getState().toggle(file.path)}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
        title={label.itemId ? '按兩下開啟' : undefined}
        onClick={() => void useGitStore.getState().select(file.path)}
        onDoubleClick={() => {
          if (!label.itemId) return
          useGitStore.getState().closeView()
          useTabsStore.getState().openItem(label.itemId)
        }}
      >
        <span className="truncate">{label.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {file.path.slice(0, file.path.lastIndexOf('/') + 1)}
        </span>
      </button>
      {file.kind !== 'conflicted' && (
        <button
          type="button"
          className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground"
          title="捨棄變更…"
          aria-label={`捨棄 ${label.title} 的變更`}
          onClick={onDiscard}
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
          <AlertDialogTitle>捨棄「{target?.label.title}」的變更？</AlertDialogTitle>
          <AlertDialogDescription>
            {isNew
              ? '這是還沒 commit 過的新檔案，會移到系統垃圾桶。'
              : '檔案會還原成最後一次 commit 的內容，目前的修改無法復原。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
          {target?.file.path}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (target) void useGitStore.getState().discard(target.file.path, target.label.itemId)
            }}
          >
            捨棄變更
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
            <DialogTitle>設定 Git 使用者</DialogTitle>
            <DialogDescription>
              Commit 會記錄作者的名稱與 Email（git config user.name / user.email）。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-name">名稱</Label>
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
            用於這台電腦的所有 repo（git config --global）
          </CheckboxLabel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => useGitStore.getState().cancelIdentity()}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy || name.trim() === '' || email.trim() === ''}>
              儲存並 Commit
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
            <span className="flex shrink-0 items-center gap-1" title={`相對於 ${status.upstream}`}>
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
            title="重新整理"
            aria-label="重新整理 Git 狀態"
            onClick={() => void useGitStore.getState().refresh()}
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            變更（{status.files.length}）
          </span>
          <div className="flex-1" />
          {status.files.length > 0 && (
            <CheckboxLabel
              checked={allChecked}
              onChange={() => useGitStore.getState().setAll(!allChecked)}
            >
              全選
            </CheckboxLabel>
          )}
        </div>
        {status.files.length === 0 ? (
          <p className="flex-1 px-1 text-sm text-muted-foreground" data-testid="git-clean">
            沒有變更。
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-auto">
            {status.files.map((file) => {
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
              aria-label="Commit 訊息"
              data-testid="git-message"
              placeholder="Commit 訊息"
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
              Commit（{checkedCount} 個檔案）
            </Button>
          </>
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selectedChange?.kind === 'conflicted' && <ConflictBar path={selectedChange.path} />}
        {diff ? (
          <DiffView diff={diff} />
        ) : (
          <p className="m-auto text-sm text-muted-foreground">
            {selected ? '讀取中…' : '選擇左側的檔案查看與最後一次 commit 的差異'}
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
        {conflicts > 0
          ? `合併中：還有 ${conflicts} 個衝突的檔案（標示 !）。點檔案選擇保留哪一邊。`
          : '衝突都解決了，可以完成合併。'}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          data-testid="git-finish-merge"
          disabled={busy || conflicts > 0}
          onClick={() => void useGitStore.getState().finishMerge()}
        >
          完成合併
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setAborting(true)}>
          放棄合併…
        </Button>
      </div>
      <AlertDialog open={aborting} onOpenChange={setAborting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放棄這次合併？</AlertDialogTitle>
            <AlertDialogDescription>
              回到 Pull 之前的狀態（git merge --abort），合併中做的選擇都會取消。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void useGitStore.getState().abortMerge()}
            >
              放棄合併
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
      <span className="font-medium">這個檔案有衝突：</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve('ours')}>
        保留我的
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve('theirs')}>
        使用遠端的
      </Button>
      <span className="text-muted-foreground">或</span>
      <Button size="sm" variant="ghost" onClick={() => void useGitStore.getState().openFile(path)}>
        用其他程式編輯
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve('resolved')}>
        標記已解決
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
        Pull{status.behind > 0 ? `（${status.behind}）` : ''}
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="git-push"
        disabled={running !== null || status.empty}
        onClick={() => void useGitStore.getState().push()}
      >
        {spin('push') ?? <ArrowUpFromLine />}
        Push{status.ahead > 0 ? `（${status.ahead}）` : ''}
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
          返回
        </Button>
        <span className="text-sm font-medium">Commit</span>
        <div className="flex-1" />
        <RemoteButtons />
      </div>
      {status === null ? null : status.state === 'no-git' ? (
        <NoGit />
      ) : status.state === 'not-repo' ? (
        <NotRepo />
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
