import path from 'node:path'
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { RecentWorkspace } from '@shared/schemas/app-config'
import { platform } from './platform'

export interface MenuActions {
  newWorkspace(): void
  openWorkspace(): void
  openRecentWorkspace(workspacePath: string): void
  clearRecentWorkspaces(): void
  switchWorkspace(): void
  /** Saves the active tab (CmdOrCtrl+S). */
  save(): void
  /** Closes the active tab (CmdOrCtrl+W); the window when no tab is open. */
  closeTab(): void
  openSettings(): void
  /** Import a Postman Collection / Environment or Bruno JSON file (no shortcut). */
  importFile(): void
  /** Paste a cURL command into a new request (no shortcut). */
  importCurl(): void
  /** Import a Bruno collection folder (no shortcut). */
  importBruno(): void
  /** Help → Keyboard Shortcuts (decision 96, no shortcut). */
  showShortcuts(): void
}

export interface MenuOptions {
  /** Reload / Force Reload / Developer Tools (development builds only, decision 50). */
  developerItems: boolean
}

const focusedWindow = () => BrowserWindow.getFocusedWindow()

function zoom(delta: number | 'reset'): void {
  const contents = focusedWindow()?.webContents
  if (contents) contents.setZoomLevel(delta === 'reset' ? 0 : contents.getZoomLevel() + delta)
}

/**
 * Builds the native menu bar: Hachi (macOS only) / File / Edit / View / Window.
 *
 * Keyboard shortcuts are deliberately few (decisions 21, 43, 49): only the items
 * below with an `accelerator`, plus Edit and Quit. View / Window items use plain
 * click handlers instead of Electron roles, because roles bring their own shortcuts.
 */
export function buildMenuTemplate(
  recent: RecentWorkspace[],
  actions: MenuActions,
  options: MenuOptions
): MenuItemConstructorOptions[] {
  const developerItems: MenuItemConstructorOptions[] = options.developerItems
    ? [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => focusedWindow()?.webContents.reload()
        },
        { label: 'Force Reload', click: () => focusedWindow()?.webContents.reloadIgnoringCache() },
        {
          label: 'Toggle Developer Tools',
          click: () => focusedWindow()?.webContents.toggleDevTools()
        },
        { type: 'separator' }
      ]
    : []

  const recentItems: MenuItemConstructorOptions[] =
    recent.length === 0
      ? [{ label: 'No Recent Workspaces', enabled: false }]
      : [
          ...recent.map((r): MenuItemConstructorOptions => ({
            label: `${r.name} — ${path.dirname(r.path)}`,
            click: () => actions.openRecentWorkspace(r.path)
          })),
          { type: 'separator' },
          { label: 'Clear Recent', click: () => actions.clearRecentWorkspaces() }
        ]

  return [
    ...platform.leadingMenus(() => actions.openSettings()),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Workspace…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => actions.newWorkspace()
        },
        {
          label: 'Open Workspace…',
          accelerator: 'CmdOrCtrl+O',
          click: () => actions.openWorkspace()
        },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Switch Workspace…', click: () => actions.switchWorkspace() },
        { type: 'separator' },
        { label: 'Import…', click: () => actions.importFile() },
        { label: 'Import Bruno Collection…', click: () => actions.importBruno() },
        { label: 'Import cURL…', click: () => actions.importCurl() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => actions.save() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => actions.closeTab() },
        ...platform.fileMenuSettings(() => actions.openSettings()),
        { type: 'separator' },
        ...platform.fileMenuTail()
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...developerItems,
        { label: 'Actual Size', click: () => zoom('reset') },
        { label: 'Zoom In', click: () => zoom(0.5) },
        { label: 'Zoom Out', click: () => zoom(-0.5) },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          click: () => {
            const window = focusedWindow()
            window?.setFullScreen(!window.isFullScreen())
          }
        }
      ]
    },
    platform.windowMenu(() => focusedWindow()?.minimize()),
    platform.helpMenu([{ label: 'Keyboard Shortcuts', click: () => actions.showShortcuts() }])
  ]
}

export function installMenu(
  recent: RecentWorkspace[],
  actions: MenuActions,
  options: MenuOptions
): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(recent, actions, options)))
}
