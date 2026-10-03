/**
 * macOS-specific behavior.
 */
import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron'
import { APP_COPYRIGHT, APP_NAME, LEGAL_NOTICE } from '@shared/app-info'
import type { PlatformAdapter } from './types'

export const darwinAdapter: PlatformAdapter = {
  id: 'darwin',
  quitWhenAllWindowsClosed: false,

  setup() {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: APP_COPYRIGHT,
      // Appropriate Legal Notices (AGPL-3.0 section 5(d)).
      credits: LEGAL_NOTICE.split('\n\n').slice(1).join('\n\n')
    })
  },

  leadingMenus(openSettings): MenuItemConstructorOptions[] {
    // macOS always titles the first menu with the app name; set label explicitly for dev runs.
    return [
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `About ${APP_NAME}` },
          { type: 'separator' },
          // No ⌘, / ⌘H / ⌥⌘H shortcuts (decision 49), so plain items instead of roles.
          { label: 'Settings…', click: openSettings },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { label: `Hide ${APP_NAME}`, click: () => app.hide() },
          {
            label: 'Hide Others',
            click: () => Menu.sendActionToFirstResponder('hideOtherApplications:')
          },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: `Quit ${APP_NAME}` }
        ]
      }
    ]
  },

  fileMenuSettings(): MenuItemConstructorOptions[] {
    return []
  },

  fileMenuTail(): MenuItemConstructorOptions[] {
    // ⌘W closes the active tab (File → Close Tab); Close Window has no shortcut.
    return [{ label: 'Close Window', click: () => BrowserWindow.getFocusedWindow()?.close() }]
  },

  windowMenu(minimize): MenuItemConstructorOptions {
    // role "window" makes macOS list the open windows here; Zoom / Bring All to Front
    // have no shortcuts.
    return {
      label: 'Window',
      role: 'window',
      submenu: [
        { label: 'Minimize', click: minimize },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  },

  helpMenu(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions {
    // role "help": macOS adds its menu search field to this menu.
    return { role: 'help', submenu: items }
  }
}
