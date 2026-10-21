import type { HttpCheckTlsInput } from '@shared/ipc/api'
import { contextParentId, type RequestLikeTab } from '@renderer/features/tabs/tab-model'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTreeStore } from '@renderer/stores/tree-store'

/** Plain http:// / ws:// cannot be checked (a {{variable}} might still turn into https). */
export const isPlainUrl = (url: string) => /^\s*(http|ws):\/\//i.test(url)

/** What to check for a request / WebSocket tab, as currently edited. */
export function tlsCheckInput(tab: RequestLikeTab): HttpCheckTlsInput {
  const current = useTabsStore.getState().tabs.find((t) => t.uid === tab.uid) ?? tab
  const draft = (current as RequestLikeTab).draft ?? tab.draft
  return {
    parentId: contextParentId(current, useTreeStore.getState().tree),
    environmentId: useEnvStore.getState().activeId,
    url: draft?.url ?? '',
    useProxy: draft?.settings.useProxy ?? true
  }
}
