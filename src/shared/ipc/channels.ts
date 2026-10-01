/**
 * IPC channel names. Pure constants only — this module is bundled into the
 * sandboxed preload script, so it must not import zod, node or electron.
 *
 * Naming: `<domain>:<action>`. Keep docs/ipc.md in sync when changing this file.
 */

/** Renderer → Main request/response channels (ipcRenderer.invoke / ipcMain.handle). */
export const INVOKE = {
  appGetInfo: 'app:getInfo',
  appGetDefaultWorkspaceDir: 'app:getDefaultWorkspaceDir',
  configGet: 'config:get',
  configUpdate: 'config:update',
  workspaceGetCurrent: 'workspace:getCurrent',
  workspaceCreate: 'workspace:create',
  workspaceOpen: 'workspace:open',
  workspaceOpenWithDialog: 'workspace:openWithDialog',
  workspaceListRecent: 'workspace:listRecent',
  workspaceRemoveRecent: 'workspace:removeRecent',
  dialogSelectDirectory: 'dialog:selectDirectory'
} as const

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE]

/** Main → Renderer push events (webContents.send / ipcRenderer.on). */
export const EVENTS = {
  menuCommand: 'menu:command',
  workspaceChanged: 'workspace:changed',
  configChanged: 'config:changed'
} as const

export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS]

export const EVENT_CHANNELS: readonly EventChannel[] = Object.values(EVENTS)

/** Commands sent from the native menu to the renderer through `menu:command`. */
export const MENU_COMMANDS = ['workspace.new', 'workspace.switch'] as const
export type MenuCommand = (typeof MENU_COMMANDS)[number]
