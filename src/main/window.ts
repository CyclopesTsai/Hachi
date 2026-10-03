import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, nativeTheme, screen } from 'electron'
import { APP_NAME } from '@shared/app-info'
import type { WindowState } from '@shared/schemas/app-config'
import { MIN_HEIGHT, MIN_WIDTH, initialBounds, windowStateOf } from './window-state'

/** Saving waits until moving / resizing has settled. */
const SAVE_DELAY_MS = 500

/** URL of the renderer page: Vite dev server in development, bundled file in production. */
export function getRendererUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) return devUrl
  return pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
}

/**
 * Creates the main window at its remembered position / size (decision 94) and reports
 * changes through `saveState` (debounced, and right away when the window closes).
 */
export function createMainWindow(
  saved: WindowState | null = null,
  saveState: (state: WindowState) => void = () => undefined
): BrowserWindow {
  const bounds = initialBounds(
    saved,
    screen.getAllDisplays().map((d) => d.workArea)
  )
  const window = new BrowserWindow({
    title: APP_NAME,
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      // Security baseline — see docs/ipc.md "Security".
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  // Keep the window title fixed to the app name (HTML <title> changes are ignored).
  window.on('page-title-updated', (event) => event.preventDefault())
  window.once('ready-to-show', () => {
    if (saved?.isMaximized) window.maximize()
    if (saved?.isFullScreen) window.setFullScreen(true)
    window.show()
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const current = () =>
    windowStateOf(window.getNormalBounds(), {
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen()
    })
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!window.isDestroyed()) saveState(current())
    }, SAVE_DELAY_MS)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    window.on(event as 'resize', schedule)
  }
  window.on('enter-full-screen', schedule)
  window.on('leave-full-screen', schedule)
  window.on('close', () => {
    clearTimeout(timer)
    saveState(current())
  })

  void window.loadURL(getRendererUrl())
  return window
}
