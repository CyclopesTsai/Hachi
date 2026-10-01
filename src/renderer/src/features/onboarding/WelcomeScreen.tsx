import { FolderOpen, FolderPlus, History, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { sanitizeFileName } from '@shared/file-names'
import { WORKSPACE_NAME_MAX } from '@shared/schemas/workspace'
import { AppLogo } from '@renderer/components/app-logo'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { IpcError, errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'

const FRIENDLY_ERRORS: Partial<Record<string, string>> = {
  ALREADY_EXISTS: '這個位置已經有 Workspace 了，請改用「開啟既有 Workspace」。',
  DIR_NOT_EMPTY: '目標資料夾已存在且不是空的，請換一個名稱或位置。',
  NOT_A_WORKSPACE: '這個資料夾不是 Hachi Workspace（找不到 workspace.json）。',
  INVALID_FILE: 'workspace.json 內容損毀或格式不正確。',
  UNSUPPORTED_VERSION: '這個 Workspace 由較新版本的 Hachi 建立，請先更新 Hachi。'
}

function describeError(error: unknown): string {
  if (error instanceof IpcError) {
    const friendly = FRIENDLY_ERRORS[error.code]
    return friendly ? `${friendly}\n${error.message}` : error.message
  }
  return errorMessage(error)
}

function previewPath(parentDir: string, name: string, platform: string | undefined): string {
  const sep = platform === 'win32' ? '\\' : '/'
  const parent = parentDir.replace(/[\\/]+$/, '')
  return `${parent}${sep}${sanitizeFileName(name.trim())}`
}

function CreateWorkspaceForm() {
  const { defaultWorkspaceDir, info, createWorkspace, createFocusNonce } = useAppStore()
  const [name, setName] = useState('My Workspace')
  const [parentDir, setParentDir] = useState(defaultWorkspaceDir)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [createFocusNonce])

  const trimmed = name.trim()
  const preview = useMemo(
    () => (trimmed && parentDir ? previewPath(parentDir, trimmed, info?.platform) : ''),
    [trimmed, parentDir, info?.platform]
  )

  async function browse(): Promise<void> {
    try {
      const dir = await unwrap(
        window.hachi.dialog.selectDirectory({
          title: '選擇 Workspace 存放位置',
          defaultPath: parentDir || undefined
        })
      )
      if (dir) setParentDir(dir)
    } catch (e) {
      setError(describeError(e))
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!trimmed || !parentDir) return
    setBusy(true)
    setError(null)
    try {
      await createWorkspace({ name: trimmed, parentDir })
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-4"
      data-testid="create-workspace-form"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-name">名稱</Label>
        <Input
          id="workspace-name"
          ref={nameRef}
          value={name}
          maxLength={WORKSPACE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：My API"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-location">存放位置</Label>
        <div className="flex gap-2">
          <Input
            id="workspace-location"
            value={parentDir}
            onChange={(e) => setParentDir(e.target.value)}
            spellCheck={false}
          />
          <Button type="button" variant="outline" onClick={() => void browse()}>
            瀏覽…
          </Button>
        </div>
        {preview && (
          <p
            className="text-xs break-all text-muted-foreground"
            data-testid="workspace-path-preview"
          >
            將建立資料夾：<span className="font-mono">{preview}</span>
          </p>
        )}
      </div>
      {error && (
        <p className="text-sm whitespace-pre-line text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !trimmed || !parentDir}>
        <FolderPlus />
        {busy ? '建立中…' : '建立 Workspace'}
      </Button>
    </form>
  )
}

function RecentList() {
  const { recent, openWorkspace, removeRecent, currentWorkspace } = useAppStore()
  const [error, setError] = useState<string | null>(null)

  if (recent.length === 0) {
    return <p className="text-sm text-muted-foreground">尚無最近開啟的 Workspace。</p>
  }

  return (
    <div className="flex flex-col gap-1">
      {error && (
        <p className="mb-2 text-sm whitespace-pre-line text-destructive" role="alert">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-1" data-testid="recent-workspaces">
        {recent.map((r) => (
          <li key={r.path} className="group flex items-center gap-1">
            <button
              type="button"
              disabled={!r.exists}
              onClick={() => {
                setError(null)
                openWorkspace(r.path).catch((e: unknown) => setError(describeError(e)))
              }}
              className="flex min-w-0 flex-1 flex-col items-start rounded-md px-3 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              title={r.path}
            >
              <span className="flex w-full items-center gap-2 text-sm font-medium">
                <span className="truncate">{r.name}</span>
                {currentWorkspace?.path === r.path && (
                  <span className="rounded bg-primary/15 px-1.5 text-[10px] text-primary">
                    目前
                  </span>
                )}
                {!r.exists && <span className="text-[10px] text-destructive">找不到資料夾</span>}
              </span>
              <span className="w-full truncate font-mono text-xs text-muted-foreground">
                {r.path}
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title="從清單移除"
              aria-label={`從清單移除 ${r.name}`}
              onClick={() => void removeRecent(r.path)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WelcomeScreen() {
  const { currentWorkspace, recent, openWorkspaceWithDialog, hideWelcome } = useAppStore()
  const [error, setError] = useState<string | null>(null)
  const isFirstRun = !currentWorkspace && recent.length === 0

  return (
    <div
      className="flex h-full items-center justify-center overflow-auto p-8"
      data-testid="welcome-screen"
    >
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <AppLogo size="lg" />
          <p className="text-muted-foreground">
            {isFirstRun
              ? '歡迎使用 Hachi！先建立第一個 Workspace，所有 Collections、環境變數與歷史紀錄都會存放在其中。'
              : '建立新的 Workspace，或開啟既有的 Workspace。'}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>建立新的 Workspace</CardTitle>
              <CardDescription>
                每個 Workspace 對應磁碟上的一個資料夾，資料皆以 JSON 檔儲存。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateWorkspaceForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" />
                最近開啟
              </CardTitle>
              <CardDescription>或從磁碟選擇一個既有的 Workspace 資料夾。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(null)
                  openWorkspaceWithDialog().catch((e: unknown) => setError(describeError(e)))
                }}
              >
                <FolderOpen />
                開啟既有 Workspace…
              </Button>
              {error && (
                <p className="text-sm whitespace-pre-line text-destructive" role="alert">
                  {error}
                </p>
              )}
              <RecentList />
            </CardContent>
          </Card>
        </div>

        {currentWorkspace && (
          <div className="text-center">
            <Button variant="link" onClick={hideWelcome}>
              返回「{currentWorkspace.name}」
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
