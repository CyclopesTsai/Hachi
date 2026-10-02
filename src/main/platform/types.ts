import type { MenuItemConstructorOptions } from 'electron'

/**
 * Platform-specific behavior.
 *
 * Every `process.platform` branch in the main process lives in this folder so
 * that adding Windows / Linux support means adding or editing one adapter,
 * not hunting through the codebase.
 */
export interface PlatformAdapter {
  readonly id: 'darwin' | 'win32' | 'linux'
  /** Menus prepended to the menu bar (macOS: the application menu named "Hachi"). */
  leadingMenus(openSettings: () => void): MenuItemConstructorOptions[]
  /** "Settings…" in the File menu (non-macOS; macOS has it in the app menu). */
  fileMenuSettings(openSettings: () => void): MenuItemConstructorOptions[]
  /** Items appended to the end of the File menu (macOS: Close Window, CmdOrCtrl+Shift+W; others: Quit). */
  fileMenuTail(): MenuItemConstructorOptions[]
  /** Menus appended to the menu bar (non-macOS: Help → About, since there is no app menu). */
  trailingMenus(): MenuItemConstructorOptions[]
  /** macOS convention: apps stay alive with no windows open. */
  readonly quitWhenAllWindowsClosed: boolean
  /** Called once at startup (About panel, app user model id, …). */
  setup(): void
}
