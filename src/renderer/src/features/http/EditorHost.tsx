import { AlertTriangle, Loader2, MousePointerClick, Plus, Radio } from 'lucide-react'
import { WebSocketEditor } from '@renderer/features/websocket/WebSocketEditor'
import { findNode } from '@shared/tree'
import { Button } from '@renderer/components/ui/button'
import { EnvironmentsEditor } from '@renderer/features/environments/EnvironmentsEditor'
import { TabBar } from '@renderer/features/tabs/TabBar'
import { tabTitle, type Tab } from '@renderer/features/tabs/tab-model'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { MockEditor } from '@renderer/features/mock/MockEditor'
import { useMockStore } from '@renderer/stores/mock-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { ContainerEditor } from './ContainerEditor'
import { ExampleView } from './ExampleView'
import { RequestEditor } from './RequestEditor'
import { RunnerView } from '@renderer/features/runner/RunnerView'
import { msg } from '@shared/i18n'

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
            {msg().http.host.fileError(node.error)}
            <br />
            {msg().http.host.fileErrorHint}
          </span>
        </p>
        <p className="font-mono text-xs text-muted-foreground">{node.relPath}</p>
      </div>
    )
  }
  return null
}

function TabContent({ tab }: { tab: Tab }) {
  const mocks = useMockStore((s) => s.list)
  const title = useTreeStore((s) => tabTitle(tab, s.tree, mocks))
  if (tab.kind === 'static') return <StaticView itemId={tab.itemId} />
  if (tab.status === 'error') {
    return (
      <Placeholder icon={<AlertTriangle className="size-6 text-destructive" />}>
        {msg().http.host.cannotOpen(tab.loadError ?? '')}
      </Placeholder>
    )
  }
  if (tab.status !== 'ready') {
    return (
      <Placeholder icon={<Loader2 className="size-5 animate-spin" />}>
        {msg().common.loading}
      </Placeholder>
    )
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
    case 'runner':
      return <RunnerView tab={tab} />
    case 'mock':
      return tab.draft ? <MockEditor key={key} tab={tab} title={title} /> : null
    case 'example':
      return <ExampleView key={key} tab={tab} title={title} />
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
          {msg().http.host.empty}
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => useTabsStore.getState().newRequest('http')}
            >
              <Plus />
              {msg().tree.newHttp}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => useTabsStore.getState().newRequest('websocket')}
            >
              <Radio />
              {msg().tree.newWebSocket}
            </Button>
          </div>
        </Placeholder>
      )}
    </div>
  )
}
