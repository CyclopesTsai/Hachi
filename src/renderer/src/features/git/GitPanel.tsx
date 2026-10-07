import { ArrowDown, ArrowUp, GitBranch, RefreshCw, Undo2 } from 'lucide-react'
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
import { fileIndex, labelFor, type FileLabel } from './git-names'

/** While the panel is open, changes made by saving files show up without a click. */
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
      <p>找不到 git。Hachi 使用這台電腦安裝的 git，請先安裝：</p>
      {platform === 'win32' ? (
        <p>安裝 Git for Windows（git-scm.com），安裝後重新偵測。</p>
      ) : platform === 'darwin' ? (
        <p>
          在「終端機」執行 <code className="font-mono text-xs">xcode-select --install</code>
          ，或用 Homebrew 執行 <code className="font-mono text-xs">brew install git</code>。
        </p>
      ) : (
        <p>用系統的套件管理員安裝 git（例如 apt install git）。</p>
      )}
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
  onDiscard
}: {
  file: GitFileChange
  label: FileLabel
  checked: boolean
  onDiscard: () => void
}) {
  const kind = KINDS[file.kind]
  return (
    <li
      className="group flex h-7 items-center gap-1.5 rounded-sm px-1 text-sm hover:bg-accent/70"
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
        disabled={!label.itemId}
        onClick={() => label.itemId && useTabsStore.getState().openItem(label.itemId)}
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

function RepoPanel({ status }: { status: GitRepoStatus }) {
  const tree = useTreeStore((s) => s.tree)
  const message = useGitStore((s) => s.message)
  const unchecked = useGitStore((s) => s.unchecked)
  const busy = useGitStore((s) => s.busy)
  const [discarding, setDiscarding] = useState<{ file: GitFileChange; label: FileLabel } | null>(
    null
  )
  const index = useMemo(() => fileIndex(tree), [tree])
  const checkedCount = status.files.filter((f) => !unchecked.has(f.path)).length
  const allChecked = status.files.length > 0 && checkedCount === status.files.length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2" data-testid="git-panel">
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
      <textarea
        aria-label="Commit 訊息"
        data-testid="git-message"
        placeholder="Commit 訊息"
        rows={3}
        value={message}
        onChange={(e) => useGitStore.getState().setMessage(e.target.value)}
        className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <Button
        size="sm"
        data-testid="git-commit"
        disabled={busy || checkedCount === 0 || message.trim() === ''}
        onClick={() => void useGitStore.getState().commit()}
      >
        Commit（{checkedCount} 個檔案）
      </Button>
      <div className="flex items-center gap-2 px-1 pt-1">
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
        <p className="px-1 text-sm text-muted-foreground" data-testid="git-clean">
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
                onDiscard={() => setDiscarding({ file, label })}
              />
            )
          })}
        </ul>
      )}
      <DiscardDialog target={discarding} onClose={() => setDiscarding(null)} />
    </div>
  )
}

/** Sidebar "Git" tab (decision 112). */
export function GitPanel() {
  const status = useGitStore((s) => s.status)
  const error = useGitStore((s) => s.error)

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void useGitStore.getState().refresh()
    }
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {status === null ? null : status.state === 'no-git' ? (
        <NoGit />
      ) : status.state === 'not-repo' ? (
        <NotRepo />
      ) : (
        <RepoPanel status={status} />
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
