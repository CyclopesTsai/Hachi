import { useEffect } from 'react'
import { useGitStore } from '@renderer/stores/git-store'
import { useTreeStore } from '@renderer/stores/tree-store'

/** Keeps the Git status current: on open, when the window gets focus, after tree changes. */
export function useGitSync(workspaceId: string): void {
  useEffect(() => {
    const git = useGitStore.getState()
    git.reset()
    void git.refresh()
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
