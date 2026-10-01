import path from 'node:path'
import { BrowserWindow, app, dialog, nativeTheme } from 'electron'
import { APP_NAME, WORKSPACE_DIR_NAME } from '@shared/app-info'
import { isHachiError } from '@shared/errors'
import type { EventPayloads, WorkspaceInfo } from '@shared/ipc/api'
import { EVENTS, type EventChannel, type MenuCommand } from '@shared/ipc/channels'
import { selectDirectory } from './dialogs'
import { createSenderValidator } from './ipc/handler'
import { registerIpcHandlers } from './ipc/register'
import { installMenu, type MenuActions } from './menu'
import { platform } from './platform'
import { applySecurityPolicies } from './security'
import { APP_CONFIG_FILE, ConfigService } from './services/config-service'
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

  const workspaces = new WorkspaceService(config)
  await workspaces.restoreLast()

  const defaultWorkspaceDir = path.join(app.getPath('documents'), WORKSPACE_DIR_NAME)

  const ensureWindow = async (): Promise<BrowserWindow> => {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
    mainWindow = createMainWindow()
    const created = mainWindow
    created.on('closed', () => {
      if (mainWindow === created) mainWindow = null
    })
    await new Promise<void>((resolve) =>
      created.webContents.once('did-finish-load', () => resolve())
    )
    return created
  }

  const sendMenuCommand = (command: MenuCommand): void => {
    void ensureWindow().then((win) => {
      win.focus()
      send(EVENTS.menuCommand, { command })
    })
  }

  const openWorkspaceWithDialog = async (): Promise<WorkspaceInfo | null> => {
    const dir = await selectDirectory(mainWindow, {
      title: 'Open Workspace',
      defaultPath: defaultWorkspaceDir
    })
    return dir ? workspaces.open(dir) : null
  }

  const menuActions: MenuActions = {
    newWorkspace: () => sendMenuCommand('workspace.new'),
    switchWorkspace: () => sendMenuCommand('workspace.switch'),
    openWorkspace: () => {
      void ensureWindow()
        .then(() => openWorkspaceWithDialog())
        .catch(showError)
    },
    openRecentWorkspace: (workspacePath) => {
      void ensureWindow()
        .then(() => workspaces.open(workspacePath))
        .catch(showError)
    },
    clearRecentWorkspaces: () => {
      void config.clearRecentWorkspaces().catch(showError)
    }
  }

  installMenu(config.get().recentWorkspaces, menuActions)
  config.onChange((next) => {
    installMenu(next.recentWorkspaces, menuActions)
    send(EVENTS.configChanged, next)
  })
  workspaces.onChange((current) => send(EVENTS.workspaceChanged, current))

  registerIpcHandlers({
    config,
    workspaces,
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
