/**
 * Windows / Linux behavior. Windows-specific tweaks (installer integration,
 * jump lists, …) should be added here or split into `win32.ts` when needed.
 */
import { app, dialog, type MenuItemConstructorOptions } from 'electron'
import { APP_ID, APP_NAME, LEGAL_NOTICE } from '@shared/app-info'
import type { PlatformAdapter } from './types'

function showAboutDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: `About ${APP_NAME}`,
    message: APP_NAME,
    // Appropriate Legal Notices (AGPL-3.0 section 5(d)).
    detail: `Version ${app.getVersion()}\n\n${LEGAL_NOTICE}`,
    buttons: ['OK']
  })
}

export function createDefaultAdapter(id: 'win32' | 'linux'): PlatformAdapter {
  return {
    id,

    gitCandidates() {
      if (id === 'linux') return ['/usr/bin/git', '/usr/local/bin/git']
      const local = process.env.LOCALAPPDATA
      return [
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
        ...(local ? [`${local}\\Programs\\Git\\cmd\\git.exe`] : [])
      ]
    },

    gitUsable() {
      return Promise.resolve(true)
    },

    setup() {
      // Windows: required for notifications and taskbar grouping.
      if (id === 'win32') app.setAppUserModelId(APP_ID)
    },

    leadingMenus() {
      return []
    },

    fileMenuSettings(openSettings): MenuItemConstructorOptions[] {
      return [{ label: 'Settings…', click: openSettings }]
    },

    windowMenu(minimize): MenuItemConstructorOptions {
      // Electron's Window role menu adds Close (Ctrl+W), which would clash with Close Tab.
      return { label: 'Window', submenu: [{ label: 'Minimize', click: minimize }] }
    },

    fileMenuTail(): MenuItemConstructorOptions[] {
      return [{ role: 'quit', label: 'Exit' }]
    },

    helpMenu(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions {
      return {
        role: 'help',
        submenu: [
          ...items,
          { type: 'separator' },
          { label: `About ${APP_NAME}`, click: showAboutDialog }
        ]
      }
    }
  }
}
