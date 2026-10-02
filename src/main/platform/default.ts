/**
 * Windows / Linux behavior. Windows-specific tweaks (installer integration,
 * jump lists, …) should be added here or split into `win32.ts` when needed.
 */
import { app, dialog, type MenuItemConstructorOptions } from 'electron'
import { APP_COPYRIGHT, APP_ID, APP_NAME } from '@shared/app-info'
import type { PlatformAdapter } from './types'

function showAboutDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: `About ${APP_NAME}`,
    message: APP_NAME,
    detail: `Version ${app.getVersion()}\n${APP_COPYRIGHT}`,
    buttons: ['OK']
  })
}

export function createDefaultAdapter(id: 'win32' | 'linux'): PlatformAdapter {
  return {
    id,
    quitWhenAllWindowsClosed: true,

    setup() {
      // Windows: required for notifications and taskbar grouping.
      if (id === 'win32') app.setAppUserModelId(APP_ID)
    },

    leadingMenus() {
      return []
    },

    fileMenuSettings(openSettings): MenuItemConstructorOptions[] {
      return [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings }]
    },

    fileMenuTail(): MenuItemConstructorOptions[] {
      return [{ role: 'quit', label: 'Exit' }]
    },

    trailingMenus(): MenuItemConstructorOptions[] {
      return [{ role: 'help', submenu: [{ label: `About ${APP_NAME}`, click: showAboutDialog }] }]
    }
  }
}
