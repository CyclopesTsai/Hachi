#!/usr/bin/env node
/**
 * End-to-end smoke test: launches the built app (run `npm run build` first),
 * walks through first-run onboarding and verifies files on disk.
 *
 *   node scripts/smoke-e2e.mjs            # on Linux CI wrap with `xvfb-run -a`
 *   SMOKE_SCREENSHOT_DIR=/tmp/shots node scripts/smoke-e2e.mjs
 */
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function waitUntil(predicate, what, timeoutMs = 5000) {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

/** Helpers bound to the current page (re-created after a relaunch). */
function treeHelpers(page) {
  const row = (name) => page.locator(`[data-testid="tree-row"][data-name="${name}"]`)
  const renameInput = page.getByTestId('tree-rename-input')

  async function typeName(name) {
    await renameInput.waitFor()
    await renameInput.fill(name)
    await renameInput.press('Enter')
    await row(name).waitFor()
  }

  async function contextAction(name, label) {
    await row(name).click({ button: 'right' })
    await page.getByRole('menuitem', { name: label }).click()
  }

  async function drag(sourceName, targetName, where) {
    const s = await row(sourceName).boundingBox()
    const t = await row(targetName).boundingBox()
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 + 12, { steps: 4 })
    const y =
      where === 'inside' ? t.y + t.height / 2 : where === 'before' ? t.y + 2 : t.y + t.height - 2
    await page.mouse.move(t.x + t.width / 2, y, { steps: 12 })
    await page.mouse.up()
  }

  async function names() {
    return page
      .locator('[data-testid="tree-row"]')
      .evaluateAll((els) => els.map((e) => e.dataset.name))
  }

  return { row, typeName, contextAction, drag, names }
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
    apiKeys: ['app', 'config', 'dialog', 'item', 'on', 'tree', 'workspace'],
    workspaceKeys: [
      'create',
      'delete',
      'getCurrent',
      'listRecent',
      'open',
      'openWithDialog',
      'removeRecent',
      'rename'
    ]
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

  await page.getByRole('button', { name: '返回「Smoke API」' }).click()
  await page.getByTestId('workspace-shell').waitFor()

  // ---- Phase 1: Collection tree ----
  let t = treeHelpers(page)
  const colDir = path.join(wsDir, 'collections')

  await page.getByRole('button', { name: '新增 Collection' }).first().click()
  await t.typeName('Users API')
  await t.contextAction('Users API', '新增 HTTP 請求')
  await t.typeName('Get Users')
  await t.contextAction('Users API', '新增資料夾')
  await t.typeName('Admin')
  await t.contextAction('Users API', '新增 WebSocket')
  await t.typeName('Live Feed')
  assert.deepEqual(await t.names(), ['Users API', 'Get Users', 'Admin', 'Live Feed'])
  const usersDir = path.join(colDir, 'users-api')
  assert.deepEqual((await readdir(usersDir)).sort(), [
    'admin',
    'collection.json',
    'get-users.json',
    'live-feed.json'
  ])
  assert.equal((await readJson(path.join(usersDir, 'live-feed.json'))).type, 'websocket')
  step('create Collection / HTTP request / folder / WebSocket from the sidebar (slug file names)')

  await t.contextAction('Get Users', '複製')
  await t.row('Get Users copy').waitFor()
  assert.ok(await exists(path.join(usersDir, 'get-users-copy.json')))
  await t.row('Get Users copy').click()
  await page.keyboard.press('F2')
  await t.typeName('List Users')
  assert.ok(await exists(path.join(usersDir, 'list-users.json')))
  assert.ok(!(await exists(path.join(usersDir, 'get-users-copy.json'))))
  assert.equal(await page.getByTestId('item-details-name').innerText(), 'List Users')
  step('duplicate ("… copy") and rename with F2 (file renamed on disk)')

  await t.drag('Get Users', 'Admin', 'inside')
  await waitUntil(() => exists(path.join(usersDir, 'admin', 'get-users.json')), 'drag into folder')
  await t.row('Get Users').waitFor() // folder auto-expands after the move
  const liveId = (await readJson(path.join(usersDir, 'live-feed.json'))).id
  await t.drag('Live Feed', 'Admin', 'before')
  await waitUntil(
    // Duplicates are inserted right after the original, so the order was List Users, Admin, Live Feed.
    async () => (await readJson(path.join(usersDir, 'collection.json'))).order[1] === liveId,
    'reorder saved to collection.json'
  )
  const expectedRows = ['Users API', 'List Users', 'Live Feed', 'Admin', 'Get Users']
  await waitUntil(
    async () => JSON.stringify(await t.names()) === JSON.stringify(expectedRows),
    `tree rows ${expectedRows.join(', ')}`
  )
  await page.screenshot({ path: path.join(shots, '4-tree.png') })
  step('drag & drop: into a folder (file moved) and reorder (order saved)')

  await t.contextAction('List Users', '刪除…')
  await page.getByTestId('delete-item-dialog').getByRole('button', { name: '刪除' }).click()
  await waitUntil(async () => !(await exists(path.join(usersDir, 'list-users.json'))), 'delete')
  await t.row('List Users').waitFor({ state: 'detached' })
  step('delete moves the file to the system trash')

  await writeFile(
    path.join(usersDir, 'from-git.json'),
    JSON.stringify({ version: 1, id: 'ext-1', type: 'http', name: 'From Git', method: 'POST' })
  )
  await t.row('From Git').waitFor({ timeout: 5000 })
  const colMeta = await readJson(path.join(usersDir, 'collection.json'))
  await writeFile(
    path.join(usersDir, 'collection.json'),
    JSON.stringify({ ...colMeta, name: 'Users API v2' })
  )
  await t.row('Users API v2').waitFor({ timeout: 5000 })
  await writeFile(path.join(usersDir, 'broken.json'), '{ not json')
  await t.row('broken').waitFor({ timeout: 5000 })
  await t.row('broken').click()
  assert.ok((await page.getByTestId('item-details').innerText()).includes('無法讀取'))
  await page.screenshot({ path: path.join(shots, '5-external-changes.png') })
  step('file watcher: external add / edit / invalid file show up automatically')

  await app.close()

  // ---- Second launch: last Workspace is restored ----
  ;({ app, page } = await launch())
  await page.getByTestId('workspace-shell').waitFor()
  assert.equal(await page.getByTestId('current-workspace-name').innerText(), 'Smoke API')
  t = treeHelpers(page)
  await t.row('Users API v2').waitFor()
  step('relaunch restores the last opened Workspace and its Collection tree')

  await page.getByTestId('workspace-menu').click()
  await page.getByRole('menuitem', { name: '重新命名 Workspace…' }).click()
  await page.getByLabel('Workspace 名稱').fill('Smoke Renamed')
  await page.getByRole('button', { name: '儲存' }).click()
  await page.getByTestId('current-workspace-name').getByText('Smoke Renamed').waitFor()
  assert.equal((await readJson(path.join(wsDir, 'workspace.json'))).name, 'Smoke Renamed')
  step('rename Workspace (display name only, folder unchanged)')

  await page.getByTestId('workspace-menu').click()
  await page.getByRole('menuitem', { name: '刪除 Workspace…' }).click()
  await page.getByRole('button', { name: '移到垃圾桶' }).click()
  await page.getByTestId('welcome-screen').waitFor()
  assert.ok(!(await exists(wsDir)), 'workspace folder moved to trash')
  const config2 = await readJson(path.join(userData, 'app-config.json'))
  assert.deepEqual(config2.recentWorkspaces, [])
  assert.equal(config2.lastWorkspacePath, null)
  step('delete Workspace: folder moved to trash, removed from recent list, back to welcome')
  await app.close()

  console.log(`\nAll smoke checks passed. Screenshots: ${shots}`)
} finally {
  await rm(tmp, { recursive: true, force: true })
}
