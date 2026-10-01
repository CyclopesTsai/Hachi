import { useEffect } from 'react'
import { EVENTS } from '@shared/ipc/channels'
import { WelcomeScreen } from '@renderer/features/onboarding/WelcomeScreen'
import { WorkspaceShell } from '@renderer/features/workspace/WorkspaceShell'
import { useSystemTheme } from '@renderer/hooks/use-system-theme'
import { useAppStore } from '@renderer/stores/app-store'

function useMainProcessEvents(): void {
  useEffect(() => {
    const store = useAppStore.getState
    const offs = [
      window.hachi.on(EVENTS.workspaceChanged, (ws) => store().workspaceChanged(ws)),
      window.hachi.on(EVENTS.configChanged, (config) => store().configChanged(config)),
      window.hachi.on(EVENTS.menuCommand, ({ command }) => {
        switch (command) {
          case 'workspace.new':
            store().showWelcome({ focusCreate: true })
            break
          case 'workspace.switch':
            store().showWelcome()
            break
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])
}

export function App() {
  useSystemTheme()
  useMainProcessEvents()
  const { status, bootError, currentWorkspace, welcomeRequested, bootstrap } = useAppStore()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">載入中…</div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="font-medium text-destructive">Hachi 啟動失敗</p>
        <p className="text-sm text-muted-foreground">{bootError}</p>
      </div>
    )
  }
  if (!currentWorkspace || welcomeRequested) return <WelcomeScreen />
  return <WorkspaceShell workspace={currentWorkspace} />
}
