import { Layers, Save } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { isDirty, useEditorStore, type ContainerDoc } from '@renderer/stores/editor-store'
import { AuthEditor } from './AuthEditor'
import { HeadersEditor } from './HeadersEditor'

/** Shared headers / auth of a collection or folder, inherited by everything inside it. */
export function ContainerEditor({ doc, name }: { doc: ContainerDoc; name: string }) {
  const { updateContainer, save } = useEditorStore.getState()
  const saving = useEditorStore((s) => s.saving)
  const saveError = useEditorStore((s) => s.saveError)
  const dirty = isDirty(doc)
  const isCollection = doc.containerKind === 'collection'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="container-editor">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Layers className="size-4 text-primary" />
        <h2 className="min-w-0 truncate text-sm font-medium">{name}</h2>
        <span className="text-xs text-muted-foreground">
          {isCollection ? 'Collection 設定' : '資料夾設定'}
        </span>
        {dirty && <span className="size-2 rounded-full bg-primary" aria-label="有未儲存的修改" />}
        <div className="flex-1" />
        {saveError && <span className="truncate text-xs text-destructive">{saveError}</span>}
        <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          <Save />
          儲存
        </Button>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        這裡的 Headers 與 Auth 會套用到{isCollection ? '這個 Collection' : '這個資料夾'}
        內的所有請求（請求自己的設定優先）。 Collection 變數將在 Phase 3 加入。
      </p>
      <Tabs defaultValue="headers" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
        </TabsList>
        <TabsContent value="headers" className="overflow-auto">
          <HeadersEditor
            headers={doc.draft.headers}
            onChange={(headers) => updateContainer((d) => ({ ...d, headers }))}
            inherited={doc.inherited}
          />
        </TabsContent>
        <TabsContent value="auth" className="overflow-auto">
          <AuthEditor
            auth={doc.draft.auth}
            onChange={(auth) => updateContainer((d) => ({ ...d, auth }))}
            inherited={doc.inherited}
            allowInherit={!isCollection}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
