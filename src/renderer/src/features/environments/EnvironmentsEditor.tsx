import { AlertTriangle, Check, Copy, Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { EnvironmentSummary } from '@shared/ipc/api'
import { Button } from '@renderer/components/ui/button'
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
import { Input } from '@renderer/components/ui/input'
import { VariablesTable } from '@renderer/components/variables-table'
import { isTabDirty, type EnvironmentsTab } from '@renderer/features/tabs/tab-model'
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { VariablesContext, useVariableMap } from '@renderer/lib/variables'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTabsStore } from '@renderer/stores/tabs-store'

function DeleteEnvironmentDialog({
  target,
  onClose
}: {
  target: EnvironmentSummary | null
  onClose: () => void
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent data-testid="delete-environment-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>刪除環境「{target?.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            環境檔會移到系統垃圾桶，需要時可以從垃圾桶還原。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (target) void useTabsStore.getState().deleteEnvironment(target.id)
              onClose()
            }}
          >
            刪除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The "環境" tab: list of environments and the variables of the selected one. */
export function EnvironmentsEditor({ tab }: { tab: EnvironmentsTab }) {
  const store = useTabsStore.getState()
  const list = useEnvStore((s) => s.list)
  const activeId = useEnvStore((s) => s.activeId)
  const [deleting, setDeleting] = useState<EnvironmentSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = isTabDirty(tab)
  const draft = tab.draft
  // Values can reference other variables of the active environment.
  const variables = useVariableMap(null)

  const run = async (action: () => Promise<void>) => {
    try {
      setError(null)
      await action()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <VariablesContext value={variables}>
      <div className="flex h-full min-h-0" data-testid="environments-editor">
        <div className="flex w-56 shrink-0 flex-col border-r">
          <div className="flex h-9 items-center justify-between pr-1 pl-3">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              環境
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="新增環境"
              title="新增環境"
              onClick={() => void run(() => store.createEnvironment('New Environment'))}
            >
              <Plus />
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto px-1" aria-label="環境清單">
            {list.map((env) => (
              <li key={env.id}>
                <button
                  type="button"
                  data-testid="environment-row"
                  data-name={env.name}
                  className={cn(
                    'group flex h-7 w-full items-center gap-1.5 rounded-sm px-2 text-left text-sm hover:bg-accent/70',
                    tab.selectedId === env.id && 'bg-accent'
                  )}
                  title={env.error}
                  onClick={() => !env.error && void store.selectEnvironment(env.id)}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {env.id === activeId && (
                      <Check className="size-3.5 text-primary" aria-label="目前使用中" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      env.error && 'text-muted-foreground italic'
                    )}
                  >
                    {env.name}
                  </span>
                  {env.error && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
                  {!env.error && (
                    <Copy
                      className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                      aria-label="複製"
                      onClick={(e) => {
                        e.stopPropagation()
                        void run(() => store.duplicateEnvironment(env.id))
                      }}
                    />
                  )}
                  <Trash2
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                    aria-label="刪除"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(env)
                    }}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {draft ? (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Input
                  aria-label="環境名稱"
                  data-testid="environment-name"
                  className="h-8 max-w-64"
                  value={draft.name}
                  onChange={(e) =>
                    store.updateEnvironment(tab.key, (d) => ({ ...d, name: e.target.value }))
                  }
                />
                {dirty && (
                  <span className="size-2 rounded-full bg-primary" aria-label="有未儲存的修改" />
                )}
                <div className="flex-1" />
                {(tab.saveError ?? error) && (
                  <span className="truncate text-xs text-destructive">
                    {tab.saveError ?? error}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={draft.id === activeId}
                  onClick={() => void useEnvStore.getState().setActive(draft.id)}
                >
                  <Check />
                  {draft.id === activeId ? '使用中' : '設為目前環境'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!dirty || tab.saving || draft.name.trim() === ''}
                  onClick={() => void store.save(tab.key)}
                >
                  <Save />
                  儲存
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <VariablesTable
                  rows={draft.variables}
                  onChange={(rows) =>
                    store.updateEnvironment(tab.key, (d) => ({ ...d, variables: rows }))
                  }
                  data-testid="environment-variables"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
              <p>還沒有任何環境。建立環境（例如 dev、staging、prod）來切換不同的變數值。</p>
              {error && <p className="text-destructive">{error}</p>}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run(() => store.createEnvironment('New Environment'))}
              >
                <Plus />
                建立環境
              </Button>
            </div>
          )}
        </div>
        <DeleteEnvironmentDialog target={deleting} onClose={() => setDeleting(null)} />
      </div>
    </VariablesContext>
  )
}
