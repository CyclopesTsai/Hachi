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
import { msg } from '@shared/i18n'

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
            {isCollection ? msg().http.container.collection : msg().http.container.folder}
          </span>
          {dirty && (
            <span className="size-2 rounded-full bg-primary" aria-label={msg().http.unsaved} />
          )}
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
            {msg().common.save}
          </Button>
        </div>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          {isCollection ? msg().http.container.collectionHint : msg().http.container.folderHint}
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
                <span className="font-medium">{msg().http.container.scriptFlow}</span>
                {isCollection ? (
                  <NativeSelect
                    aria-label={msg().http.container.scriptFlow}
                    value={draft.scriptFlow}
                    onChange={(e) => update({ scriptFlow: e.target.value as ScriptFlow })}
                  >
                    <option value="sequential">{msg().http.container.sequential}</option>
                    <option value="sandwich">{msg().http.container.sandwich}</option>
                  </NativeSelect>
                ) : (
                  <span>{msg().http.container.flowInherited(draft.scriptFlow === 'sandwich')}</span>
                )}
                <span className="text-muted-foreground">
                  {draft.scriptFlow === 'sandwich'
                    ? msg().http.container.sandwichHint
                    : msg().http.container.sequentialHint}
                </span>
              </div>
            </ScriptsTab>
          </TabsContent>
        </Tabs>
      </div>
    </VariablesContext>
  )
}
