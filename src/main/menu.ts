import path from 'node:path'
import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { RecentWorkspace } from '@shared/schemas/app-config'
import { platform } from './platform'

export interface MenuActions {
  newWorkspace(): void
  openWorkspace(): void
  openRecentWorkspace(workspacePath: string): void
  clearRecentWorkspaces(): void
  switchWorkspace(): void
}

/**
 * Builds the native menu bar: Hachi (macOS only) / File / Edit / View / Window.
 * Accelerators use `CmdOrCtrl` so the same template works on every platform.
 */
export function buildMenuTemplate(
  recent: RecentWorkspace[],
  actions: MenuActions
): MenuItemConstructorOptions[] {
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
    ...platform.leadingMenus(),
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
        ...platform.fileMenuTail()
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    ...platform.trailingMenus()
  ]
}

export function installMenu(recent: RecentWorkspace[], actions: MenuActions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(recent, actions)))
}
