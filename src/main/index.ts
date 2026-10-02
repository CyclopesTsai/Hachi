import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow, app, dialog, nativeTheme, session, shell } from 'electron'
import { APP_NAME, WORKSPACE_DIR_NAME } from '@shared/app-info'
import { isHachiError } from '@shared/errors'
import type {
  CloseRequest,
  EventPayloads,
  HttpSendInput,
  WorkspaceInfo,
  WsConnectInput
} from '@shared/ipc/api'
import type { HttpResult } from '@shared/http'
import { HISTORY_INDEX_FILE } from '@shared/schemas/history'
import { SESSIONS_DIR } from '@shared/schemas/session'
import { EVENTS, type EventChannel, type MenuCommand } from '@shared/ipc/channels'
import { selectDirectory } from './dialogs'
import { createSenderValidator } from './ipc/handler'
import { registerIpcHandlers } from './ipc/register'
import { installMenu, type MenuActions } from './menu'
import { platform } from './platform'
import { applySecurityPolicies } from './security'
import { CollectionService, type TrashFn } from './services/collection-service'
import { APP_CONFIG_FILE, ConfigService } from './services/config-service'
import { EnvironmentService } from './services/environment-service'
import { HistoryService } from './services/history-service'
import { SessionService } from './services/session-service'
import { WsService } from './services/ws/ws-service'
import { resolveInherited } from './services/http/build-request'
import { HttpService } from './services/http/http-service'
import { WorkspaceService } from './services/workspace-service'
import { createMainWindow, getRendererUrl } from './window'

app.setName(APP_NAME)

// Lets automated tests (and power users) isolate app data, e.g. HACHI_USER_DATA_DIR=/tmp/hachi.
if (process.env.HACHI_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.HACHI_USER_DATA_DIR))
}

let mainWindow: BrowserWindow | null = null

function send<C extends EventChannel>(channel: C, payload: EventPayloads[C]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function showError(error: unknown): void {
  const message = isHachiError(error) ? error.message : String(error)
  void dialog.showMessageBox({
    type: 'error',
    title: APP_NAME,
    message: 'Operation failed',
    detail: message
  })
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  platform.setup()

  const rendererUrl = getRendererUrl()
  const isTrustedSender = createSenderValidator(rendererUrl)
  applySecurityPolicies((url) => isTrustedSender(url))

  const config = new ConfigService(path.join(app.getPath('userData'), APP_CONFIG_FILE))
  await config.load()
  nativeTheme.themeSource = config.get().theme

  const trash: TrashFn = (absPath) => shell.trashItem(absPath)
  const workspaces = new WorkspaceService(config, undefined, trash)
  const collections = new CollectionService(trash)
  const environments = new EnvironmentService(trash)
  const sessions = new SessionService(path.join(app.getPath('userData'), SESSIONS_DIR))
  const history = new HistoryService(
    path.join(app.getPath('userData'), HISTORY_INDEX_FILE),
    () => config.get().history.maxEntries
  )
  await history.load()

  // Collections, environments and history follow the current Workspace. Files are not
  // watched: changes made outside Hachi are picked up with the reload button.
  let openedPath: string | null = null
  workspaces.onChange((current) => {
    if ((current?.path ?? null) === openedPath) return // e.g. a rename: same folder
    openedPath = current?.path ?? null
    void collections.open(current?.path ?? null, current?.id ?? null)
    environments.open(current?.path ?? null)
    ws.disconnectAll()
    if (current) void history.sync(current.path).catch(showError)
  })
  collections.onChange((tree) => send(EVENTS.treeChanged, tree))
  history.onChange(() => {
    void history
      .usage(workspaces.getCurrent()?.path ?? null)
      .then((usage) => send(EVENTS.historyChanged, usage))
  })

  const requestDeps = {
    getContainerChain: (parentId: string | null) => collections.getChainFor(parentId),
    resolveInherited,
    getVariableLayers: async (parentId: string | null, environmentId: string | null) => {
      const layers = [
        await environments.layer(environmentId),
        await collections.getCollectionLayer(parentId)
      ]
      return layers.filter((l) => l !== null)
    },
    getWorkspaceSettings: () => workspaces.getSettings(),
    getProxySettings: () => config.get().proxy,
    // Platform-specific system proxy lookup is delegated to Chromium (macOS / Windows / Linux).
    resolveSystemProxy: (url: string) => session.defaultSession.resolveProxy(url),
    userAgent: `${APP_NAME}/${app.getVersion()}`
  }
  const http = new HttpService(requestDeps)

  const environmentName = (id: string | null): Promise<string | null> =>
    id
      ? environments
          .get(id)
          .then((e) => e.name)
          .catch(() => null)
      : Promise.resolve(null)

  // WebSocket connections are recorded in the history of the Workspace they were opened in.
  const wsContext = new Map<
    string,
    { workspacePath: string; requestId: string | null; environmentName: string | null }
  >()
  const ws = new WsService({
    ...requestDeps,
    emit: (payload) => send(EVENTS.wsEvent, payload),
    onFinished: (summary) => {
      const context = wsContext.get(summary.connectionId)
      wsContext.delete(summary.connectionId)
      if (!context) return
      void history
        .add(context.workspacePath, {
          id: randomUUID(),
          type: 'websocket',
          sentAt: new Date(summary.startedAt).toISOString(),
          requestId: context.requestId,
          environmentName: context.environmentName,
          request: summary.request,
          result: {
            openedAt: summary.openedAt ? new Date(summary.openedAt).toISOString() : null,
            closedAt: new Date(summary.closedAt).toISOString(),
            closeCode: summary.closeCode,
            closeReason: summary.closeReason,
            error: summary.error,
            sent: summary.sent,
            received: summary.received
          }
        })
        .catch((error: unknown) => console.warn(`[history] not recorded: ${String(error)}`))
    }
  })

  const connectWs = async (input: WsConnectInput) => {
    const workspace = workspaces.getCurrent()
    if (workspace) {
      wsContext.set(input.connectionId, {
        workspacePath: workspace.path,
        requestId: input.requestId,
        environmentName: await environmentName(input.environmentId)
      })
    }
    return ws.connect(input)
  }

  /** Sends, then records the request (unresolved, no response body) in the history. */
  const sendHttp = async (input: HttpSendInput): Promise<HttpResult> => {
    const workspace = workspaces.getCurrent()
    const sentAt = new Date().toISOString()
    const result = await http.send(input)
    if (workspace && !(result.kind === 'error' && result.code === 'CANCELLED')) {
      await history
        .add(workspace.path, {
          id: randomUUID(),
          type: 'http',
          sentAt,
          requestId: input.requestId,
          environmentName: await environmentName(input.environmentId),
          request: input.request,
          result:
            result.kind === 'response'
              ? {
                  kind: 'response',
                  status: result.status,
                  statusText: result.statusText,
                  timeMs: result.timings.totalMs,
                  sizeBytes: result.bodyBytes
                }
              : {
                  kind: 'error',
                  code: result.code,
                  message: result.message,
                  timeMs: result.timings.totalMs
                }
        })
        .catch((error: unknown) => console.warn(`[history] not recorded: ${String(error)}`))
    }
    return result
  }

  await workspaces.restoreLast()

  const defaultWorkspaceDir = path.join(app.getPath('documents'), WORKSPACE_DIR_NAME)

  // Unsaved tabs: while the renderer reports unsaved changes, closing the window
  // (or quitting) is cancelled and the renderer asks the user first.
  let closeGuardDirty = false
  let quitRequested = false
  let pendingClose: CloseRequest['reason'] | null = null
  let closeConfirmed = false
  app.on('before-quit', () => {
    quitRequested = true
  })

  const ensureWindow = async (): Promise<BrowserWindow> => {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
    mainWindow = createMainWindow()
    const created = mainWindow
    created.on('close', (event) => {
      const reason = quitRequested ? 'quit' : 'close'
      quitRequested = false
      if (!closeGuardDirty || closeConfirmed) return
      event.preventDefault()
      pendingClose = reason
      send(EVENTS.appCloseRequested, { reason })
    })
    created.on('closed', () => {
      if (mainWindow === created) mainWindow = null
      ws.disconnectAll()
      closeGuardDirty = false
      closeConfirmed = false
    })
    // A reloaded or crashed renderer has lost its tabs: nothing left to protect.
    created.webContents.on('did-start-loading', () => {
      closeGuardDirty = false
      ws.disconnectAll()
    })
    created.webContents.on('render-process-gone', () => {
      closeGuardDirty = false
      ws.disconnectAll()
    })
    await new Promise<void>((resolve) =>
      created.webContents.once('did-finish-load', () => resolve())
    )
    return created
  }

  const confirmClose = (): void => {
    const reason = pendingClose
    pendingClose = null
    if (!reason || !mainWindow) return
    closeConfirmed = true
    if (reason === 'quit') app.quit()
    else mainWindow.close()
  }

  const sendMenuCommand = (command: MenuCommand, extra: { path?: string } = {}): void => {
    void ensureWindow().then((win) => {
      win.focus()
      send(EVENTS.menuCommand, { command, ...extra })
    })
  }

  const openWorkspaceWithDialog = async (): Promise<WorkspaceInfo | null> => {
    const dir = await selectDirectory(mainWindow, {
      title: 'Open Workspace',
      defaultPath: defaultWorkspaceDir
    })
    return dir ? workspaces.open(dir) : null
  }

  // Opening a Workspace goes through the renderer, which asks about unsaved tabs first.
  const menuActions: MenuActions = {
    newWorkspace: () => sendMenuCommand('workspace.new'),
    switchWorkspace: () => sendMenuCommand('workspace.switch'),
    save: () => sendMenuCommand('request.save'),
    closeTab: () => sendMenuCommand('tab.close'),
    openSettings: () => sendMenuCommand('app.settings'),
    openWorkspace: () => sendMenuCommand('workspace.open'),
    openRecentWorkspace: (workspacePath) =>
      sendMenuCommand('workspace.openRecent', { path: workspacePath }),
    clearRecentWorkspaces: () => {
      void config.clearRecentWorkspaces().catch(showError)
    }
  }

  // Reload / Developer Tools only in development (HACHI_PRODUCTION_MENU=1 lets tests check
  // the menu of packaged builds). Reloading would silently drop unsaved tabs.
  const menuOptions = {
    developerItems: !app.isPackaged && process.env.HACHI_PRODUCTION_MENU !== '1'
  }
  installMenu(config.get().recentWorkspaces, menuActions, menuOptions)
  config.onChange((next) => {
    installMenu(next.recentWorkspaces, menuActions, menuOptions)
    send(EVENTS.configChanged, next)
  })
  workspaces.onChange((current) => send(EVENTS.workspaceChanged, current))

  registerIpcHandlers({
    config,
    workspaces,
    collections,
    http,
    environments,
    history,
    sessions,
    sendHttp,
    ws,
    connectWs,
    setCloseGuard: (dirty) => {
      closeGuardDirty = dirty
    },
    confirmClose,
    defaultWorkspaceDir,
    getWindow: () => mainWindow,
    isTrustedSender,
    openWorkspaceWithDialog
  })

  await ensureWindow()

  // macOS: re-create the window when the dock icon is clicked and no window is open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void ensureWindow()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => {
    if (platform.quitWhenAllWindowsClosed) app.quit()
  })
  bootstrap().catch((error: unknown) => {
    dialog.showErrorBox(`${APP_NAME} failed to start`, String(error))
    app.exit(1)
  })
}
