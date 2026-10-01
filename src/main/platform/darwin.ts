/**
 * macOS-specific behavior.
 */
import { app, type MenuItemConstructorOptions } from 'electron'
import { APP_COPYRIGHT, APP_NAME } from '@shared/app-info'
import type { PlatformAdapter } from './types'

export const darwinAdapter: PlatformAdapter = {
  id: 'darwin',
  quitWhenAllWindowsClosed: false,

  setup() {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: APP_COPYRIGHT
    })
  },

  leadingMenus(): MenuItemConstructorOptions[] {
    // macOS always titles the first menu with the app name; set label explicitly for dev runs.
    return [
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `About ${APP_NAME}` },
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

  fileMenuTail(): MenuItemConstructorOptions[] {
    return [{ role: 'close' }]
  },

  trailingMenus(): MenuItemConstructorOptions[] {
    return []
  }
}
