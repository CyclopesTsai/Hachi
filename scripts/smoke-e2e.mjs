#!/usr/bin/env node
/**
 * End-to-end smoke test: launches the built app (run `npm run build` first),
 * walks through first-run onboarding and verifies files on disk.
 *
 *   node scripts/smoke-e2e.mjs            # on Linux CI wrap with `xvfb-run -a`
 *   SMOKE_SCREENSHOT_DIR=/tmp/shots node scripts/smoke-e2e.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = path.resolve(import.meta.dirname, '..')
const shots = process.env.SMOKE_SCREENSHOT_DIR ?? path.join(root, 'out', 'smoke')
const tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-smoke-'))
const userData = path.join(tmp, 'userData')
const docs = path.join(tmp, 'Documents', 'Hachi')
await mkdir(shots, { recursive: true })

const args = [root]
// Chromium refuses to run as root without this flag (CI containers).
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath,
    args,
    env: { ...process.env, HACHI_USER_DATA_DIR: userData, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

function step(name) {
  console.log(`✔ ${name}`)
}

try {
  // ---- First launch: onboarding ----
  let { app, page } = await launch()
  await page.getByTestId('welcome-screen').waitFor()
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.screenshot({ path: path.join(shots, '1-first-run.png') })
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()),
    'Hachi'
  )
  step('first launch shows onboarding, window title is "Hachi"')

  const security = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
    ipcRenderer: typeof window.ipcRenderer,
    apiKeys: Object.keys(window.hachi).sort(),
    workspaceKeys: Object.keys(window.hachi.workspace).sort()
  }))
  assert.deepEqual(security, {
    require: 'undefined',
    process: 'undefined',
    ipcRenderer: 'undefined',
    apiKeys: ['app', 'config', 'dialog', 'on', 'workspace'],
    workspaceKeys: ['create', 'getCurrent', 'listRecent', 'open', 'openWithDialog', 'removeRecent']
  })
  step('renderer has no Node/Electron access; only the window.hachi whitelist')

  const bad = await page.evaluate(() =>
    Promise.all([
      window.hachi.workspace.create({ name: 'x', parentDir: 'relative/path' }),
      window.hachi.workspace.create({ name: 'x', parentDir: '/tmp', evil: 1 }),
      window.hachi.config.update({ theme: 'neon' })
    ])
  )
  for (const r of bad) assert.equal(r.error?.code, 'VALIDATION_ERROR')
  const unknownEvent = await page.evaluate(() => {
    try {
      window.hachi.on('some:private-channel', () => {})
      return 'subscribed'
    } catch {
      return 'rejected'
    }
  })
  assert.equal(unknownEvent, 'rejected')
  step('IPC rejects invalid input and non-whitelisted event channels')

  const config0 = JSON.parse(await readFile(path.join(userData, 'app-config.json'), 'utf8'))
  assert.equal(config0.version, 1)
  assert.deepEqual(config0.recentWorkspaces, [])
  step('app-config.json created in userData with version 1')

  const menu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((i) => ({
      label: i.label,
      items: i.submenu?.items.map((s) => s.label).filter(Boolean)
    }))
  )
  const fileMenu = menu.find((m) => m.label === 'File')
  assert.ok(fileMenu, 'File menu exists')
  for (const label of ['New Workspace…', 'Open Workspace…', 'Open Recent', 'Switch Workspace…']) {
    assert.ok(fileMenu.items.includes(label), `File menu has ${label}`)
  }
  for (const label of ['Edit', 'View', 'Window']) {
    assert.ok(
      menu.some((m) => m.label === label),
      `${label} menu exists`
    )
  }
  step(`native menu: ${menu.map((m) => m.label).join(' / ')}`)

  await page.getByLabel('名稱').fill('Smoke API')
  await page.getByLabel('存放位置').fill(docs)
  const preview = await page.getByTestId('workspace-path-preview').innerText()
  assert.ok(preview.includes(path.join(docs, 'Smoke API')), preview)
  await page.getByRole('button', { name: '建立 Workspace' }).click()
  await page.getByTestId('workspace-shell').waitFor()
  assert.equal(await page.getByTestId('current-workspace-name').innerText(), 'Smoke API')
  await page.screenshot({ path: path.join(shots, '2-workspace.png') })
  step('creating a Workspace from the onboarding form opens it')

  const wsDir = path.join(docs, 'Smoke API')
  assert.deepEqual((await readdir(wsDir)).sort(), [
    '.gitignore',
    'collections',
    'environments',
    'history.json',
    'workspace.json'
  ])
  const wsFile = JSON.parse(await readFile(path.join(wsDir, 'workspace.json'), 'utf8'))
  assert.equal(wsFile.version, 1)
  assert.equal(wsFile.name, 'Smoke API')
  const gitignore = await readFile(path.join(wsDir, '.gitignore'), 'utf8')
  assert.ok(gitignore.includes('.hachi-secrets.json') && gitignore.includes('history.json'))
  const config1 = JSON.parse(await readFile(path.join(userData, 'app-config.json'), 'utf8'))
  assert.equal(config1.lastWorkspacePath, wsDir)
  assert.equal(config1.recentWorkspaces[0].path, wsDir)
  step('workspace folder skeleton + app-config recent list written to disk')

  // Menu → Switch Workspace… shows the welcome screen with the recent list.
  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find((i) => i.label === 'File')
    file.submenu.items.find((i) => i.label === 'Switch Workspace…').click()
  })
  await page.getByTestId('welcome-screen').waitFor()
  assert.ok((await page.getByTestId('recent-workspaces').innerText()).includes('Smoke API'))
  await page.screenshot({ path: path.join(shots, '3-switch.png') })
  step('File → Switch Workspace… shows the welcome screen with recent Workspaces')

  await app.close()

  // ---- Second launch: last Workspace is restored ----
  ;({ app, page } = await launch())
  await page.getByTestId('workspace-shell').waitFor()
  assert.equal(await page.getByTestId('current-workspace-name').innerText(), 'Smoke API')
  step('relaunch restores the last opened Workspace')
  await app.close()

  console.log(`\nAll smoke checks passed. Screenshots: ${shots}`)
} finally {
  await rm(tmp, { recursive: true, force: true })
}
