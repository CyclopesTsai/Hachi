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
import http from 'node:http'
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
    apiKeys: [
      'app',
      'config',
      'container',
      'dialog',
      'http',
      'item',
      'on',
      'request',
      'tree',
      'workspace'
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
      'saveSettings'
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
  assert.equal(await page.getByTestId('request-editor').locator('h2').innerText(), 'List Users')
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
  await t.row('Live Feed').click()
  const unsaved = page.getByTestId('unsaved-dialog')
  await unsaved.waitFor()
  await unsaved.getByRole('button', { name: '儲存', exact: true }).click()
  await waitUntil(
    async () => (await readJson(path.join(usersDir, 'admin', 'get-users.json'))).method === 'POST',
    'request saved'
  )
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
  assert.ok((await page.locator('main').innerText()).includes('Phase 4'))
  step('unsaved changes: switching items asks first; 儲存 writes the request file')

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

  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find((i) => i.label === 'File')
    file.submenu.items.find((i) => i.label === 'Settings…').click()
  })
  const appSettings = page.getByTestId('app-settings-dialog')
  await appSettings.waitFor()
  const notice = await appSettings.getByTestId('legal-notice').innerText()
  assert.ok(notice.includes('AGPL-3.0-or-later') && notice.includes('不提供任何擔保'), 'legal notice shown')
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
  testServer.close()
  await rm(tmp, { recursive: true, force: true })
}
