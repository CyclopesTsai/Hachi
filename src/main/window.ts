import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, nativeTheme } from 'electron'
import { APP_NAME } from '@shared/app-info'

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820

/** URL of the renderer page: Vite dev server in development, bundled file in production. */
export function getRendererUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) return devUrl
  return pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 900,
    minHeight: 600,
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
  window.once('ready-to-show', () => window.show())

  void window.loadURL(getRendererUrl())
  return window
}
