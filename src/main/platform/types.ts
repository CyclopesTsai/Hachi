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
  /** Items appended to the end of the File menu (macOS: Close Window; others: Exit). */
  fileMenuTail(): MenuItemConstructorOptions[]
  /** The Window menu, without keyboard shortcuts (Electron's role menu brings ⌘M / Ctrl+W). */
  windowMenu(minimize: () => void): MenuItemConstructorOptions
  /**
   * The Help menu: `items` (e.g. Keyboard Shortcuts) plus, on non-macOS, About (there is
   * no app menu there).
   */
  helpMenu(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions
  /**
   * Where git may be installed besides PATH (decision 111): GUI apps get a short PATH on
   * macOS, and Git for Windows is often not on it.
   */
  gitCandidates(): string[]
  /**
   * Whether running this git is safe: macOS's /usr/bin/git is a stub that opens the
   * "install developer tools" dialog when the tools are missing.
   */
  gitUsable(file: string): Promise<boolean>
  /** Called once at startup (About panel, app user model id, …). */
  setup(): void
}
