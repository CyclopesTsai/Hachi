import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Copy, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import type { MockSummary } from '@shared/mock'
import { ITEM_NAME_MAX } from '@shared/schemas/collection'
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
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
import { NativeSelect } from '@renderer/components/ui/native-select'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/stores/app-store'
import { useMockStore } from '@renderer/stores/mock-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'

type DialogState =
  | { kind: 'create' }
  | { kind: 'rename'; mock: MockSummary }
  | { kind: 'delete'; mock: MockSummary }
  | null

let openDialog: (state: DialogState) => void = () => undefined

/** "+" next to the sidebar tabs while Mocks is shown. */
export function MockActions() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      title="新增 Mock Server"
      aria-label="新增 Mock Server"
      data-testid="mock-add"
      onClick={() => openDialog({ kind: 'create' })}
    >
      <Plus />
    </Button>
  )
}

/** Mock Servers of the Workspace (decision 133). */
export function MockPanel() {
  const workspaceId = useAppStore((s) => s.currentWorkspace?.id ?? null)
  const list = useMockStore((s) => s.list)
  const statuses = useMockStore((s) => s.statuses)
  const activeKey = useTabsStore((s) => s.activeKey)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    openDialog = setDialog
    return () => {
      openDialog = () => undefined
    }
  }, [])
  useEffect(() => {
    void useMockStore
      .getState()
      .loadList()
      .catch((e: unknown) => setError(errorMessage(e)))
    void unwrap(window.hachi.mock.statuses()).then((all) =>
      useMockStore.setState({ statuses: Object.fromEntries(all.map((s) => [s.id, s])) })
    )
  }, [workspaceId])

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mock-panel">
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      <ul className="min-h-0 flex-1 overflow-auto px-1 pb-4">
        {list.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            還沒有 Mock Server。按「＋」新增，或從 Collection 建立。
          </li>
        )}
        {list.map((mock) => {
          const running = statuses[mock.id]?.running ?? false
          const active = activeKey === `mock:${mock.id}`
          return (
            <ContextMenu key={mock.id}>
              <ContextMenuTrigger asChild>
                <li
                  className={cn(
                    'flex h-7 cursor-default items-center gap-1.5 rounded-sm px-2 text-sm hover:bg-accent/60',
                    active && 'bg-accent'
                  )}
                  data-testid="mock-row"
                  data-name={mock.name}
                  onClick={() => !mock.error && useTabsStore.getState().openMock(mock.id)}
                >
                  {mock.error ? (
                    <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <Server className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn('min-w-0 flex-1 truncate', mock.error && 'italic')}
                    title={mock.error}
                  >
                    {mock.name}
                  </span>
                  {running && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                      aria-label="執行中"
                      data-testid="mock-running"
                    />
                  )}
                </li>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {!mock.error && (
                  <>
                    <ContextMenuItem onSelect={() => setDialog({ kind: 'rename', mock })}>
                      <Pencil />
                      重新命名…
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        void run(async () => {
                          const copy = await useMockStore.getState().duplicate(mock.id)
                          useTabsStore.getState().openMock(copy.id)
                        })
                      }
                    >
                      <Copy />
                      複製
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => setDialog({ kind: 'delete', mock })}
                >
                  <Trash2 />
                  刪除…
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </ul>
      <Dialog
        open={dialog?.kind === 'create' || dialog?.kind === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent data-testid="mock-name-dialog">
          {dialog?.kind === 'create' && <CreateForm onDone={() => setDialog(null)} />}
          {dialog?.kind === 'rename' && (
            <RenameForm mock={dialog.mock} onDone={() => setDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={dialog?.kind === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除 Mock Server？</AlertDialogTitle>
            <AlertDialogDescription>
              「{dialog?.kind === 'delete' ? dialog.mock.name : ''}
              」會停止，檔案移到系統垃圾桶。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (dialog?.kind !== 'delete') return
                const id = dialog.mock.id
                void run(async () => {
                  await useMockStore.getState().remove(id)
                  useTabsStore.getState().dropMock(id)
                })
              }}
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Label htmlFor="mock-name">名稱</Label>
      <Input
        id="mock-name"
        autoFocus
        maxLength={ITEM_NAME_MAX}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  )
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const all = useTreeStore((s) => s.tree.collections)
  const collections = useMemo(() => all.filter((c) => !c.error), [all])
  const [name, setName] = useState('Mock Server')
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const mock = await useMockStore.getState().create(name.trim(), source || null)
      useTabsStore.getState().openMock(mock.id)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>新增 Mock Server</DialogTitle>
        <DialogDescription>存成 Workspace 的 mocks/ 資料夾中的檔案，可以進 git。</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3">
        <NameField value={name} onChange={setName} />
        <Label htmlFor="mock-source">路由</Label>
        <NativeSelect
          id="mock-source"
          value={source}
          onChange={(e) => {
            setSource(e.target.value)
            const c = collections.find((x) => x.id === e.target.value)
            if (c && (name === 'Mock Server' || name.endsWith(' Mock'))) setName(`${c.name} Mock`)
          }}
        >
          <option value="">空白</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              從 Collection「{c.name}」建立
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={name.trim() === ''}>
          建立
        </Button>
      </DialogFooter>
    </form>
  )
}

function RenameForm({ mock, onDone }: { mock: MockSummary; onDone: () => void }) {
  const [name, setName] = useState(mock.name)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await useMockStore.getState().rename(mock.id, name.trim())
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>重新命名 Mock Server</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3">
        <NameField value={name} onChange={setName} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={name.trim() === ''}>
          儲存
        </Button>
      </DialogFooter>
    </form>
  )
}
