/**
 * Derives the other icon files from build/icon.svg (the app icon, macOS proportions:
 * a 824×824 rounded square centered on a transparent 1024×1024 canvas):
 *
 * - src/renderer/src/assets/app-logo.svg: the logo inside the app (title bar, welcome
 *   screen): only the dog, without the blue square, with a dark rounded outline so the
 *   cream chin and light collar stand out on the light theme's white background.
 * - build/icon-win.png: Windows icon (1024×1024), cropped the same way: Windows does not
 *   leave the macOS margin, so the uncropped icon would look smaller than other apps.
 *
 * build/icon.png (macOS) is exported with the SVG. Runs under Electron to render the SVG:
 *
 *   npx electron scripts/make-icon.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

// The dog's group: every shape is repeated behind it, filled and stroked with round
// joins, so the outline follows the silhouette with rounded corners.
const OUTLINE_COLOR = '#2E3440' // Nord 0: the dark theme's background, so it vanishes there
const OUTLINE_WIDTH = 44 // in the group's units (scaled .88): about 1px at 28px
const LOGO_CROP = '222 204 580 580'
const group = cropped.match(/<g transform="[^"]*">[\s\S]*<\/g>/)?.[0]
if (!group) throw new Error('build/icon.svg: the dog group was not found')
const outline = [...group.matchAll(/<polygon points="([^"]*)"/g)]
  .map(
    ([, points]) =>
      `<polygon points="${points}" fill="${OUTLINE_COLOR}" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round"/>`
  )
  .join('')
const logo = cropped
  .replace(/<rect [^>]*fill="url\(#bg\)"[^>]*\/>/, '')
  .replace(/<defs>[\s\S]*?<\/defs>/, '')
  .replace(`viewBox="${CROP}"`, `viewBox="${LOGO_CROP}"`)
  .replace(/(<g transform="[^"]*">)/, `$1<g>${outline}</g>`)
const assets = path.join(root, 'src', 'renderer', 'src', 'assets')
mkdirSync(assets, { recursive: true })
writeFileSync(path.join(assets, 'app-logo.svg'), logo)

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
  console.log('Wrote src/renderer/src/assets/app-logo.svg and build/icon-win.png')
  app.quit()
})
