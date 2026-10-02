/**
 * macOS-specific behavior.
 */
import { app, type MenuItemConstructorOptions } from 'electron'
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
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: `Hide ${APP_NAME}` },
          { role: 'hideOthers' },
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
    // CmdOrCtrl+W closes the active tab (File → Close Tab).
    return [{ role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }]
  },

  trailingMenus(): MenuItemConstructorOptions[] {
    return []
  }
}
