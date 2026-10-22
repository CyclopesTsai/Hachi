import { FolderOpen, FolderPlus, History, Languages, Trash2, X } from 'lucide-react'
import { msg } from '@shared/i18n'
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
import { LanguageSelect } from '@renderer/features/settings/LanguageSelect'
import { DeleteWorkspaceDialog } from '@renderer/features/workspace/WorkspaceDialogs'
import { IpcError, errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'

function describeError(error: unknown): string {
  if (error instanceof IpcError) {
    const friendly = msg().welcome.errors[error.code]
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
          title: msg().welcome.chooseLocation,
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

  const m = msg().welcome
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-4"
      data-testid="create-workspace-form"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-name">{m.name}</Label>
        <Input
          id="workspace-name"
          ref={nameRef}
          value={name}
          maxLength={WORKSPACE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder={m.namePlaceholder}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-location">{m.location}</Label>
        <div className="flex gap-2">
          <Input
            id="workspace-location"
            value={parentDir}
            onChange={(e) => setParentDir(e.target.value)}
            spellCheck={false}
          />
          <Button type="button" variant="outline" onClick={() => void browse()}>
            {msg().common.browse}
          </Button>
        </div>
        {preview && (
          <p
            className="text-xs break-all text-muted-foreground"
            data-testid="workspace-path-preview"
          >
            {m.willCreate}
            <span className="font-mono">{preview}</span>
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
        {busy ? m.creating : m.create}
      </Button>
    </form>
  )
}

function RecentList() {
  const { recent, openWorkspace, removeRecent, currentWorkspace } = useAppStore()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ name: string; path: string } | null>(null)

  const m = msg().welcome
  if (recent.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.noRecent}</p>
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
                    {m.current}
                  </span>
                )}
                {!r.exists && (
                  <span className="text-[10px] text-destructive">{m.folderMissing}</span>
                )}
              </span>
              <span className="w-full truncate font-mono text-xs text-muted-foreground">
                {r.path}
              </span>
            </button>
            {r.exists && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title={m.deleteTitle}
                aria-label={m.deleteLabel(r.name)}
                onClick={() => setDeleting(r)}
              >
                <Trash2 />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title={m.removeTitle}
              aria-label={m.removeLabel(r.name)}
              onClick={() => void removeRecent(r.path)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <DeleteWorkspaceDialog target={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

export function WelcomeScreen() {
  const { currentWorkspace, recent, openWorkspaceWithDialog, hideWelcome } = useAppStore()
  const [error, setError] = useState<string | null>(null)
  const isFirstRun = !currentWorkspace && recent.length === 0
  const m = msg().welcome

  return (
    <div
      className="relative flex h-full items-center justify-center overflow-auto p-8"
      data-testid="welcome-screen"
    >
      {/* Language right away, before anything else (issue #6). */}
      <div className="absolute top-3 right-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Languages className="size-3.5" aria-hidden />
        <LanguageSelect />
      </div>
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <AppLogo size="lg" />
          <p className="text-muted-foreground">{isFirstRun ? m.introFirstRun : m.intro}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{m.createTitle}</CardTitle>
              <CardDescription>{m.createDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateWorkspaceForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" />
                {m.recentTitle}
              </CardTitle>
              <CardDescription>{m.recentDescription}</CardDescription>
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
                {m.open}
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
              {m.back(currentWorkspace.name)}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
