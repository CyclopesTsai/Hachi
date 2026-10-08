#!/usr/bin/env node
/**
 * End-to-end smoke test: launches the built app (run `npm run build` first),
 * walks through first-run onboarding and verifies files on disk.
 *
 *   node scripts/smoke-e2e.mjs            # on Linux CI wrap with `xvfb-run -a`
 *   SMOKE_SCREENSHOT_DIR=/tmp/shots node scripts/smoke-e2e.mjs
 *   SMOKE_APP_PATH=release/0.1.0/mac-arm64/Hachi.app/Contents/MacOS/Hachi node scripts/smoke-e2e.mjs
 *     (runs the checks against a packaged app instead of the dev build)
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { WebSocketServer } from 'ws'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = path.resolve(import.meta.dirname, '..')
const shots = process.env.SMOKE_SCREENSHOT_DIR ?? path.join(root, 'out', 'smoke')
const tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-smoke-'))
const userData = path.join(tmp, 'userData')
const docs = path.join(tmp, 'Documents', 'Hachi')
const trashDir = path.join(tmp, 'Trash')
await mkdir(shots, { recursive: true })

// Local HTTP server for the Phase 2 checks.
const BIG_SIZE = 11 * 1024 * 1024
const testServer = await new Promise((resolve) => {
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/echo') {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString()
        })
      )
    } else if (url.pathname === '/json') {
      res.setHeader('set-cookie', ['session=abc; Path=/; HttpOnly', 'theme=dark; Max-Age=60'])
      res.setHeader('content-type', 'application/json')
      res.end('{"ok":true}')
    } else if (url.pathname === '/big') {
      res.setHeader('content-type', 'text/plain')
      res.end(Buffer.alloc(BIG_SIZE, 97))
    } else if (url.pathname === '/slow') {
      setTimeout(() => res.end('late'), 5000)
    } else if (url.pathname === '/html') {
      res.setHeader('content-type', 'text/html')
      res.end('<h1>Hello Hachi</h1><script>document.title = "ran"</script>')
    } else if (url.pathname === '/redirect') {
      const n = Number(url.searchParams.get('n') ?? '1')
      res.writeHead(302, { location: n > 1 ? `/redirect?n=${n - 1}` : '/json' })
      res.end()
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  server.listen(0, '127.0.0.1', () =>
    resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => {
        server.closeAllConnections()
        server.close()
      }
    })
  )
})

// Local WebSocket echo server for the Phase 4 checks.
const wsSeen = []
const wsServer = await new Promise((resolve) => {
  const server = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    handleProtocols: (protocols) => (protocols.has('chat.v2') ? 'chat.v2' : false)
  })
  server.on('connection', (socket, req) => {
    const seen = { url: req.url, headers: req.headers, protocol: socket.protocol, closeCode: null }
    wsSeen.push(seen)
    socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }))
    socket.on('close', (code) => {
      seen.closeCode = code
    })
  })
  server.on('listening', () =>
    resolve({
      url: `ws://127.0.0.1:${server.address().port}`,
      broadcast: (data) => server.clients.forEach((c) => c.send(data)),
      close: () => {
        server.clients.forEach((c) => c.terminate())
        server.close()
      }
    })
  )
})

// A packaged app (SMOKE_APP_PATH) carries its own code; otherwise run this checkout.
const packagedApp = process.env.SMOKE_APP_PATH ? path.resolve(process.env.SMOKE_APP_PATH) : null
const args = packagedApp ? [] : [root]
// Chromium's sandbox needs root-owned helpers / user namespaces that CI machines and
// containers lack (GitHub's Ubuntu runners restrict unprivileged user namespaces).
if (process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CI)) {
  args.push('--no-sandbox')
}

/** The window of the latest launch, for a screenshot when a check fails. */
let lastPage = null

async function launch() {
  const app = await electron.launch({
    executablePath: packagedApp ?? electronPath,
    args,
    env: {
      ...process.env,
      HACHI_USER_DATA_DIR: userData,
      ELECTRON_RENDERER_URL: '',
      // The menu of packaged builds (no Reload / Developer Tools).
      HACHI_PRODUCTION_MENU: '1',
      // Git sees no user.name / email of this computer: the identity dialog is tested.
      GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1'
    }
  })
  // Deleted items go to a folder of the test instead of the real Trash of this computer.
  await app.evaluate(({ shell }, dir) => {
    const fs = process.getBuiltinModule('node:fs')
    const nodePath = process.getBuiltinModule('node:path')
    fs.mkdirSync(dir, { recursive: true })
    let n = 0
    shell.trashItem = async (p) => {
      fs.renameSync(p, nodePath.join(dir, `${++n}-${nodePath.basename(p)}`))
    }
  }, trashDir)
  const page = await app.firstWindow()
  // Renderer crashes show up as a blank window; print why.
  page.on('pageerror', (error) => console.error('Renderer error:', error.message))
  await page.waitForLoadState('domcontentloaded')
  // SMOKE_COLOR_SCHEME=dark takes every screenshot in dark mode (for reviewing it).
  if (process.env.SMOKE_COLOR_SCHEME) {
    await page.emulateMedia({ colorScheme: process.env.SMOKE_COLOR_SCHEME })
  }
  lastPage = page
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

/** Clicks a native menu item by label, in whichever menu it is (Settings… differs by OS). */
const clickMenu = (app, label) =>
  app.evaluate(({ Menu }, wanted) => {
    const find = (items) => {
      for (const item of items) {
        if (item.label === wanted) return item
        const inner = item.submenu && find(item.submenu.items)
        if (inner) return inner
      }
      return null
    }
    find(Menu.getApplicationMenu().items).click()
  }, label)

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
    // Let the drag library see the final position before dropping (it reads it on the next
    // frame; releasing right away sometimes used the previous position, e.g. "inside").
    await new Promise((r) => setTimeout(r, 150))
    await page.mouse.move(t.x + t.width / 2 + 1, y)
    await new Promise((r) => setTimeout(r, 100))
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
    apiKeys: [
      'app',
      'config',
      'container',
      'dialog',
      'env',
      'git',
      'history',
      'http',
      'item',
      'on',
      'request',
      'runner',
      'runtime',
      'session',
      'transfer',
      'tree',
      'workspace',
      'ws'
    ],
    workspaceKeys: [
      'create',
      'delete',
      'getCurrent',
      'getSettings',
      'listRecent',
      'open',
      'openWithDialog',
      'removeRecent',
      'rename',
      'saveSettings',
      'setScriptTrust'
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

  // Keyboard shortcuts are deliberately few (decisions 21, 43, 49, 50).
  const menuItems = await app.evaluate(({ Menu }) => {
    const out = []
    const walk = (items, trail) => {
      for (const item of items) {
        const label = [...trail, item.label].join(' › ')
        out.push({ label, role: item.role?.toLowerCase() ?? null, accelerator: item.accelerator })
        if (item.submenu) walk(item.submenu.items, [...trail, item.label])
      }
    }
    walk(Menu.getApplicationMenu().items, [])
    return out
  })
  // Edit (undo / copy / paste…) and Quit keep their standard shortcuts.
  const keptRoles = [
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'pasteandmatchstyle',
    'delete',
    'selectall',
    'quit'
  ]
  assert.deepEqual(
    menuItems
      .filter((i) => i.accelerator && !keptRoles.includes(i.role))
      .map((i) => `${i.label}=${i.accelerator}`),
    [
      'File › New Workspace…=CmdOrCtrl+Shift+N',
      'File › Open Workspace…=CmdOrCtrl+O',
      'File › Save=CmdOrCtrl+S',
      'File › Close Tab=CmdOrCtrl+W'
    ]
  )
  const shortcutRoles = [
    'reload',
    'forcereload',
    'toggledevtools',
    'resetzoom',
    'zoomin',
    'zoomout',
    'togglefullscreen',
    'minimize',
    'close',
    'hide',
    'hideothers',
    'windowmenu',
    'viewmenu'
  ]
  assert.deepEqual(
    menuItems.filter((i) => shortcutRoles.includes(i.role)).map((i) => i.label),
    [],
    'no Electron roles that bring their own shortcuts'
  )
  assert.ok(!menuItems.some((i) => /Reload|Developer Tools/.test(i.label)), 'no Reload / DevTools')
  step('menu shortcuts: only New Workspace / Open Workspace / Save / Close Tab (+ Edit, Quit)')

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

  // "+" opens a menu of what to add (decision 106).
  await page.getByTestId('sidebar-add').click()
  await page.getByRole('menuitem', { name: '新增 Collection' }).click()
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
  await t.contextAction('Get Users copy', '重新命名')
  // Enter while an input method is composing picks a candidate, it does not finish the rename.
  const renameField = page.getByTestId('tree-rename-input')
  await renameField.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
  assert.ok(await renameField.isVisible(), 'rename still open while composing')
  await t.typeName('List Users')
  assert.ok(await exists(path.join(usersDir, 'list-users.json')))
  assert.ok(!(await exists(path.join(usersDir, 'get-users-copy.json'))))
  assert.equal(await page.getByTestId('request-editor').locator('h2').innerText(), 'List Users')
  step('duplicate ("… copy") and rename from the context menu (file renamed on disk)')

  await t.drag('Get Users', 'Admin', 'inside')
  await waitUntil(() => exists(path.join(usersDir, 'admin', 'get-users.json')), 'drag into folder')
  await t.row('Get Users').waitFor() // folder auto-expands after the move
  // Let the tree settle (re-read + expand) before measuring rows for the next drag.
  await waitUntil(
    async () =>
      JSON.stringify(await t.names()) ===
      JSON.stringify(['Users API', 'List Users', 'Admin', 'Get Users', 'Live Feed']),
    'tree settled after the move'
  )
  await new Promise((r) => setTimeout(r, 300))
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

  // ---- Phase 2: no file watching — external changes appear after 「重新讀取」 ----
  await writeFile(
    path.join(usersDir, 'from-git.json'),
    JSON.stringify({ version: 1, id: 'ext-1', type: 'http', name: 'From Git', method: 'POST' })
  )
  const colMeta = await readJson(path.join(usersDir, 'collection.json'))
  await writeFile(
    path.join(usersDir, 'collection.json'),
    JSON.stringify({ ...colMeta, name: 'Users API v2' })
  )
  await writeFile(path.join(usersDir, 'broken.json'), '{ not json')
  await new Promise((r) => setTimeout(r, 1000))
  assert.equal(await t.row('From Git').count(), 0, 'external changes must not appear by themselves')
  await t.contextAction('Users API', '重新讀取')
  await t.row('Users API v2').waitFor()
  await t.row('From Git').waitFor()
  await t.row('broken').click()
  assert.ok((await page.getByTestId('item-details').innerText()).includes('無法讀取'))
  await page.screenshot({ path: path.join(shots, '5-external-changes.png') })

  await mkdir(path.join(colDir, 'external'))
  await writeFile(
    path.join(colDir, 'external', 'collection.json'),
    JSON.stringify({ version: 1, id: 'ext-col', name: 'External Col' })
  )
  await page.getByRole('button', { name: '重新讀取 Workspace' }).click()
  await t.row('External Col').waitFor()
  step(
    'no file watching: external changes appear after 重新讀取 (one collection / whole Workspace)'
  )

  // ---- Phase 2: HTTP editor ----
  const api = (p) => `${testServer.url}${p}`
  await t.row('Users API v2').click() // selects (and collapses) the collection
  const ce = page.getByTestId('container-editor')
  await ce.waitFor()
  await ce.getByRole('tab', { name: 'Headers' }).click()
  await ce.getByTestId('headers-table').getByLabel('Key').last().fill('X-Team')
  await ce.getByTestId('headers-table').getByLabel('Value').first().fill('core')
  await ce.getByRole('tab', { name: 'Auth' }).click()
  await page.getByLabel('驗證類型').selectOption('bearer')
  await page.getByLabel('Token').fill('col-token')
  await ce.getByRole('button', { name: '儲存' }).click()
  await waitUntil(
    async () =>
      (await readJson(path.join(usersDir, 'collection.json'))).auth?.token === 'col-token',
    'collection settings saved'
  )
  assert.deepEqual(
    (await readJson(path.join(usersDir, 'collection.json'))).headers.map((h) => [h.key, h.value]),
    [['X-Team', 'core']]
  )
  step('Collection settings: shared Headers + Bearer auth saved to collection.json')

  await t.row('Users API v2').click() // expand again
  await t.row('Get Users').click()
  const re = page.getByTestId('request-editor')
  await re.waitFor()
  await page.getByLabel('HTTP 方法').selectOption('POST')
  await page.getByTestId('url-input').fill(api('/echo'))
  await re.getByTestId('params-table').getByLabel('Key').last().fill('q')
  await re.getByTestId('params-table').getByLabel('Value').first().fill('1')
  assert.equal(
    await page.getByTestId('url-input').inputValue(),
    api('/echo'),
    'params stay out of the URL field'
  )
  await re.getByRole('tab', { name: /Headers/ }).click()
  const inheritedHeaders = await page.getByTestId('inherited-headers').innerText()
  assert.ok(inheritedHeaders.includes('X-Team') && inheritedHeaders.includes('Users API v2'))
  await re.getByRole('tab', { name: /Body/ }).click()
  await page.getByLabel('JSON', { exact: true }).check()
  await page.locator('[data-testid="body-json"] .cm-content').click()
  await page.keyboard.insertText('{"hello":"hachi"}')
  await re.getByRole('tab', { name: 'Auth' }).click()
  const inheritedAuth = page.getByTestId('inherited-auth')
  assert.ok((await inheritedAuth.innerText()).includes('Users API v2'))
  assert.equal(await inheritedAuth.getByLabel('Token').inputValue(), 'col-token')
  assert.equal(await inheritedAuth.getByLabel('Token').getAttribute('readonly'), '')
  step(
    'request editor: method / URL / params / JSON body; inherited headers + auth shown read-only'
  )

  await re.getByRole('button', { name: '發送' }).click()
  await page.getByTestId('response-status').waitFor()
  assert.match(await page.getByTestId('response-status').innerText(), /^200/)
  const echo = await page.getByTestId('response-body').innerText()
  // The read-only response can take focus: select all / copy / search work there.
  await page.getByTestId('response-body').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByTestId('response-body').locator('.cm-search').waitFor()
  await page.keyboard.press('Escape')
  for (const expected of [
    '"method": "POST"',
    '/echo?q=1',
    '"x-team": "core"',
    'Bearer col-token',
    'hachi'
  ]) {
    assert.ok(echo.includes(expected), `echo contains ${expected}`)
  }
  await page.screenshot({ path: path.join(shots, '6-request-editor.png') })
  step('send: request runs in main with params, inherited header / auth and JSON body')

  assert.equal(await t.row('Get Users').getByLabel('有未儲存的修改').count(), 1)
  const tabByTitle = (title) => page.locator(`[data-testid="tab"][data-title="${title}"]`)
  await t.row('Live Feed').click()
  await page.getByTestId('ws-editor').waitFor()
  assert.equal(await page.getByTestId('unsaved-dialog').count(), 0, 'switching tabs never asks')
  assert.equal(await tabByTitle('Get Users').getAttribute('data-dirty'), 'true')
  await tabByTitle('Get Users').getByTestId('tab-close').click()
  const unsaved = page.getByTestId('unsaved-dialog')
  await unsaved.waitFor()
  await unsaved.getByRole('button', { name: '儲存', exact: true }).click()
  await waitUntil(
    async () => (await readJson(path.join(usersDir, 'admin', 'get-users.json'))).method === 'POST',
    'request saved'
  )
  await tabByTitle('Get Users').waitFor({ state: 'detached' })
  const savedRequest = await readJson(path.join(usersDir, 'admin', 'get-users.json'))
  assert.equal(savedRequest.url, api('/echo'))
  assert.deepEqual(
    savedRequest.params.map((p) => [p.key, p.value]),
    [['q', '1']]
  )
  assert.deepEqual(savedRequest.body, {
    ...savedRequest.body,
    mode: 'json',
    json: '{"hello":"hachi"}'
  })
  step('tabs keep unsaved edits; closing an unsaved tab asks first and 儲存 writes the file')

  await t.contextAction('Users API v2', '新增 HTTP 請求')
  await t.typeName('Cookies')
  await page.getByTestId('request-editor').waitFor()
  const urlInput = page.getByTestId('url-input')
  const sendButton = () => page.getByTestId('request-editor').getByRole('button', { name: '發送' })
  const sendTo = async (p) => {
    await urlInput.fill(api(p))
    await sendButton().click()
  }
  await sendTo('/json')
  await page.getByRole('tab', { name: 'Cookies (2)' }).click()
  const cookies = await page.getByTestId('response-cookies').innerText()
  assert.ok(cookies.includes('session') && cookies.includes('theme'))
  await page.getByRole('tab', { name: /^Body/ }).last().click()
  step('response cookies are listed')

  await sendTo('/big')
  const large = page.getByTestId('large-body')
  await large.waitFor()
  const savePath = path.join(tmp, 'saved-response.txt')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, savePath)
  await large.getByRole('button', { name: '下載' }).click()
  await waitUntil(
    async () => (await exists(savePath)) && (await readFile(savePath)).length === BIG_SIZE,
    'download'
  )
  await large.getByRole('button', { name: '顯示' }).click()
  await page.getByTestId('response-body').waitFor()
  step('responses over 10 MB: 顯示 / 下載 buttons; download writes the full body')

  await sendTo('/slow')
  await page.getByTestId('request-editor').getByRole('button', { name: '取消' }).first().click()
  await page.getByTestId('response-error').getByText('已取消請求').waitFor()
  step('a running request can be cancelled (button only, no keyboard shortcut)')

  await sendTo('/html')
  await page.getByRole('radio', { name: 'Preview' }).click()
  assert.equal(await page.getByTestId('html-preview').getAttribute('sandbox'), '')
  await page.getByRole('radio', { name: 'Pretty' }).click()
  await page.getByText('自動換行').last().click()
  await waitUntil(
    async () =>
      (await readJson(path.join(userData, 'app-config.json'))).ui?.responseBodyWrap === true,
    'wrap preference saved'
  )
  step('HTML preview runs in a sandboxed iframe; 自動換行 preference is remembered')

  await sendTo('/redirect?n=4')
  await page.getByTestId('response-error').getByText('重新導向次數超過上限').waitFor()
  await page.getByTestId('workspace-menu').click()
  await page.getByRole('menuitem', { name: 'Workspace 設定…' }).click()
  const wsDialog = page.getByTestId('workspace-settings-dialog')
  assert.equal(await wsDialog.getByLabel('最多跟隨次數').inputValue(), '3')
  await wsDialog.getByLabel('最多跟隨次數').fill('5')
  await wsDialog.getByRole('button', { name: '儲存' }).click()
  await waitUntil(
    async () => (await readJson(path.join(wsDir, 'workspace.json'))).settings.maxRedirects === 5,
    'workspace settings saved'
  )
  await sendButton().click()
  await waitUntil(
    async () =>
      /^200/.test(
        await page
          .getByTestId('response-status')
          .innerText()
          .catch(() => '')
      ),
    'redirect ok'
  )
  step('redirect limit comes from Workspace settings (default 3, now 5)')

  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find((i) => i.label === 'File')
    file.submenu.items.find((i) => i.label === 'Save').click()
  })
  const cookiesFile = path.join(usersDir, 'cookies.json')
  await waitUntil(
    async () => (await readJson(cookiesFile)).url === api('/redirect?n=4'),
    'menu save'
  )
  await urlInput.fill('https://edited.test/unsaved')
  await writeFile(
    cookiesFile,
    JSON.stringify({ ...(await readJson(cookiesFile)), url: 'https://external.test/' })
  )
  await t.contextAction('Cookies', '重新讀取')
  await page.getByTestId('unsaved-dialog').getByRole('button', { name: '放棄並重新讀取' }).click()
  await waitUntil(
    async () => (await urlInput.inputValue()) === 'https://external.test/',
    'reloaded content'
  )
  step('File → Save (CmdOrCtrl+S) saves; 重新讀取 asks before discarding unsaved edits')

  // ---- Phase 3: tabs ----
  const tabTitles = () =>
    page.locator('[data-testid="tab"]').evaluateAll((els) => els.map((e) => e.dataset.title))
  await t.row('From Git').click()
  assert.equal(await tabByTitle('From Git').getAttribute('data-preview'), 'true')
  await t.row('External Col').click()
  await tabByTitle('External Col').waitFor()
  assert.equal(await tabByTitle('From Git').count(), 0, 'preview tab replaced')
  await t.row('External Col').dblclick()
  assert.equal(await tabByTitle('External Col').getAttribute('data-preview'), null)
  await t.row('From Git').click()
  await page.getByTestId('url-input').fill('https://pinned-by-editing.test/')
  assert.equal(await tabByTitle('From Git').getAttribute('data-preview'), null, 'edit pins')
  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find((i) => i.label === 'File')
    file.submenu.items.find((i) => i.label === 'Close Tab').click()
  })
  const unsavedTab = page.getByTestId('unsaved-dialog')
  await unsavedTab.waitFor()
  await unsavedTab.getByRole('button', { name: '不儲存' }).click()
  await tabByTitle('From Git').waitFor({ state: 'detached' })
  await tabByTitle('External Col').getByTestId('tab-close').click()
  step(
    `tabs: preview tab replaced by the next click, pinned by double-click / editing; Close Tab asks about unsaved edits (open: ${(await tabTitles()).join(', ')})`
  )

  // ---- Phase 3: environments + secrets ----
  await page.getByTestId('environment-select').click()
  await page.getByRole('menuitem', { name: '管理環境…' }).click()
  const envEditor = page.getByTestId('environments-editor')
  await envEditor.getByRole('button', { name: '建立環境' }).click()
  await page.getByTestId('environment-name').fill('dev')
  const envVars = page.getByTestId('environment-variables')
  await envVars.getByLabel('Key').last().fill('baseUrl')
  await envVars.getByLabel('Value').first().fill(api(''))
  await envVars.getByLabel('Key').last().fill('token')
  await envVars.getByLabel('機密').last().check()
  // Rows: baseUrl, token, then the blank row for new variables.
  await envVars.getByLabel('Value').nth(1).fill('s3cret-value')
  await envEditor.getByRole('button', { name: '儲存' }).click()
  const envFile = path.join(wsDir, 'environments', 'dev.json')
  await waitUntil(() => exists(envFile), 'environment renamed to dev.json')
  const envJson = await readFile(envFile, 'utf8')
  assert.ok(!envJson.includes('s3cret-value'), 'secret value not in the environment file')
  assert.deepEqual(
    JSON.parse(envJson).variables.map((v) => [v.key, v.value, v.secret]),
    [
      ['baseUrl', api(''), false],
      ['token', '', true]
    ]
  )
  const secretsFile = await readJson(path.join(wsDir, '.hachi-secrets.json'))
  assert.deepEqual(Object.values(secretsFile.environments), [
    { [JSON.parse(envJson).variables[1].id]: 's3cret-value' }
  ])
  await envEditor.getByRole('button', { name: '設為目前環境' }).click()
  await waitUntil(
    async () => (await page.getByTestId('active-environment').innerText()) === 'dev',
    'environment selected'
  )
  await page.screenshot({ path: path.join(shots, '7-environments.png') })
  step(
    'environments: dev.json keeps secret values empty; .hachi-secrets.json holds them; dev is active'
  )

  await t.row('Users API v2').click()
  await ce.getByRole('tab', { name: 'Variables' }).click()
  const colVars = page.getByTestId('collection-variables')
  await colVars.getByLabel('Key').last().fill('team')
  await colVars.getByLabel('Value').first().fill('from-collection')
  await colVars.getByLabel('Key').last().fill('baseUrl')
  await colVars.getByLabel('Value').nth(1).fill('http://collection-loses.invalid')
  await ce.getByRole('button', { name: '儲存' }).click()
  await waitUntil(
    async () => (await readJson(path.join(usersDir, 'collection.json'))).variables?.length === 2,
    'collection variables saved'
  )
  step('collection Variables tab saves to collection.json')

  // ---- Phase 3: unsaved request tab + {{variables}} ----
  await page.getByTestId('new-tab').click()
  await page.getByRole('menuitem', { name: 'HTTP 請求' }).click()
  await page.getByTestId('url-input').fill('{{baseUrl}}/echo?id={{$randomInt}}&m={{missing}}')
  const urlBox = page.getByTestId('url-input').locator('..')
  assert.equal(await urlBox.locator('[data-variable="defined"]').count(), 1)
  assert.equal(await urlBox.locator('[data-variable="dynamic"]').count(), 1)
  assert.equal(await urlBox.locator('[data-variable="missing"]').count(), 1)
  const draftEditor = page.getByTestId('request-editor')
  await draftEditor.getByRole('tab', { name: /Headers/ }).click()
  await draftEditor.getByTestId('headers-table').getByLabel('Key').last().fill('X-Token')
  await draftEditor.getByTestId('headers-table').getByLabel('Value').first().fill('{{token}}')
  await draftEditor.getByRole('button', { name: '發送' }).click()
  await page.getByTestId('response-status').waitFor()
  // The body view has line numbers, so check the pretty-printed text.
  const draftEcho = await page.getByTestId('response-body').innerText()
  assert.ok(draftEcho.includes('"x-token": "s3cret-value"'), 'secret sent')
  assert.match(draftEcho, /"url": "\/echo\?id=\d+&m=\{\{missing\}\}"/)
  assert.ok((await page.getByTestId('unresolved-variables').innerText()).includes('{{missing}}'))
  step(
    'unsaved "+" tab: {{env}} / secret / dynamic variables resolved in main; missing ones highlighted and reported'
  )

  await draftEditor.getByRole('button', { name: '儲存到…' }).click()
  const saveAs = page.getByTestId('save-as-dialog')
  await saveAs.getByLabel('名稱').fill('Env Echo')
  await saveAs.getByTestId('save-as-parent').selectOption({ label: 'Users API v2' })
  await saveAs.getByRole('button', { name: '儲存' }).click()
  await t.row('Env Echo').waitFor()
  const envEcho = await readJson(path.join(usersDir, 'env-echo.json'))
  assert.equal(envEcho.url, '{{baseUrl}}/echo?id={{$randomInt}}&m={{missing}}')
  await tabByTitle('Env Echo').waitFor()
  await draftEditor.getByTestId('headers-table').getByLabel('Key').last().fill('X-Team')
  await draftEditor.getByTestId('headers-table').getByLabel('Value').nth(1).fill('{{team}}')
  await draftEditor.getByRole('button', { name: '發送' }).click()
  await waitUntil(
    async () =>
      (
        await page
          .getByTestId('response-body')
          .innerText()
          .catch(() => '')
      ).includes('from-collection'),
    'collection variable used after Save As'
  )
  step(
    'Save As puts the request in a collection; collection variables apply, environment wins on conflicts'
  )

  // ---- Phase 3: history ----
  await page.getByTestId('sidebar-history').click()
  const historyRows = page.getByTestId('history-row')
  await waitUntil(async () => (await historyRows.count()) >= 3, 'history rows')
  const historyFile = await readFile(path.join(wsDir, 'history.json'), 'utf8')
  assert.ok(historyFile.includes('{{token}}') && !historyFile.includes('s3cret-value'))
  assert.ok(!historyFile.includes('"body":{"kind"'), 'no response bodies in history')
  const total = JSON.parse(historyFile).entries.length
  assert.equal(
    await page.getByTestId('history-usage').getAttribute('data-percent'),
    String(Math.round((total / 200) * 100))
  )
  const tabsBefore = (await tabTitles()).length
  await page.locator('[data-testid="history-row"][data-url^="{{baseUrl}}"]').first().click()
  await waitUntil(async () => (await tabTitles()).length === tabsBefore + 1, 'history tab')
  assert.equal(
    await page.getByTestId('url-input').inputValue(),
    '{{baseUrl}}/echo?id={{$randomInt}}&m={{missing}}'
  )
  await page.screenshot({ path: path.join(shots, '8-history.png') })
  await page.getByTestId('sidebar-collections').click()
  step(
    `history: ${total} entries with unresolved variables (no secrets, no bodies); usage ring; opening an entry adds a new unsaved tab`
  )

  // ---- Phase 4: WebSocket ----
  await t.row('Live Feed').click()
  const wsEditor = page.getByTestId('ws-editor')
  await wsEditor.waitFor()
  await page.getByTestId('ws-url-input').fill(`${wsServer.url}/chat?room={{team}}`)
  await wsEditor.getByRole('tab', { name: /Headers/ }).click()
  await wsEditor.getByTestId('headers-table').getByLabel('Key').last().fill('X-Token')
  await wsEditor.getByTestId('headers-table').getByLabel('Value').first().fill('{{token}}')
  await wsEditor.getByRole('tab', { name: 'Settings' }).click()
  await wsEditor.getByLabel('子協定').fill('chat.v2')
  await wsEditor.getByRole('button', { name: '連線' }).click()
  const wsStatus = page.getByTestId('ws-status')
  await waitUntil(async () => (await wsStatus.getAttribute('data-status')) === 'open', 'ws open')
  const seenWs = wsSeen.at(-1)
  assert.equal(seenWs.url, '/chat?room=from-collection')
  assert.equal(seenWs.headers['x-token'], 's3cret-value')
  assert.equal(seenWs.protocol, 'chat.v2')
  assert.equal(await tabByTitle('Live Feed').getByTestId('tab-live').count(), 1)
  step('WebSocket connects in main with {{variables}}, secret header and subprotocol')

  const composer = page.getByTestId('ws-composer')
  await composer.getByLabel('訊息格式').selectOption('json')
  await page.locator('[data-testid="ws-message-editor"] .cm-content').click()
  await page.keyboard.insertText('{"hello":"{{team}}"}')
  await composer.getByRole('button', { name: '送出', exact: true }).click()
  const logRows = (kind) => page.locator(`[data-testid="ws-log-row"][data-kind="${kind}"]`)
  await waitUntil(async () => (await logRows('received').count()) === 1, 'echo received')
  assert.ok((await logRows('sent').first().innerText()).includes('{"hello":"from-collection"}'))
  wsServer.broadcast(Buffer.from([1, 2, 255]))
  await waitUntil(async () => (await logRows('received').count()) === 2, 'binary push')
  assert.ok((await logRows('received').last().innerText()).includes('01 02 ff'))
  await composer.getByRole('button', { name: 'Ping' }).click()
  await page.locator('[data-testid="ws-log-row"][data-event="pong"]').waitFor()
  await page.getByTestId('ws-search').fill('hello')
  await waitUntil(
    async () => (await page.getByTestId('ws-log-count').innerText()).startsWith('2 /'),
    'search filters the log'
  )
  await page.getByTestId('ws-search').fill('')
  await logRows('received').first().getByRole('button').click()
  assert.ok(
    (await page.getByTestId('ws-log-detail').innerText()).includes('"hello": "from-collection"')
  )
  await page.screenshot({ path: path.join(shots, '9-websocket.png') })
  step(
    'WebSocket messages: JSON sent with variables, echo + binary push (hex) received, ping / pong, search'
  )

  const exportPath = path.join(tmp, 'ws-export.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, exportPath)
  await page.getByTestId('ws-message-log').getByRole('button', { name: '匯出' }).click()
  await page.getByRole('menuitem', { name: /JSON/ }).click()
  await waitUntil(() => exists(exportPath), 'export written')
  const exported = await readJson(exportPath)
  assert.ok(
    exported.some((e) => e.type === 'received' && e.format === 'binary' && e.data === 'AQL/')
  )
  assert.ok(exported.some((e) => e.type === 'event' && e.event === 'open'))

  await composer.getByRole('button', { name: '存成範本' }).click()
  await page.getByTestId('ws-template').waitFor()
  await wsEditor.getByRole('button', { name: '儲存', exact: true }).click()
  const liveFile = path.join(usersDir, 'live-feed.json')
  await waitUntil(
    async () => (await readJson(liveFile)).messageTemplates?.length === 1,
    'template saved'
  )
  const liveSaved = await readJson(liveFile)
  assert.equal(liveSaved.url, `${wsServer.url}/chat?room={{team}}`)
  assert.deepEqual(liveSaved.subprotocols, ['chat.v2'])
  assert.deepEqual(liveSaved.messageTemplates[0], {
    ...liveSaved.messageTemplates[0],
    format: 'json',
    content: '{"hello":"{{team}}"}'
  })
  step('export the log as JSON; message templates are saved in the request file')

  await tabByTitle('Live Feed').getByTestId('tab-close').click()
  const disconnectDialog = page.getByTestId('unsaved-dialog')
  await disconnectDialog.getByText('中斷連線並關閉？').waitFor()
  await disconnectDialog.getByRole('button', { name: '取消' }).click()
  assert.equal(await wsStatus.getAttribute('data-status'), 'open')
  await wsEditor.getByRole('button', { name: '中斷' }).click()
  await waitUntil(
    async () => (await wsStatus.getAttribute('data-status')) === 'closed',
    'ws closed'
  )
  await waitUntil(async () => seenWs.closeCode === 1000, 'server saw close 1000')
  await waitUntil(
    async () =>
      (await readJson(path.join(wsDir, 'history.json'))).entries.some(
        (e) => e.type === 'websocket' && e.result.closeCode === 1000
      ),
    'websocket history entry'
  )
  const wsHistory = (await readJson(path.join(wsDir, 'history.json'))).entries.find(
    (e) => e.type === 'websocket'
  )
  assert.equal(wsHistory.request.headers[0].value, '{{token}}', 'history keeps variables')
  assert.equal(wsHistory.result.sent, 1)
  assert.equal(wsHistory.result.received, 2)
  await page.getByTestId('new-tab').click()
  await page.getByRole('menuitem', { name: 'WebSocket' }).click()
  await page.getByTestId('ws-editor').getByText('尚未儲存的 WebSocket').waitFor()
  await page.locator('[data-testid="tab"][data-draft]').last().getByTestId('tab-close').click()
  await t.row('Cookies').click()
  await page.getByTestId('request-editor').waitFor()
  step(
    'closing a connected tab asks first; 中斷 sends 1000; the connection is recorded in history; "+" opens an unsaved WebSocket'
  )

  // ---- Phase 5a: cURL import, code generation, Postman import / export ----
  const fileMenuLabels = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((i) => i.label === 'File')
      .submenu.items.map((i) => i.label)
  )
  assert.ok(fileMenuLabels.includes('Import…') && fileMenuLabels.includes('Import cURL…'))
  await clickMenu(app, 'Import cURL…')
  await page
    .getByTestId('curl-input')
    .fill(
      `curl -X PUT '{{baseUrl}}/echo?from=curl' \\\n  -H 'X-Curl: yes' -H 'X-Token: {{token}}' \\\n  --data-raw '{"imported":true}'`
    )
  await page.getByRole('button', { name: '匯入', exact: true }).click()
  const curlEditor = page.getByTestId('request-editor')
  await curlEditor.getByText('尚未儲存的請求').waitFor()
  assert.equal(await page.getByTestId('url-input').inputValue(), '{{baseUrl}}/echo?from=curl')
  await curlEditor.getByRole('button', { name: '發送' }).click()
  await waitUntil(
    async () =>
      (
        await page
          .getByTestId('response-body')
          .innerText()
          .catch(() => '')
      ).includes('"x-curl": "yes"'),
    'cURL request sent'
  )
  const curlEcho = await page.getByTestId('response-body').innerText()
  assert.ok(curlEcho.includes('"method": "PUT"') && curlEcho.includes('imported'))
  step('File → Import cURL… opens the command as an unsaved request that can be sent')

  await curlEditor.getByTestId('codegen-button').click()
  const codeOut = page.getByTestId('codegen-output')
  await waitUntil(async () => (await codeOut.innerText()).includes('curl -X PUT'), 'curl code')
  const curlCode = await codeOut.innerText()
  assert.ok(curlCode.includes(`${testServer.url}/echo?from=curl`), 'variables resolved')
  assert.ok(curlCode.includes('X-Token: {{token}}') && !curlCode.includes('s3cret-value'))
  await page.getByTestId('codegen-reveal').check()
  await waitUntil(async () => (await codeOut.innerText()).includes('s3cret-value'), 'reveal secret')
  await page.getByTestId('codegen-language').selectOption('python')
  await waitUntil(async () => (await codeOut.innerText()).includes('import requests'), 'python')
  // Don't touch the real clipboard of the machine running the test.
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text
    }
  })
  await page.getByRole('button', { name: '複製' }).click()
  await waitUntil(
    async () => (await page.evaluate(() => window.__copied ?? '')).includes('import requests'),
    'code copied'
  )
  await page.screenshot({ path: path.join(shots, '10-codegen.png') })
  await page.keyboard.press('Escape')
  step('Code: cURL / Python generated (secrets kept as {{name}} until revealed), copy button')

  const postmanCollection = {
    info: {
      name: 'Shop',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    variable: [{ key: 'shopBase', value: testServer.url }],
    item: [
      { name: 'Ping', request: { method: 'GET', url: '{{shopBase}}/json' } },
      {
        name: 'Folder A',
        item: [
          {
            name: 'Echo',
            request: {
              method: 'POST',
              url: '{{shopBase}}/echo',
              auth: { type: 'oauth2' },
              body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } }
            }
          }
        ]
      }
    ]
  }
  const postmanEnv = {
    name: 'Shop Prod',
    values: [{ key: 'shopToken', value: 'tok-1', type: 'secret', enabled: true }]
  }
  await page.evaluate(
    (files) => {
      const dt = new DataTransfer()
      for (const [name, text] of files) {
        dt.items.add(new File([text], name, { type: 'application/json' }))
      }
      const target = document.querySelector('[data-testid="workspace-shell"]')
      const init = { dataTransfer: dt, bubbles: true, cancelable: true }
      target.dispatchEvent(new DragEvent('dragover', init))
      target.dispatchEvent(new DragEvent('drop', init))
    },
    [
      ['shop.postman_collection.json', JSON.stringify(postmanCollection)],
      ['prod.postman_environment.json', JSON.stringify(postmanEnv)]
    ]
  )
  const transferResult = page.getByTestId('transfer-result')
  await transferResult.waitFor()
  const importText = await transferResult.innerText()
  assert.ok(importText.includes('已建立 Collection「Shop」'), importText)
  assert.ok(importText.includes('已建立環境「Shop Prod」'), importText)
  assert.ok(importText.includes('oauth2'), 'unsupported auth reported')
  await page.screenshot({ path: path.join(shots, '11-import.png') })
  await transferResult.getByRole('button', { name: '確定' }).click()
  await t.row('Shop').waitFor()
  const shopDir = path.join(colDir, 'shop')
  assert.equal((await readJson(path.join(shopDir, 'collection.json'))).variables[0].key, 'shopBase')
  assert.equal((await readJson(path.join(shopDir, 'folder-a', 'echo.json'))).body.json, '{"a":1}')
  const prodEnv = await readJson(path.join(wsDir, 'environments', 'shop-prod.json'))
  assert.equal(prodEnv.variables[0].value, '', 'secret value not in the environment file')
  assert.ok((await readFile(path.join(wsDir, '.hachi-secrets.json'), 'utf8')).includes('tok-1'))
  await t.row('Ping').click()
  await page.getByTestId('request-editor').getByRole('button', { name: '發送' }).click()
  await waitUntil(
    async () =>
      /^200/.test(
        await page
          .getByTestId('response-status')
          .innerText()
          .catch(() => '')
      ),
    'imported request sent with its collection variable'
  )
  step('drop Postman Collection + Environment files: written as Hachi files, secrets separate')

  const shopExport = path.join(tmp, 'shop-export.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, shopExport)
  await t.contextAction('Shop', '匯出…')
  const exportDialog = page.getByTestId('export-dialog')
  await exportDialog.getByLabel(/Postman Collection v2\.1/).check()
  await exportDialog.getByRole('button', { name: '匯出…' }).click()
  await transferResult.waitFor()
  await transferResult.getByRole('button', { name: '確定' }).click()
  const exportedShop = await readJson(shopExport)
  assert.equal(
    exportedShop.info.schema,
    'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  )
  assert.deepEqual(
    exportedShop.item.map((i) => i.name),
    ['Ping', 'Folder A']
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, shopExport)
  await clickMenu(app, 'Import…')
  await transferResult.waitFor()
  assert.ok((await transferResult.innerText()).includes('已建立 Collection「Shop copy」'))
  await transferResult.getByRole('button', { name: '確定' }).click()
  await t.row('Shop copy').waitFor()
  step('export a Collection as Postman v2.1; File → Import… reads it back as "Shop copy"')

  // ---- Phase 5b: scripts, extraction, assertions, script trust ----
  // "Shop copy" has a Ping too: pick the original by its file.
  await page.locator('[data-testid="tree-row"][title="collections/shop/ping.json"]').click()
  const pingEditor = page.getByTestId('request-editor')
  await page.getByTestId('url-input').fill('{{shopBase}}/echo')
  await pingEditor.getByRole('tab', { name: /^Scripts/ }).click()
  await page.locator('[data-testid="script-editor"] .cm-content').click()
  await page.keyboard.insertText(
    "hachi.variables.set('stamp', 'from-pre'); hachi.request.headers.set('X-Stamp', '{{stamp}}'); console.log('pre ran')"
  )
  await page
    .getByTestId('scripts-tab')
    .getByRole('radio', { name: /Post-response/ })
    .click()
  await page.locator('[data-testid="script-editor"] .cm-content').click()
  await page.keyboard.insertText(
    "hachi.test('echo is JSON', () => hachi.expect(typeof hachi.response.json()).toBe('object')); pm.environment.set('pmSet', 'yes'); console.log(CryptoJS.SHA256('a').toString())"
  )
  await pingEditor.getByRole('tab', { name: /^Tests/ }).click()
  const testsTab = page.getByTestId('tests-tab')
  await testsTab.getByRole('button', { name: '新增擷取' }).click()
  const extraction = page.getByTestId('extraction-row').first()
  await extraction.getByLabel('路徑').fill('method')
  await extraction.getByLabel('變數名稱').fill('echoMethod')
  for (let i = 0; i < 3; i++) await testsTab.getByRole('button', { name: '新增斷言' }).click()
  const assertionRow = (i) => page.getByTestId('assertion-row').nth(i)
  await assertionRow(1).getByLabel('檢查對象').selectOption('jsonBody')
  await assertionRow(1).getByLabel('路徑').fill('headers["x-stamp"]')
  await assertionRow(1).getByLabel('預期值').fill('{{stamp}}')
  await assertionRow(2).getByLabel('預期值').fill('404')

  await pingEditor.getByRole('button', { name: '發送' }).click()
  const trustDialog = page.getByTestId('script-trust-dialog')
  await trustDialog.waitFor()
  await trustDialog.getByRole('button', { name: '信任並執行' }).click()
  await page.getByTestId('tests-summary').waitFor()
  assert.equal(await page.getByTestId('tests-summary').innerText(), '3/4')
  await page.getByTestId('tests-trigger').click()
  const testsPanel = page.getByTestId('tests-panel')
  const testsText = await testsPanel.innerText()
  assert.ok(testsText.includes('echo is JSON') && testsText.includes('狀態碼 等於 404'), testsText)
  assert.ok(testsText.includes('echoMethod（暫存變數）'), 'extraction shown')
  assert.equal(
    await testsPanel.locator('[data-testid="variable-changes"] [data-scope="environment"]').count(),
    1,
    'environment change highlighted'
  )
  await page.screenshot({ path: path.join(shots, '12-tests.png') })
  await page.getByRole('tab', { name: /^Console/ }).click()
  const consoleText = await page.getByTestId('console-panel').innerText()
  assert.ok(consoleText.includes('pre ran'))
  assert.ok(
    consoleText.includes('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'),
    'CryptoJS in the sandbox'
  )
  const trustedConfig = await readJson(path.join(userData, 'app-config.json'))
  assert.deepEqual(trustedConfig.scripts.trustedWorkspaces, [wsDir])
  const devEnv = await readJson(path.join(wsDir, 'environments', 'dev.json'))
  assert.ok(devEnv.variables.some((x) => x.key === 'pmSet' && x.value === 'yes'))
  step(
    'scripts run in the sandbox after trusting the Workspace: pre-request header + runtime variable, extraction, assertions 3/4, console, CryptoJS, pm.environment.set'
  )

  await page.getByTestId('environment-select').click()
  await page.getByRole('menuitem', { name: '管理環境…' }).click()
  const runtimeSection = page.getByTestId('runtime-variables')
  await runtimeSection.locator('[data-testid="runtime-variable"][data-name="stamp"]').waitFor()
  assert.equal(
    await runtimeSection.locator('[data-name="echoMethod"] td').nth(1).innerText(),
    'GET'
  )
  await runtimeSection.getByRole('button', { name: '全部清除' }).click()
  await waitUntil(
    async () => (await runtimeSection.getByTestId('runtime-variable').count()) === 0,
    'runtime variables cleared'
  )
  await tabByTitle('Ping').click()

  await page.getByTestId('workspace-menu').click()
  await page.getByRole('menuitem', { name: 'Workspace 設定…' }).click()
  const wsSettings = page.getByTestId('workspace-settings-dialog')
  await wsSettings.getByTestId('trust-scripts').uncheck()
  await wsSettings.getByRole('button', { name: '儲存' }).click()
  await waitUntil(
    async () =>
      (await readJson(path.join(userData, 'app-config.json'))).scripts.trustedWorkspaces.length ===
      0,
    'trust removed'
  )
  await page.getByTestId('request-editor').getByRole('button', { name: '發送' }).click()
  await trustDialog.waitFor()
  await trustDialog.getByRole('button', { name: '這次不執行腳本' }).click()
  await page.getByTestId('tests-summary').waitFor()
  await page.getByTestId('tests-trigger').click()
  await page.getByTestId('tests-panel').getByText('這次沒有執行腳本').waitFor()
  assert.equal(await page.getByTestId('tests-summary').innerText(), '1/3')
  // Back to a request without scripts for the proxy checks below.
  await tabByTitle('Cookies').click()
  await page.getByTestId('request-editor').locator('h2').getByText('Cookies').waitFor()
  step(
    'runtime variables listed / cleared in the environment manager; untrusting asks again and "這次不執行腳本" runs only assertions'
  )

  // ---- Phase 5c: Collection Runner ----
  await t.contextAction('Shop', '執行…')
  const runnerView = page.getByTestId('runner-view')
  await runnerView.waitFor()
  const dataExample = runnerView.getByTestId('runner-data-example')
  await dataExample.locator('summary').click()
  assert.ok((await dataExample.innerText()).includes('username,password'), 'data file example')
  // Ping has unsaved edits from the Phase 5b checks: the saved version runs.
  await runnerView.getByText('Runner 使用的是已儲存的版本').waitFor()
  await runnerView.getByLabel('執行次數').fill('3')
  await runnerView.getByLabel('並行數').fill('2')
  await runnerView.getByText('總輪數 = 3 × 2 = 6').waitFor()
  await runnerView.getByLabel('全部保留').check()
  const dataFile = path.join(tmp, 'users.csv')
  await writeFile(dataFile, 'user,role\nalice,admin\nbob,"read, write"\n')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, dataFile)
  await runnerView.getByRole('button', { name: '選擇檔案…' }).click()
  await page.getByTestId('runner-data').getByText('2 列 · 欄位：user、role').waitFor()
  await runnerView.getByRole('button', { name: '開始執行' }).click()
  await waitUntil(
    async () =>
      (await page
        .getByTestId('runner-status')
        .getAttribute('data-status')
        .catch(() => null)) === 'done',
    'runner done',
    20000
  )
  assert.match(await page.getByTestId('runner-counts').innerText(), /^12 \/ 12 個請求 · 6 \/ 6 輪/)
  const totalRow = await page.getByTestId('runner-stats-total').innerText()
  assert.match(totalRow, /總計\s+12\s+12\s+0\s+0\.0%/)
  assert.equal(await page.getByTestId('runner-stats-row').count(), 2)
  await page.getByTestId('runner-latency-chart').waitFor()
  await page.getByTestId('runner-rps-chart').waitFor()
  assert.equal(await page.getByTestId('runner-row').count(), 12)
  await page.screenshot({ path: path.join(shots, '13-runner.png') })
  await page.getByTestId('runner-row').first().click()
  const rowDetail = page.getByTestId('runner-row-detail')
  await rowDetail.waitFor()
  await rowDetail.getByRole('tab', { name: '資料列' }).click()
  assert.ok((await rowDetail.innerText()).includes('alice'), 'first round uses the first data row')
  await rowDetail.getByRole('tab', { name: '回應' }).click()
  await rowDetail.getByText('"ok": true').waitFor()
  await page.keyboard.press('Escape')
  const runnerExport = path.join(tmp, 'runner.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, runnerExport)
  await runnerView.getByRole('button', { name: '匯出結果' }).click()
  await waitUntil(() => exists(runnerExport), 'runner export written')
  const runnerJson = await readJson(runnerExport)
  assert.equal(runnerJson.rows.length, 12)
  assert.deepEqual(
    [runnerJson.settings.iterations, runnerJson.settings.concurrency, runnerJson.settings.dataFile],
    [3, 2, 'users.csv']
  )
  assert.ok(runnerJson.rows[0].body.includes('"ok":true'), 'bodies kept')
  step(
    'Collection Runner: 3 rounds × 2 workers with a CSV data file, statistics, charts, row details with kept bodies, JSON export'
  )

  await runnerView.getByLabel('執行次數').fill('10000')
  await runnerView.getByLabel('並行數').fill('1')
  await runnerView.getByLabel('請求間隔').fill('50')
  await runnerView.getByRole('button', { name: '開始執行' }).click()
  await waitUntil(
    async () => (await page.getByTestId('runner-status').getAttribute('data-status')) === 'running',
    'runner running'
  )
  await runnerView.getByRole('button', { name: '停止' }).click()
  await waitUntil(
    async () =>
      (await page.getByTestId('runner-status').getAttribute('data-status')) === 'cancelled',
    'runner cancelled'
  )
  step('a long run can be stopped')
  await tabByTitle('Cookies').click()
  await page.getByTestId('request-editor').locator('h2').getByText('Cookies').waitFor()

  // ---- Phase 6: keyboard shortcuts list, tree ↑ / ↓, appearance ----
  const helpMenu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((i) => i.role === 'help' || i.label === 'Help')
      ?.submenu.items.map((i) => i.label)
  )
  assert.ok(helpMenu?.includes('Keyboard Shortcuts'), `Help menu: ${helpMenu}`)
  await clickMenu(app, 'Keyboard Shortcuts')
  const shortcuts = page.getByTestId('shortcuts-dialog')
  await shortcuts.waitFor()
  const shortcutsText = await shortcuts.innerText()
  assert.ok(shortcutsText.includes('移動選取') && shortcutsText.includes('儲存目前分頁'))
  await page.keyboard.press('Escape')
  await shortcuts.waitFor({ state: 'hidden' })

  const selectedName = () =>
    page.locator('[data-testid="tree-row"][aria-selected="true"]').getAttribute('data-name')
  await t.row('Shop copy').click()
  const visible = await t.names()
  const at = visible.indexOf('Shop copy')
  const previewTitle = () =>
    page.locator('[data-testid="tab"][data-preview]').getAttribute('data-title')
  const previewBefore = await previewTitle()
  await t.row('Shop copy').press('ArrowUp')
  await waitUntil(async () => (await selectedName()) === visible[at - 1], '↑ selects the row above')
  await page.keyboard.press('ArrowUp')
  await waitUntil(async () => (await selectedName()) === visible[at - 2], '↑ again')
  await page.keyboard.press('ArrowDown')
  await waitUntil(async () => (await selectedName()) === visible[at - 1], '↓ goes back')
  assert.equal(await previewTitle(), previewBefore, '↑ / ↓ only move the selection (no tab opened)')
  step('Help → Keyboard Shortcuts lists the keys; ↑ / ↓ move the selection in the tree')

  await clickMenu(app, 'Settings…')
  const themeSettings = page.getByTestId('app-settings-dialog')
  await themeSettings.getByRole('radio', { name: '深色' }).click()
  await waitUntil(
    async () => (await readJson(path.join(userData, 'app-config.json'))).theme === 'dark',
    'theme saved'
  )
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark')
  // Without color-scheme emulation the page follows nativeTheme (decision 93).
  await page.emulateMedia({ colorScheme: null })
  await waitUntil(
    () => page.evaluate(() => document.documentElement.classList.contains('dark')),
    'dark class'
  )
  await themeSettings.getByRole('radio', { name: '淺色' }).click()
  await waitUntil(
    () => page.evaluate(() => !document.documentElement.classList.contains('dark')),
    'light again'
  )
  await themeSettings.getByRole('radio', { name: '跟隨系統' }).click()
  await waitUntil(
    async () => (await readJson(path.join(userData, 'app-config.json'))).theme === 'system',
    'theme back to system'
  )
  if (process.env.SMOKE_COLOR_SCHEME) {
    await page.emulateMedia({ colorScheme: process.env.SMOKE_COLOR_SCHEME })
  }
  await page.keyboard.press('Escape')
  step('appearance: 跟隨系統 / 淺色 / 深色 applies right away and is saved in app-config.json')
  await tabByTitle('Cookies').click()
  await page.getByTestId('request-editor').locator('h2').getByText('Cookies').waitFor()

  await clickMenu(app, 'Settings…')
  const appSettings = page.getByTestId('app-settings-dialog')
  await appSettings.waitFor()
  const notice = await appSettings.getByTestId('legal-notice').innerText()
  assert.ok(
    notice.includes('AGPL-3.0-or-later') && notice.includes('不提供任何擔保'),
    'legal notice shown'
  )
  await appSettings.getByLabel('自訂').check()
  await appSettings.getByLabel('Proxy URL').fill('http://127.0.0.1:1')
  // The test server is on 127.0.0.1, which the default bypass list skips.
  await appSettings.getByLabel(/不經過 Proxy/).fill('')
  await appSettings.getByRole('button', { name: '儲存' }).click()
  await waitUntil(
    async () => (await readJson(path.join(userData, 'app-config.json'))).proxy?.mode === 'custom',
    'proxy saved'
  )
  await sendTo('/json')
  await page.getByTestId('response-error').waitFor()
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByText('使用 App 的 Proxy 設定').click()
  await sendButton().click()
  await waitUntil(
    async () =>
      /^200/.test(
        await page
          .getByTestId('response-status')
          .innerText()
          .catch(() => '')
      ),
    'no proxy'
  )
  step('app proxy setting (userData) is used; a request can opt out of the proxy')

  // ---- Sidebar "+" menu, Bruno / OpenAPI export and import (decisions 103–106) ----
  // "+" adds into the selected place: the selected Collection here.
  await page.locator('[data-testid="tree-row"][title="collections/shop"]').click()
  await page.getByTestId('sidebar-add').click()
  await page.getByRole('menuitem', { name: '新增 HTTP 請求' }).click()
  await t.typeName('Added By Plus')
  await access(path.join(colDir, 'shop', 'added-by-plus.json'))
  step('sidebar "+" menu adds a request into the selected Collection')

  const htmlExport = path.join(tmp, 'shop-api.html')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, htmlExport)
  await t.contextAction('Shop', '匯出…')
  await exportDialog.getByLabel(/OpenAPI 文件（HTML）/).check()
  await exportDialog.getByTestId('export-env').selectOption({ label: 'Shop Prod' })
  await page.screenshot({ path: path.join(shots, '15-export.png') })
  await exportDialog.getByRole('button', { name: '匯出…' }).click()
  await transferResult.waitFor()
  await transferResult.getByRole('button', { name: '確定' }).click()
  const exportedHtml = await readFile(htmlExport, 'utf8')
  assert.ok(exportedHtml.includes('Redoc.init('), 'Redoc bundled')
  assert.ok(exportedHtml.includes('"openapi":"3.0.3"'), 'OpenAPI document inlined')
  assert.ok(exportedHtml.includes('"summary":"Ping"'), 'requests documented')
  assert.ok(!exportedHtml.includes('tok-1'), 'secret values stay out of the document')
  step('export a Collection as an OpenAPI HTML page (Redoc inlined)')

  // Bruno: export as .bru and as YAML into one folder, then import that folder back:
  // it holds two collections, so a list asks which ones (decisions 103 / 107).
  const brunoParent = path.join(tmp, 'bruno-export')
  await mkdir(brunoParent)
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, brunoParent)
  for (const format of [/Bruno 資料夾（\.bru）/, /Bruno 資料夾（YAML）/]) {
    await t.contextAction('Shop', '匯出…')
    await exportDialog.getByLabel(format).check()
    await exportDialog.getByRole('button', { name: '選擇資料夾…' }).click()
    await transferResult.waitFor()
    await transferResult.getByRole('button', { name: '確定' }).click()
  }
  const bruDir = path.join(brunoParent, 'Shop')
  assert.equal((await readJson(path.join(bruDir, 'bruno.json'))).name, 'Shop')
  assert.ok((await readFile(path.join(bruDir, 'Added By Plus.bru'), 'utf8')).includes('meta {'))
  const yamlDir = path.join(brunoParent, 'Shop-2')
  assert.ok(
    (await readFile(path.join(yamlDir, 'opencollection.yml'), 'utf8')).includes('name: Shop')
  )
  assert.ok(
    (await readFile(path.join(yamlDir, 'Added By Plus.yml'), 'utf8')).includes('type: http')
  )
  step('export a Collection as a Bruno folder: .bru or YAML (OpenCollection)')

  await page.getByTestId('sidebar-add').click()
  await page.getByRole('menuitem', { name: '匯入 Bruno 資料夾…' }).click()
  const brunoPick = page.getByTestId('bruno-pick-dialog')
  await brunoPick.waitFor()
  const pickList = brunoPick.getByTestId('bruno-pick-list')
  assert.equal(await pickList.getByRole('checkbox').count(), 2)
  assert.ok((await pickList.innerText()).includes('YAML'))
  // Only the YAML one.
  await pickList.getByRole('checkbox').first().uncheck()
  await page.screenshot({ path: path.join(shots, '16-bruno-pick.png') })
  await brunoPick.getByRole('button', { name: '匯入 1 個' }).click()
  await transferResult.waitFor()
  const brunoReport = await transferResult.innerText()
  assert.ok(brunoReport.includes('已建立 Collection「Shop copy'), brunoReport)
  assert.ok(brunoReport.includes('「Shop / Shop Prod」'), brunoReport)
  await transferResult.getByRole('button', { name: '確定' }).click()
  step('"+" → 匯入 Bruno 資料夾… on a folder with several collections lists them to pick from')

  // ---- Sidebar search, expand / collapse all, locate (decisions 108 / 109) ----
  const treeSearch = page.getByTestId('global-search')
  const visibleRows = page.locator('[data-testid="tree-row"]')
  await page.getByTestId('tree-collapse-all').click()
  await waitUntil(
    async () =>
      (await visibleRows.evaluateAll((rows) => rows.map((r) => r.dataset.kind))).every(
        (kind) => kind === 'collection'
      ),
    'collapse all leaves only collections'
  )
  const collapsedCount = await visibleRows.count()
  await page.getByTestId('tree-expand-all').click()
  await page.locator('[data-testid="tree-row"][data-name="Get Users"]').waitFor()
  assert.ok((await visibleRows.count()) > collapsedCount, 'expand all opens every folder')
  step('全部收合 / 全部展開 buttons above the tree')

  await page.getByTestId('tree-collapse-all').click()
  await treeSearch.fill('PING')
  await page.getByTestId('tree-match').first().waitFor()
  const found = await visibleRows.evaluateAll((rows) =>
    rows.map((r) => [r.dataset.kind, r.dataset.name])
  )
  assert.ok(
    found.every(([kind, name]) => kind !== 'request' || /ping/i.test(name)),
    JSON.stringify(found)
  )
  assert.ok(
    found.some(([kind]) => kind === 'request'),
    'matching requests are revealed'
  )
  await treeSearch.fill('Folder A')
  await page.locator('[data-testid="tree-row"][data-name="Folder A"]').first().waitFor()
  await treeSearch.fill('no-such-name')
  await page.getByTestId('tree-no-match').waitFor()
  await treeSearch.fill('')
  await waitUntil(
    async () => (await visibleRows.count()) === collapsedCount,
    'clearing the search restores the tree as it was'
  )
  step('search filters the tree by collection / folder / request name and restores it after')

  await page.locator('[data-testid="tree-row"][title="collections/shop"]').click()
  await page.locator('[data-testid="tree-row"][title="collections/shop/ping.json"]').click()
  await page.getByTestId('request-editor').waitFor()
  await page.getByTestId('tree-collapse-all').click()
  await page.getByTestId('tree-focus').click()
  const located = page.locator('[data-testid="tree-row"][title="collections/shop/ping.json"]')
  await located.waitFor()
  assert.equal(await located.getAttribute('aria-selected'), 'true')
  step('focus button shows the active tab in the tree')

  // ---- 在 Finder 中顯示 (Workspace menu and the tree's context menu) ----
  await app.evaluate(({ shell }) => {
    globalThis.__revealed = []
    shell.openPath = async (p) => {
      globalThis.__revealed.push(['open', p])
      return ''
    }
    shell.showItemInFolder = (p) => globalThis.__revealed.push(['select', p])
  })
  await page.getByTestId('workspace-menu').click()
  await page.getByRole('menuitem', { name: /^在.*中顯示$/ }).click()
  await page
    .locator('[data-testid="tree-row"][title="collections/shop/ping.json"]')
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^在.*中顯示$/ }).click()
  const revealed = await app.evaluate(() => globalThis.__revealed)
  assert.deepEqual(
    revealed.map(([how, p]) => [how, path.basename(p)]),
    [
      ['open', path.basename(wsDir)],
      ['select', 'ping.json']
    ]
  )
  step('在 Finder 中顯示: the Workspace folder, or an item in its folder')

  // ---- Git (decisions 111–119): entered from the header, a screen of its own ----
  await page.getByTestId('git-menu').click()
  await page.getByRole('menuitem', { name: /git init/ }).click()
  await waitUntil(
    async () =>
      (await page
        .getByTestId('current-branch')
        .innerText()
        .catch(() => '')) === 'main',
    'the header shows the branch after git init'
  )
  await page.getByTestId('branch-menu').click()
  await page.getByRole('menuitem', { name: /^Commit…/ }).click()
  await page.getByTestId('git-screen').waitFor()
  assert.ok(!(await page.getByTestId('collection-sidebar').isVisible()), 'sidebar hidden')
  await page.getByTestId('git-panel').waitFor()
  assert.ok((await page.getByTestId('git-file').count()) > 5, 'every Workspace file is new')
  assert.equal(
    await page.locator('[data-testid="git-file"][data-path=".hachi-secrets.json"]').count(),
    0,
    'secrets are ignored'
  )
  // Tree view by default (decision 122): a folder's checkbox covers every file below it.
  const folderRows = page.getByTestId('git-folder')
  assert.ok((await folderRows.count()) > 0, 'changes shown as a tree')
  const commitButton = page.getByTestId('git-commit')
  const allLabel = await commitButton.innerText()
  await folderRows.first().getByRole('checkbox').uncheck()
  assert.notEqual(await commitButton.innerText(), allLabel, 'folder unchecked its files')
  await folderRows.first().getByRole('checkbox').check()
  assert.equal(await commitButton.innerText(), allLabel)
  await page.getByTestId('git-view-list').click()
  await waitUntil(async () => (await folderRows.count()) === 0, 'flat list')
  await page.getByTestId('git-view-tree').click()
  await folderRows.first().waitFor()
  await page.screenshot({ path: path.join(shots, '17-git-tree.png') })
  await page.getByTestId('git-message').fill('第一個 commit')
  await page.getByTestId('git-commit').click()
  const identity = page.getByTestId('git-identity-dialog')
  await identity.waitFor()
  await identity.getByLabel('名稱').fill('Hachi Tester')
  await identity.getByLabel('Email').fill('tester@example.com')
  await identity.getByRole('button', { name: '儲存並 Commit' }).click()
  await page.getByTestId('git-clean').waitFor()
  const gitIn = (...a) =>
    execFileSync('git', a, {
      cwd: wsDir,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' }
    }).trim()
  assert.equal(gitIn('log', '--format=%an|%s'), 'Hachi Tester|第一個 commit')
  step('Git: git init from the header; Commit screen asks for user.name / email, then commits')

  // A changed file shows its difference from the last commit.
  await writeFile(
    path.join(wsDir, '.gitignore'),
    `${await readFile(path.join(wsDir, '.gitignore'), 'utf8')}# e2e line\n`
  )
  await page.getByRole('button', { name: '重新整理 Git 狀態' }).click()
  const ignoreRow = page.locator('[data-testid="git-file"][data-path=".gitignore"]')
  // Anywhere on the row selects it, e.g. its status letter at the right end.
  const box = await ignoreRow.boundingBox()
  await ignoreRow.click({ position: { x: (box?.width ?? 20) - 6, y: (box?.height ?? 20) / 2 } })
  await page.getByTestId('git-diff').getByText('# e2e line').waitFor()
  await page.screenshot({ path: path.join(shots, '17-git.png') })
  await ignoreRow.hover()
  await ignoreRow.getByRole('button', { name: /捨棄/ }).click()
  await page.getByTestId('git-discard-dialog').getByRole('button', { name: '捨棄變更' }).click()
  await page.getByTestId('git-clean').waitFor()
  assert.ok(!(await readFile(path.join(wsDir, '.gitignore'), 'utf8')).includes('# e2e line'))

  await writeFile(path.join(wsDir, 'scratch.json'), '{}\n')
  await page.getByRole('button', { name: '重新整理 Git 狀態' }).click()
  const scratch = page.locator('[data-testid="git-file"][data-path="scratch.json"]')
  await scratch.hover()
  await scratch.getByRole('button', { name: /捨棄/ }).click()
  await page.getByTestId('git-discard-dialog').getByRole('button', { name: '捨棄變更' }).click()
  await page.getByTestId('git-clean').waitFor()
  assert.ok(
    (await readdir(trashDir)).some((f) => f.endsWith('scratch.json')),
    'new file trashed'
  )
  await page.getByTestId('git-back').click()
  await page.getByTestId('collection-sidebar').waitFor()
  step('diff against the last commit; discard (restore, or new files to the trash); 返回')

  await page.getByTestId('branch-menu').click()
  await page.getByRole('menuitem', { name: '建立分支…' }).click()
  const createBranch = page.getByTestId('git-create-branch-dialog')
  await createBranch.getByLabel('分支名稱').fill('feature/e2e')
  await createBranch.getByRole('button', { name: '建立' }).click()
  await waitUntil(
    async () => (await page.getByTestId('current-branch').innerText()) === 'feature/e2e',
    'switched to the new branch'
  )
  await page.getByTestId('branch-menu').click()
  await page
    .getByTestId('branch-item')
    .filter({ hasText: /^main$/ })
    .click()
  // Unsaved tabs (from earlier steps) are asked about first; they keep their edits.
  const unsavedPrompt = page.getByTestId('unsaved-dialog')
  await unsavedPrompt.waitFor()
  await unsavedPrompt.getByRole('button', { name: '不儲存' }).click()
  await waitUntil(
    async () => (await page.getByTestId('current-branch').innerText()) === 'main',
    'switched back to main'
  )
  assert.equal(gitIn('branch', '--show-current'), 'main')
  step('header shows the branch; create and switch branches from its menu')

  // ---- Git remote: push, pull, conflicts (decisions 113 / 114) ----
  const remoteDir = path.join(tmp, 'remote.git')
  const otherDir = path.join(tmp, 'other-clone')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoteDir])
  const gitOther = (...a) =>
    execFileSync('git', a, {
      cwd: otherDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Other',
        GIT_AUTHOR_EMAIL: 'other@example.com',
        GIT_COMMITTER_NAME: 'Other',
        GIT_COMMITTER_EMAIL: 'other@example.com'
      }
    }).trim()
  /** Pull asks about the unsaved tabs left by earlier steps: keep them as they are. */
  const keepUnsaved = async () => {
    const prompt = page.getByTestId('unsaved-dialog')
    await prompt.waitFor()
    await prompt.getByRole('button', { name: '不儲存' }).click()
  }

  await page.getByTestId('branch-menu').click()
  await page.getByRole('menuitem', { name: '設定遠端…' }).click()
  const remoteDialog = page.getByTestId('git-remote-dialog')
  await remoteDialog.getByLabel('遠端網址').fill(remoteDir)
  await remoteDialog.getByRole('button', { name: '儲存' }).click()
  await remoteDialog.waitFor({ state: 'hidden' })
  await page.getByTestId('branch-menu').click()
  await page.getByRole('menuitem', { name: /^Push/ }).click()
  await waitUntil(async () => {
    try {
      return gitIn('rev-parse', '--abbrev-ref', '@{u}') === 'origin/main'
    } catch {
      return false
    }
  }, 'the first push sets origin/main as upstream')
  step('設定遠端… then Push (the first push sets the upstream)')

  // Someone else pushes a change; Fetch shows it, Pull brings it in.
  execFileSync('git', ['clone', '-q', remoteDir, otherDir])
  const otherIgnore = path.join(otherDir, '.gitignore')
  await writeFile(otherIgnore, `${await readFile(otherIgnore, 'utf8')}# from someone else\n`)
  gitOther('commit', '-q', '-am', 'their change')
  gitOther('push', '-q')
  await page.getByTestId('branch-menu').click()
  await page.getByRole('menuitem', { name: /^Commit…/ }).click()
  await page.getByTestId('git-fetch').click()
  await page.getByTestId('git-pull').getByText('Pull（1）').waitFor()
  await page.getByTestId('git-pull').click()
  await keepUnsaved()
  await waitUntil(
    async () =>
      (await readFile(path.join(wsDir, '.gitignore'), 'utf8')).includes('# from someone else'),
    'pull brought the change in'
  )
  step('Fetch shows how far behind; Pull (merge) brings the change in')

  // Both sides change the same line: the pull stops on a conflict.
  await writeFile(
    otherIgnore,
    (await readFile(otherIgnore, 'utf8')).replace('# from someone else', '# theirs')
  )
  gitOther('commit', '-q', '-am', 'theirs')
  gitOther('push', '-q')
  const localIgnore = path.join(wsDir, '.gitignore')
  await writeFile(
    localIgnore,
    (await readFile(localIgnore, 'utf8')).replace('# from someone else', '# ours')
  )
  await page.getByRole('button', { name: '重新整理 Git 狀態' }).click()
  await page.getByTestId('git-message').fill('our change')
  await page.getByTestId('git-commit').click()
  await page.getByTestId('git-clean').waitFor()
  await page.getByTestId('git-pull').click()
  await keepUnsaved()
  await page.getByTestId('git-merge').waitFor()
  const conflicted = page.locator('[data-testid="git-file"][data-path=".gitignore"]')
  await conflicted.getByRole('button', { name: '.gitignore' }).click()
  const conflictDiff = page.getByTestId('git-diff')
  await conflictDiff.getByText('# theirs').waitFor()
  assert.ok(!(await conflictDiff.innerText()).includes('<<<<<<<'), 'no conflict markers')
  assert.ok((await conflictDiff.innerText()).includes('遠端（theirs）'))
  await page.screenshot({ path: path.join(shots, '18-git-conflict.png') })
  await page.getByTestId('git-conflict').getByRole('button', { name: '保留我的' }).click()
  await page.getByTestId('git-finish-merge').click()
  await page.getByTestId('git-merge').waitFor({ state: 'hidden' })
  assert.ok((await readFile(localIgnore, 'utf8')).includes('# ours'))
  assert.equal(gitIn('log', '-1', '--format=%P').split(' ').length, 2, 'a merge commit')
  await page.getByTestId('git-push').click()
  await waitUntil(
    async () => gitIn('rev-parse', 'HEAD') === gitIn('rev-parse', 'origin/main'),
    'the merge is pushed'
  )
  await page.getByTestId('git-back').click()
  step('a conflicting Pull: 保留我的 → 完成合併 → Push')

  // ---- History (decision 116) ----
  await page.getByTestId('branch-menu').click()
  await page.getByRole('menuitem', { name: 'History…' }).click()
  const history = page.getByTestId('git-history')
  await history.waitFor()
  const commitRows = history.getByTestId('git-commit-row')
  await commitRows.first().waitFor()
  assert.equal(await commitRows.count(), Number(gitIn('rev-list', '--all', '--count')))
  const refs = await history.getByTestId('git-ref').allInnerTexts()
  for (const name of ['main', 'origin/main', 'feature/e2e']) {
    assert.ok(refs.includes(name), `${name} label in ${JSON.stringify(refs)}`)
  }
  await commitRows.filter({ hasText: 'our change' }).click()
  const commitDetail = page.getByTestId('git-commit-detail')
  await commitDetail.getByText('Hachi Tester').waitFor()
  await commitDetail.getByTestId('git-commit-file').filter({ hasText: '.gitignore' }).click()
  await commitDetail.getByTestId('git-diff').getByText('# ours').waitFor()
  await page.screenshot({ path: path.join(shots, '19-git-history.png') })
  await page.getByTestId('git-tab-commit').click()
  await page.getByTestId('git-panel').waitFor()
  await page.getByTestId('git-back').click()
  step('History: every branch as a graph, labels, commit details and file diffs')

  // Fetch when the Workspace opens (Workspace setting, off by default).
  await page.getByTestId('workspace-menu').click()
  await page.getByRole('menuitem', { name: 'Workspace 設定…' }).click()
  const gitSettings = page.getByTestId('workspace-settings-dialog')
  assert.equal(await gitSettings.getByTestId('git-auto-fetch').isChecked(), false)
  await gitSettings.getByTestId('git-auto-fetch').check()
  await gitSettings.getByRole('button', { name: '儲存' }).click()
  await waitUntil(
    async () => (await readJson(path.join(wsDir, 'workspace.json'))).settings.gitAutoFetch === true,
    'auto fetch saved'
  )
  // Someone pushes again; the next launch fetches it without a click.
  gitOther('pull', '-q', '--no-rebase')
  await writeFile(otherIgnore, `${await readFile(otherIgnore, 'utf8')}# later\n`)
  gitOther('commit', '-q', '-am', 'later')
  gitOther('push', '-q')

  // Window position / size are remembered (decision 94).
  // Inside the primary screen's work area: CI machines have small screens (1024×768), where
  // larger bounds are fitted to the screen on restore (decision 94).
  const savedBounds = await app.evaluate(({ screen }) => {
    const area = screen.getPrimaryDisplay().workArea
    return {
      x: area.x + 20,
      y: area.y + 10,
      width: Math.max(900, Math.min(1000, area.width - 40)),
      height: Math.max(600, Math.min(700, area.height - 20))
    }
  })
  await app.evaluate(
    ({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b),
    savedBounds
  )
  await waitUntil(async () => {
    const w = (await readJson(path.join(userData, 'app-config.json'))).window
    return w?.width === savedBounds.width && w?.x === savedBounds.x
  }, 'window state saved')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  const closeDialog = page.getByTestId('unsaved-dialog')
  await closeDialog.waitFor()
  await closeDialog.getByRole('button', { name: '取消' }).click()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  // Unsaved request tabs are not remembered between launches.
  const savedTabTitles = (p) =>
    p
      // Unsaved requests and Runner tabs are not remembered (decision 92).
      .locator('[data-testid="tab"]:not([data-draft]):not([data-kind="runner"])')
      .evaluateAll((els) => els.map((e) => e.dataset.title))
  const openTabs = await savedTabTitles(page)
  const closed = app.waitForEvent('close')
  void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await closeDialog.waitFor()
  // The app quits while the click is still settling; the close event is the real check.
  await closeDialog
    .getByRole('button', { name: '不儲存' })
    .click({ noWaitAfter: true })
    .catch(() => undefined)
  await closed
  step('closing the window / quitting with unsaved tabs asks first (取消 keeps the window)')

  // ---- Second launch: last Workspace is restored ----
  ;({ app, page } = await launch())
  await page.getByTestId('workspace-shell').waitFor()
  // gitAutoFetch: the commit pushed meanwhile shows as 1 behind.
  await page.getByTestId('branch-menu').getByText('↓1').waitFor()
  assert.equal(await page.getByTestId('current-workspace-name').innerText(), 'Smoke API')
  t = treeHelpers(page)
  await t.row('Users API v2').waitFor()
  await waitUntil(
    async () => JSON.stringify(await savedTabTitles(page)) === JSON.stringify(openTabs),
    `tabs restored: ${openTabs.join(', ')}`
  )
  assert.equal(await page.getByTestId('active-environment').innerText(), 'dev')
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  assert.deepEqual(bounds, savedBounds, 'window position / size restored')
  step(
    'relaunch restores the last Workspace, its tree, open tabs and active environment, window position and size'
  )

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
  assert.ok(
    (await readdir(trashDir)).some((n) => n.endsWith('Smoke API')),
    'trashed into the test folder, not the real Trash'
  )
  // The recent list is written right after the folder is trashed (slower on macOS).
  await waitUntil(
    async () =>
      (await readJson(path.join(userData, 'app-config.json'))).recentWorkspaces.length === 0,
    'recent list updated'
  )
  const config2 = await readJson(path.join(userData, 'app-config.json'))
  assert.deepEqual(config2.recentWorkspaces, [])
  assert.equal(config2.lastWorkspacePath, null)
  step('delete Workspace: folder moved to trash, removed from recent list, back to welcome')

  // Closing the window quits the app on every platform, macOS too (decision 110).
  const exited = app.waitForEvent('close')
  void app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    .catch(() => undefined)
  await exited
  step('closing the window quits the app (macOS too)')

  console.log(`\nAll smoke checks passed. Screenshots: ${shots}`)
} catch (error) {
  await lastPage?.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined)
  console.error(`Failure screenshot: ${path.join(shots, 'failure.png')}`)
  throw error
} finally {
  testServer.close()
  wsServer.close()
  await rm(tmp, { recursive: true, force: true })
}
