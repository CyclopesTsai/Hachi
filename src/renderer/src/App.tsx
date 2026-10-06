import { useEffect } from 'react'
import { EVENTS } from '@shared/ipc/channels'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { UnsavedChangesDialog } from '@renderer/features/http/UnsavedChangesDialog'
import { ScriptTrustDialog } from '@renderer/features/http/ScriptTrustDialog'
import { WelcomeScreen } from '@renderer/features/onboarding/WelcomeScreen'
import { AppSettingsDialog } from '@renderer/features/settings/SettingsDialogs'
import { ShortcutsDialog } from '@renderer/features/settings/ShortcutsDialog'
import { useShortcutsDialog } from '@renderer/stores/shortcuts-store'
import { SaveAsDialog } from '@renderer/features/tabs/SaveAsDialog'
import {
  CurlImportDialog,
  ExportDialog,
  TransferResultDialog
} from '@renderer/features/transfer/TransferDialogs'
import { isTabDirty, toSession } from '@renderer/features/tabs/tab-model'
import { WorkspaceShell } from '@renderer/features/workspace/WorkspaceShell'
import { useSystemTheme } from '@renderer/hooks/use-system-theme'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/stores/app-store'
import { useEnvStore } from '@renderer/stores/env-store'
import { useHistoryStore } from '@renderer/stores/history-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useTransferStore } from '@renderer/stores/transfer-store'
import { useRunnerStore } from '@renderer/stores/runner-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { isLive, useWsStore } from '@renderer/stores/ws-store'

function useMainProcessEvents(): void {
  useEffect(() => {
    const store = useAppStore.getState
    const report = (error: unknown) => store().setNotice(errorMessage(error))
    const offs = [
      window.hachi.on(EVENTS.workspaceChanged, (ws) => store().workspaceChanged(ws)),
      window.hachi.on(EVENTS.configChanged, (config) => store().configChanged(config)),
      window.hachi.on(EVENTS.treeChanged, (tree) => useTreeStore.getState().applyTree(tree)),
      window.hachi.on(EVENTS.historyChanged, (usage) =>
        useHistoryStore.getState().usageChanged(usage)
      ),
      window.hachi.on(EVENTS.wsEvent, (payload) => useWsStore.getState().handleEvent(payload)),
      window.hachi.on(EVENTS.runnerEvent, (event) => useRunnerStore.getState().handleEvent(event)),
      window.hachi.on(EVENTS.variablesChanged, (event) => {
        void useEnvStore.getState().variablesChanged(event)
        useTabsStore.getState().variablesChanged(event)
      }),
      // Closing the window / quitting while tabs have unsaved changes.
      window.hachi.on(EVENTS.appCloseRequested, () => {
        void useTabsStore
          .getState()
          .guardLeave()
          .then((ok) => {
            if (ok) void window.hachi.app.confirmClose()
          })
      }),
      window.hachi.on(EVENTS.menuCommand, ({ command, path }) => {
        switch (command) {
          case 'workspace.new':
            store().showWelcome({ focusCreate: true })
            break
          case 'workspace.switch':
            store().showWelcome()
            break
          case 'workspace.open':
            store().openWorkspaceWithDialog().catch(report)
            break
          case 'workspace.openRecent':
            if (path) store().openWorkspace(path).catch(report)
            break
          case 'request.save':
            void useTabsStore.getState().save()
            break
          case 'tab.close':
            void useTabsStore.getState().closeActive()
            break
          case 'app.settings':
            store().setAppSettingsOpen(true)
            break
          // Importing needs an open Workspace (the welcome screen has nowhere to put it).
          case 'import.file':
            if (store().currentWorkspace) void useTransferStore.getState().importFile()
            else store().setNotice('請先建立或開啟 Workspace 再匯入')
            break
          case 'help.shortcuts':
            useShortcutsDialog.getState().setOpen(true)
            break
          case 'import.bruno':
            if (store().currentWorkspace) void useTransferStore.getState().importBrunoFolder()
            else store().setNotice('請先建立或開啟 Workspace 再匯入')
            break
          case 'import.curl':
            if (store().currentWorkspace) useTransferStore.getState().setCurlOpen(true)
            else store().setNotice('請先建立或開啟 Workspace 再匯入')
            break
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])
}

/** Remembers open tabs / active environment per Workspace, and guards window closing. */
function useSessionPersistence(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = ''
    const save = () => {
      const tabs = useTabsStore.getState()
      if (!tabs.sessionReady) return
      const session = toSession(tabs.tabs, tabs.activeKey, useEnvStore.getState().activeId)
      const json = JSON.stringify(session)
      if (json === last) return
      last = json
      void window.hachi.session.save(session)
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 300)
    }
    // Closing the window asks first while tabs are unsaved or WebSocket tabs are connected.
    let dirty = false
    const updateGuard = () => {
      const now =
        useTabsStore.getState().tabs.some(isTabDirty) ||
        Object.values(useWsStore.getState().sessions).some(isLive)
      if (now !== dirty) {
        dirty = now
        void window.hachi.app.setCloseGuard({ dirty })
      }
    }
    const offTabs = useTabsStore.subscribe((s, prev) => {
      if (s.sessionReady && !prev.sessionReady) last = ''
      if (s.tabs !== prev.tabs || s.activeKey !== prev.activeKey) schedule()
      updateGuard()
    })
    const offWs = useWsStore.subscribe((s, prev) => {
      if (s.sessions !== prev.sessions) updateGuard()
    })
    const offEnv = useEnvStore.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) schedule()
    })
    return () => {
      clearTimeout(timer)
      offTabs()
      offWs()
      offEnv()
    }
  }, [])
}

/** Loads everything that belongs to a Workspace: tree, environments, history, tabs. */
function useWorkspaceData(workspaceId: string | null): void {
  useEffect(() => {
    useTabsStore.getState().reset()
    useRunnerStore.getState().reset()
    useWsStore.getState().reset()
    useEnvStore.getState().reset()
    useHistoryStore.getState().reset()
    useTreeStore.getState().reset()
    if (!workspaceId) return
    let cancelled = false
    void (async () => {
      await useTreeStore.getState().load()
      const [session, list, usage] = await Promise.all([
        unwrap(window.hachi.session.get()).catch(() => null),
        useEnvStore.getState().loadList(),
        unwrap(window.hachi.history.getUsage()).catch(() => null),
        useEnvStore.getState().loadRuntime()
      ])
      if (cancelled) return
      if (usage) useHistoryStore.setState({ usage })
      const envId = session?.activeEnvironmentId
      if (envId && list.some((e) => e.id === envId && !e.error)) {
        await useEnvStore.getState().setActive(envId)
      }
      if (cancelled) return
      useTabsStore
        .getState()
        .restore(session ?? { tabs: [], activeTab: null, activeEnvironmentId: null })
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId])
}

function NoticeDialog() {
  const notice = useAppStore((s) => s.notice)
  const setNotice = useAppStore((s) => s.setNotice)
  return (
    <AlertDialog open={notice !== null} onOpenChange={(open) => !open && setNotice(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>操作失敗</AlertDialogTitle>
          <AlertDialogDescription>{notice}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>確定</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function App() {
  useSystemTheme()
  useMainProcessEvents()
  useSessionPersistence()
  const { status, bootError, currentWorkspace, welcomeRequested, bootstrap } = useAppStore()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useWorkspaceData(currentWorkspace?.id ?? null)

  // WebSocket log size (App setting).
  const messageLimit = useAppStore((s) => s.config?.websocket.messageLimit)
  useEffect(() => {
    if (messageLimit) useWsStore.getState().setMessageLimit(messageLimit)
  }, [messageLimit])

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
  return (
    <>
      {!currentWorkspace || welcomeRequested ? (
        <WelcomeScreen />
      ) : (
        <WorkspaceShell workspace={currentWorkspace} />
      )}
      <AppSettingsDialog />
      <UnsavedChangesDialog />
      <SaveAsDialog />
      <ScriptTrustDialog />
      <ShortcutsDialog />
      <CurlImportDialog />
      <ExportDialog />
      <TransferResultDialog />
      <NoticeDialog />
    </>
  )
}
