/**
 * Derives the other icon files from build/icon.svg (the app icon, macOS proportions:
 * a 824×824 rounded square centered on a transparent 1024×1024 canvas):
 *
 * - src/renderer/src/assets/app-icon.svg: the logo inside the app (title bar, welcome
 *   screen), cropped to the rounded square, without the file's metadata.
 * - build/icon-win.png: Windows icon (1024×1024), cropped the same way: Windows does not
 *   leave the macOS margin, so the uncropped icon would look smaller than other apps.
 *
 * build/icon.png (macOS) is exported with the SVG. Runs under Electron to render the SVG:
 *
 *   npx electron scripts/make-icon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'

const root = path.join(import.meta.dirname, '..')
const SIZE = 1024
// The rounded square of build/icon.svg.
const CROP = '100 100 824 824'

const source = readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')
const cropped = source
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/\s+xmlns:c2pa="[^"]*"/, '')
  .replace(/viewBox="[^"]*"/, `viewBox="${CROP}"`)
  .replace(/\s+width="\d+"\s+height="\d+"/, '')
if (!cropped.includes(`viewBox="${CROP}"`)) throw new Error('build/icon.svg has no viewBox')

writeFileSync(path.join(root, 'src', 'renderer', 'src', 'assets', 'app-icon.svg'), cropped)

app.disableHardwareAcceleration()
// No top-level await: Electron emits 'ready' only after the main module has finished.
void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const svg = cropped.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)
  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      `<html><body style="margin:0;background:transparent">${svg}</body></html>`
    )}`
  )
  // Offscreen windows hand each rendered frame to 'paint': once the page has loaded,
  // ask for a fresh frame and keep it (earlier frames can still be blank).
  await new Promise((resolve) => setTimeout(resolve, 300))
  const painted = new Promise((resolve) =>
    win.webContents.once('paint', (_e, _d, frame) => resolve(frame))
  )
  win.webContents.invalidate()
  let image = await painted
  if (image.getSize().width !== SIZE) {
    image = image.resize({ width: SIZE, height: SIZE, quality: 'best' })
  }
  writeFileSync(path.join(root, 'build', 'icon-win.png'), image.toPNG())
  console.log('Wrote src/renderer/src/assets/app-icon.svg and build/icon-win.png')
  app.quit()
})
