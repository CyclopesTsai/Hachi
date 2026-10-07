import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POSTMAN_SCHEMA_V21 } from '@shared/transfer/postman'
import { CollectionService } from './collection-service'
import { ConfigService } from './config-service'
import { EnvironmentService } from './environment-service'
import { TransferService, readBrunoFolder } from './transfer-service'
import { WorkspaceService } from './workspace-service'

let tmp: string
let root: string
let collections: CollectionService
let environments: EnvironmentService
let transfer: TransferService

const readJson = async (file: string) =>
  JSON.parse(await readFile(path.join(root, file), 'utf8')) as Record<string, unknown>

const postman = {
  info: { name: 'Shop', schema: POSTMAN_SCHEMA_V21 },
  variable: [{ key: 'base', value: 'https://shop.test' }],
  item: [
    {
      name: 'Users',
      item: [{ name: 'List users', request: { method: 'GET', url: '{{base}}/users' } }]
    },
    {
      name: 'Login',
      request: {
        method: 'POST',
        url: '{{base}}/login',
        auth: { type: 'oauth2' },
        body: { mode: 'raw', raw: '{"u":1}', options: { raw: { language: 'json' } } }
      },
      event: [{ listen: 'test', script: { exec: ['pm.environment.set("t", 1)'] } }]
    }
  ]
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-transfer-'))
  const config = new ConfigService(path.join(tmp, 'app-config.json'), undefined, () => undefined)
  await config.load()
  const ws = await new WorkspaceService(config).create({ name: 'WS', parentDir: tmp })
  root = ws.path
  collections = new CollectionService(
    async (p) => rm(p, { recursive: true, force: true }),
    () => undefined
  )
  environments = new EnvironmentService(async (p) => rm(p, { force: true }))
  await collections.open(root, ws.id)
  environments.open(root)
  transfer = new TransferService(collections, environments, async () => ({
    bundle: 'window.Redoc = { init() {} }',
    licenses: 'MIT'
  }))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('TransferService import', () => {
  it('writes an imported Postman Collection as Hachi files', async () => {
    const report = await transfer.importText('shop.json', JSON.stringify(postman))
    expect(report).toMatchObject({
      kind: 'collection',
      name: 'Shop',
      fileName: 'shop.json',
      folders: 1,
      requests: 2,
      variables: 1
    })
    expect(report.warnings).toContain('不支援的 Auth 類型「oauth2」，已改為 None（Login）')

    const tree = await collections.getTree()
    expect(tree.collections.map((c) => c.name)).toEqual(['Shop'])
    const [shop] = tree.collections
    expect(shop?.children.map((c) => c.name)).toEqual(['Users', 'Login'])

    const meta = await readJson('collections/shop/collection.json')
    expect(meta).toMatchObject({ name: 'Shop', auth: { type: 'none' } })
    expect((meta.variables as { key: string }[])[0]?.key).toBe('base')
    expect(await readJson('collections/shop/users/list-users.json')).toMatchObject({
      type: 'http',
      name: 'List users',
      url: '{{base}}/users'
    })
    const login = await readJson('collections/shop/login.json')
    expect(login).toMatchObject({
      method: 'POST',
      body: { mode: 'json', json: '{"u":1}' },
      scripts: { postResponse: 'pm.environment.set("t", 1)' }
    })
    // Every item has a fresh id, and the request is readable through the normal API.
    const loginId = shop?.children[1]?.id as string
    expect((await collections.getRequest(loginId)).request.name).toBe('Login')
  })

  it('names a second import "copy" and keeps file names unique', async () => {
    await transfer.importText('a.json', JSON.stringify(postman))
    const second = await transfer.importText('a.json', JSON.stringify(postman))
    expect(second.name).toBe('Shop copy')
    const tree = await collections.getTree()
    expect(tree.collections.map((c) => [c.name, c.relPath])).toEqual([
      ['Shop', 'collections/shop'],
      ['Shop copy', 'collections/shop-copy']
    ])
  })

  it('imports a Postman Environment; secret values go to .hachi-secrets.json', async () => {
    const env = {
      name: 'Prod',
      values: [
        { key: 'host', value: 'prod.test', enabled: true },
        { key: 'token', value: 's3cret', type: 'secret', enabled: true }
      ]
    }
    const report = await transfer.importText('prod.json', JSON.stringify(env))
    expect(report).toMatchObject({ kind: 'environment', name: 'Prod', variables: 2 })
    const file = await readJson('environments/prod.json')
    expect((file.variables as { value: string }[]).map((v) => v.value)).toEqual(['prod.test', ''])
    expect(JSON.stringify(await readJson('.hachi-secrets.json'))).toContain('s3cret')
    expect((await environments.get(report.id)).variables[1]?.value).toBe('s3cret')
  })

  it('rejects files it cannot import', async () => {
    await expect(transfer.importText('x.json', 'not json')).rejects.toMatchObject({
      code: 'INVALID_FILE',
      message: '不是有效的 JSON 檔案'
    })
    await expect(transfer.importText('x.json', '{"requests":[],"order":[]}')).rejects.toMatchObject(
      {
        code: 'INVALID_FILE',
        message: expect.stringMatching(/v1/)
      }
    )
    const file = path.join(tmp, 'bom.json')
    await writeFile(file, `\uFEFF${JSON.stringify(postman)}`)
    expect((await transfer.importFile(file)).name).toBe('Shop')
    await expect(transfer.importFile(path.join(tmp, 'missing.json'))).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })
})

describe('TransferService export', () => {
  it('exports a Collection (shared headers merged, secrets empty, WebSocket skipped)', async () => {
    const { id } = await transfer.importText('shop.json', JSON.stringify(postman))
    await collections.saveContainer(id, {
      headers: [{ id: 'h', key: 'X-Team', value: 'core', enabled: true }],
      auth: { type: 'bearer', token: '{{token}}' },
      variables: [
        { id: 'v1', key: 'base', value: 'https://shop.test', enabled: true, secret: false },
        { id: 'v2', key: 'token', value: 'hidden', enabled: true, secret: true }
      ]
    })
    await collections.create({
      parentId: id,
      kind: 'request',
      name: 'Live',
      requestType: 'websocket'
    })

    const exported = await transfer.export(id, 'postman', null)
    if (exported.kind !== 'file') throw new Error('expected a file')
    expect(exported.fileName).toBe('shop.postman_collection.json')
    expect(exported.result.skipped).toEqual(['Live'])
    expect(exported.result.unreadable).toEqual([])
    const json = JSON.parse(exported.content) as {
      auth: unknown
      variable: { key: string; value: string }[]
      item: { name: string; item?: { request: { header: unknown[] } }[] }[]
    }
    expect(json.auth).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{token}}', type: 'string' }]
    })
    expect(json.variable.map((v) => [v.key, v.value])).toEqual([
      ['base', 'https://shop.test'],
      ['token', '']
    ])
    expect(json.item.map((i) => i.name)).toEqual(['Users', 'Login'])
    expect(json.item[0]?.item?.[0]?.request.header).toEqual([{ key: 'X-Team', value: 'core' }])
    expect(exported.content).not.toContain('hidden')

    // Exported files import back into the same structure.
    const again = await transfer.importText('again.json', exported.content)
    expect(again).toMatchObject({ name: 'Shop copy', folders: 1, requests: 2 })
  })

  it('only exports Collections', async () => {
    const { id } = await transfer.importText('shop.json', JSON.stringify(postman))
    const folderId = (await collections.getTree()).collections[0]?.children[0]?.id as string
    await expect(transfer.export(folderId, 'postman', null)).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
    expect(id).toBeTruthy()
  })
})

describe('TransferService Bruno and OpenAPI', () => {
  const bruno: Record<string, string> = {
    'bruno.json': '{"version":"1","name":"Pets","type":"collection"}',
    'collection.bru': 'auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{token}}\n}\n',
    'pets/folder.bru': 'meta {\n  name: Pets\n}\n',
    'pets/list.bru':
      'meta {\n  name: List pets\n  type: http\n  seq: 1\n}\n\nget {\n  url: {{baseUrl}}/pets/{{petId}}\n  body: none\n  auth: inherit\n}\n\nassert {\n  res.status: eq 200\n}\n',
    'environments/local.bru':
      'vars {\n  baseUrl: http://localhost:4000\n  petId: 7\n}\nvars:secret [\n  token\n]\n',
    'node_modules/x/ignored.bru': 'not bru',
    '.git/ignored.bru': 'not bru',
    'readme.md': '# not imported'
  }

  async function writeTree(dir: string, files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(dir, ...rel.split('/'))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content)
    }
  }

  it('reads a Bruno folder (skipping node_modules and dot folders) and imports it', async () => {
    const dir = path.join(tmp, 'pets-bruno')
    await writeTree(dir, bruno)
    expect(Object.keys(await readBrunoFolder(dir)).sort()).toEqual([
      'bruno.json',
      'collection.bru',
      'environments/local.bru',
      'pets/folder.bru',
      'pets/list.bru'
    ])
    const result = await transfer.importBrunoFolder(dir)
    if (result.kind !== 'imported') throw new Error('expected an import')
    expect(result.results[0]?.report).toMatchObject({
      kind: 'collection',
      name: 'Pets',
      fileName: 'pets-bruno',
      folders: 1,
      requests: 1,
      environments: ['Pets / local']
    })
    const env = await environments.get((await environments.list())[0]?.id as string)
    expect(env.variables.map((v) => [v.key, v.value, v.secret])).toEqual([
      ['baseUrl', 'http://localhost:4000', false],
      ['petId', '7', false],
      ['token', '', true]
    ])
  })

  it('imports Bruno collection JSON dropped as text', async () => {
    const report = await transfer.importText(
      'pets.json',
      JSON.stringify({ name: 'Pets JSON', version: '1', items: [], environments: [] })
    )
    expect(report).toMatchObject({ kind: 'collection', name: 'Pets JSON', environments: [] })
  })

  it('rejects a folder without Bruno files', async () => {
    const dir = path.join(tmp, 'empty')
    await mkdir(dir)
    await expect(transfer.importBrunoFolder(dir)).rejects.toMatchObject({ code: 'INVALID_FILE' })
  })

  it('lists the collections inside a folder, then imports the chosen ones', async () => {
    const dir = path.join(tmp, 'bruno')
    await writeTree(dir, {
      'folder.bru': 'meta {\n  name: stray\n}\n',
      ...Object.fromEntries(Object.entries(bruno).map(([k, v]) => [`Pets/${k}`, v])),
      'team/Nebula/opencollection.yml': 'opencollection: 1.0.0\ninfo:\n  name: Nebula\n',
      'team/Nebula/登入.yml':
        'info:\n  name: 登入\n  type: http\n  seq: 1\nhttp:\n  method: POST\n  url: https://n.test/login\n',
      'team/Nebula/environments/dev.yml': 'name: dev\nvariables:\n  - name: a\n    value: "1"\n',
      'Broken/bruno.json': '{"name":"Broken"}',
      'Broken/x.bru': 'nonsense'
    })
    const result = await transfer.importBrunoFolder(dir)
    if (result.kind !== 'choose') throw new Error('expected a choice')
    expect(result.folder).toBe('bruno')
    expect(result.collections).toEqual([
      { path: 'Broken', name: 'Broken', format: 'bru' },
      { path: 'Pets', name: 'Pets', format: 'bru' },
      { path: 'team/Nebula', name: 'Nebula', format: 'yaml' }
    ])
    await expect(
      transfer.importBrunoCollections(result.scanId, ['../elsewhere'])
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    const outcomes = await transfer.importBrunoCollections(result.scanId, ['Broken', 'team/Nebula'])
    expect(outcomes[0]).toMatchObject({ fileName: 'Broken', report: null })
    expect(outcomes[0]?.error).toMatch(/x\.bru/)
    expect(outcomes[1]).toMatchObject({
      error: null,
      report: { name: 'Nebula', requests: 1, environments: ['Nebula / dev'] }
    })
    // A scan is used once.
    await expect(transfer.importBrunoCollections(result.scanId, ['Pets'])).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })
  })

  it('imports a folder inside a collection on its own', async () => {
    const dir = path.join(tmp, 'pets-bruno')
    await writeTree(dir, bruno)
    const result = await transfer.importBrunoFolder(path.join(dir, 'pets'))
    if (result.kind !== 'imported') throw new Error('expected an import')
    expect(result.results[0]?.report).toMatchObject({ name: 'Pets', requests: 1, environments: [] })
    expect(result.results[0]?.report?.warnings[0]).toMatch(/只匯入這個資料夾/)
  })

  it('exports Bruno folders and OpenAPI documents', async () => {
    const dir = path.join(tmp, 'pets-bruno')
    await writeTree(dir, bruno)
    const imported = await transfer.importBrunoFolder(dir)
    if (imported.kind !== 'imported') throw new Error('expected an import')
    const id = imported.results[0]?.report?.id as string
    const envId = (await environments.list())[0]?.id as string

    const folder = await transfer.export(id, 'bruno', null)
    if (folder.kind !== 'folder') throw new Error('expected a folder')
    expect(folder.folderName).toBe('Pets')
    expect(Object.keys(folder.files).sort()).toEqual([
      'Pets/List pets.bru',
      'Pets/folder.bru',
      'bruno.json',
      'collection.bru',
      'environments/local.bru'
    ])

    const yaml = await transfer.export(id, 'bruno-yaml', null)
    if (yaml.kind !== 'folder') throw new Error('expected a folder')
    expect(Object.keys(yaml.files).sort()).toEqual([
      'Pets/List pets.yml',
      'Pets/folder.yml',
      'environments/local.yml',
      'opencollection.yml'
    ])

    const json = await transfer.export(id, 'openapi-json', envId)
    if (json.kind !== 'file') throw new Error('expected a file')
    expect(json.fileName).toBe('pets.openapi.json')
    const doc = JSON.parse(json.content) as { servers: unknown; paths: Record<string, unknown> }
    expect(doc.servers).toEqual([{ url: 'http://localhost:4000' }])
    expect(Object.keys(doc.paths)).toEqual(['/pets/{petId}'])

    const html = await transfer.export(id, 'openapi-html', null)
    if (html.kind !== 'file') throw new Error('expected a file')
    expect(html.fileName).toBe('pets.html')
    expect(html.content).toContain('window.Redoc = { init() {} }')
    expect(html.result.warnings[0]).toMatch(/伺服器網址中的變數沒有值/)
  })
})
