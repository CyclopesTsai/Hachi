import { useEffect } from 'react'
import type { WorkspaceSettings } from '@shared/schemas/workspace'
import { unwrap } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'
import { useGitStore } from '@renderer/stores/git-store'
import { useTreeStore } from '@renderer/stores/tree-store'

/** Keeps the Git status current: on open, when the window gets focus, after tree changes. */
export function useGitSync(workspaceId: string): void {
  useEffect(() => {
    const git = useGitStore.getState()
    git.reset()
    void git.refresh().then(async () => {
      // Workspace setting (decision 113): fetch once when the Workspace opens.
      const settings = useAppStore.getState().workspaceSettings ?? (await workspaceSettings())
      const status = useGitStore.getState().status
      if (settings?.gitAutoFetch && status?.state === 'repo' && status.hasRemote) {
        await useGitStore.getState().fetch({ quiet: true })
      }
    })
    const refresh = () => void useGitStore.getState().refresh()
    window.addEventListener('focus', refresh)
    // Items created / renamed / moved / deleted change files.
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useTreeStore.subscribe((state, prev) => {
      if (state.tree === prev.tree) return
      clearTimeout(timer)
      timer = setTimeout(refresh, 300)
    })
    return () => {
      window.removeEventListener('focus', refresh)
      unsubscribe()
      clearTimeout(timer)
    }
  }, [workspaceId])
}

async function workspaceSettings(): Promise<WorkspaceSettings | null> {
  try {
    return await unwrap(window.hachi.workspace.getSettings())
  } catch {
    return null
  }
}
