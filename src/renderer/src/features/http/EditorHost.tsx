import { AlertTriangle, Loader2, MousePointerClick, Plus, Radio } from 'lucide-react'
import { WebSocketEditor } from '@renderer/features/websocket/WebSocketEditor'
import { findNode } from '@shared/tree'
import { Button } from '@renderer/components/ui/button'
import { EnvironmentsEditor } from '@renderer/features/environments/EnvironmentsEditor'
import { TabBar } from '@renderer/features/tabs/TabBar'
import { tabTitle, type Tab } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { ContainerEditor } from './ContainerEditor'
import { RequestEditor } from './RequestEditor'

function Placeholder({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}

function StaticView({ itemId }: { itemId: string }) {
  const node = useTreeStore((s) => findNode(s.tree, itemId)?.node)
  if (!node) return null
  if (node.error) {
    return (
      <div className="flex flex-col gap-3 p-6" data-testid="item-details">
        <h2 className="text-lg font-semibold">{node.name}</h2>
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            無法讀取這個檔案：{node.error}
            <br />
            請修正 JSON 內容後按「重新讀取」，或從左側刪除。
          </span>
        </p>
        <p className="font-mono text-xs text-muted-foreground">{node.relPath}</p>
      </div>
    )
  }
  return null
}

function TabContent({ tab }: { tab: Tab }) {
  const title = useTreeStore((s) => tabTitle(tab, s.tree))
  if (tab.kind === 'static') return <StaticView itemId={tab.itemId} />
  if (tab.status === 'error') {
    return (
      <Placeholder icon={<AlertTriangle className="size-6 text-destructive" />}>
        無法開啟：{tab.loadError}
      </Placeholder>
    )
  }
  if (tab.status !== 'ready') {
    return <Placeholder icon={<Loader2 className="size-5 animate-spin" />}>載入中…</Placeholder>
  }
  // A fresh editor per loaded content: no undo history leaking between loads.
  const key = `${tab.uid}:${tab.version}`
  switch (tab.kind) {
    case 'request':
      return tab.draft ? <RequestEditor key={key} tab={tab} title={title} /> : null
    case 'container':
      return tab.draft ? <ContainerEditor key={key} tab={tab} title={title} /> : null
    case 'websocket':
      return tab.draft ? <WebSocketEditor key={key} tab={tab} title={title} /> : null
    case 'environments':
      return <EnvironmentsEditor key={key} tab={tab} />
  }
}

/** Right-hand side: tab bar and the active tab's editor. */
export function EditorHost() {
  const active = useTabsStore((s) => s.tabs.find((t) => t.key === s.activeKey))
  const hasTabs = useTabsStore((s) => s.tabs.length > 0)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasTabs && <TabBar />}
      {active ? (
        <TabContent tab={active} />
      ) : (
        <Placeholder icon={<MousePointerClick className="size-6" />}>
          從左側選擇一個請求，或按右鍵新增項目。
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => useTabsStore.getState().newRequest('http')}
            >
              <Plus />
              新增 HTTP 請求
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => useTabsStore.getState().newRequest('websocket')}
            >
              <Radio />
              新增 WebSocket
            </Button>
          </div>
        </Placeholder>
      )}
    </div>
  )
}
