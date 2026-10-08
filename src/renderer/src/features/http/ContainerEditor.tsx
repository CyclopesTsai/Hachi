import { Layers, Save } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { VariablesTable } from '@renderer/components/variables-table'
import { collectionIdOf, isTabDirty, type ContainerTab } from '@renderer/features/tabs/tab-model'
import { VariablesContext, useVariableMap } from '@renderer/lib/variables'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import type { ScriptFlow } from '@shared/schemas/collection'
import { hasScripts } from '@shared/scripts'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { AuthEditor } from './AuthEditor'
import { ScriptsTab } from './ScriptsEditor'
import { HeadersEditor } from './HeadersEditor'

/** Shared headers / auth (and collection variables) inherited by everything inside. */
export function ContainerEditor({ tab, title }: { tab: ContainerTab; title: string }) {
  const store = useTabsStore.getState()
  const dirty = isTabDirty(tab)
  const isCollection = tab.containerKind === 'collection'
  const draft = tab.draft as NonNullable<ContainerTab['draft']>
  const update = (patch: Partial<typeof draft>) =>
    store.updateContainer(tab.key, (d) => ({ ...d, ...patch }))
  const collectionId = useTreeStore((s) => collectionIdOf(s.tree, tab.itemId))
  const variables = useVariableMap(collectionId)

  return (
    <VariablesContext value={variables}>
      <div className="flex h-full min-h-0 flex-col" data-testid="container-editor">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Layers className="size-4 text-primary" />
          <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
          <span className="text-xs text-muted-foreground">
            {isCollection ? 'Collection 設定' : '資料夾設定'}
          </span>
          {dirty && <span className="size-2 rounded-full bg-primary" aria-label="有未儲存的修改" />}
          <div className="flex-1" />
          {tab.saveError && (
            <span className="truncate text-xs text-destructive">{tab.saveError}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || tab.saving}
            onClick={() => void store.save(tab.key)}
          >
            <Save />
            儲存
          </Button>
        </div>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          {isCollection
            ? '這裡的 Headers、Auth、變數與腳本會套用到這個 Collection 內的所有請求（請求自己的設定優先；同名變數以環境變數優先）。'
            : '這裡的 Headers、Auth 與腳本會套用到這個資料夾內的所有請求（請求自己的設定優先）。'}
        </p>
        <Tabs
          defaultValue={isCollection ? 'variables' : 'headers'}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            {isCollection && <TabsTrigger value="variables">Variables</TabsTrigger>}
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="auth">Auth</TabsTrigger>
            <TabsTrigger value="scripts">
              Scripts
              {hasScripts(draft.scripts) && (
                <span className="ml-1 size-1.5 rounded-full bg-primary" />
              )}
            </TabsTrigger>
          </TabsList>
          {isCollection && (
            <TabsContent value="variables" className="overflow-auto">
              <div className="p-4">
                <VariablesTable
                  rows={draft.variables}
                  onChange={(vars) => update({ variables: vars })}
                  data-testid="collection-variables"
                />
              </div>
            </TabsContent>
          )}
          <TabsContent value="headers" className="overflow-auto">
            <HeadersEditor
              headers={draft.headers}
              onChange={(headers) => update({ headers })}
              inherited={tab.inherited}
            />
          </TabsContent>
          <TabsContent value="auth" className="overflow-auto">
            <AuthEditor
              auth={draft.auth}
              onChange={(auth) => update({ auth })}
              inherited={tab.inherited}
              allowInherit={!isCollection}
              scopeId={tab.itemId}
            />
          </TabsContent>
          <TabsContent value="scripts" className="min-h-0 flex-1">
            <ScriptsTab
              container
              scripts={draft.scripts}
              onChange={(scripts) => update({ scripts })}
              inheritedFrom={tab.inherited.scripts}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="script-flow">
                <span className="font-medium">腳本順序</span>
                {isCollection ? (
                  <NativeSelect
                    aria-label="腳本順序"
                    value={draft.scriptFlow}
                    onChange={(e) => update({ scriptFlow: e.target.value as ScriptFlow })}
                  >
                    <option value="sequential">依序（Postman）</option>
                    <option value="sandwich">三明治（Bruno）</option>
                  </NativeSelect>
                ) : (
                  <span>
                    {draft.scriptFlow === 'sandwich' ? '三明治' : '依序'}（Collection 設定）
                  </span>
                )}
                <span className="text-muted-foreground">
                  {draft.scriptFlow === 'sandwich'
                    ? 'Pre-request：Collection → 資料夾 → 請求；Post-response：請求 → 資料夾 → Collection'
                    : 'Pre-request 與 Post-response 都是 Collection → 資料夾 → 請求'}
                </span>
              </div>
            </ScriptsTab>
          </TabsContent>
        </Tabs>
      </div>
    </VariablesContext>
  )
}
