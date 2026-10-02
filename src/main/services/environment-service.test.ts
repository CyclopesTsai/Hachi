import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigService } from './config-service'
import { EnvironmentService } from './environment-service'
import { WorkspaceService } from './workspace-service'

let tmp: string
let root: string
let trashed: string[]
let service: EnvironmentService
let counter: number

const envDir = () => path.join(root, 'environments')
const readJson = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>

const variable = (id: string, key: string, value: string, secret = false) => ({
  id,
  key,
  value,
  enabled: true,
  secret
})

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-env-'))
  const config = new ConfigService(path.join(tmp, 'app-config.json'), undefined, () => undefined)
  await config.load()
  root = (await new WorkspaceService(config).create({ name: 'WS', parentDir: tmp })).path
  trashed = []
  counter = 0
  service = new EnvironmentService(
    async (p) => {
      trashed.push(p)
      await rm(p, { force: true })
    },
    () => `env-${++counter}`
  )
  service.open(root)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('EnvironmentService', () => {
  it('creates environments as slug-named files, listed by name', async () => {
    await service.create('Staging')
    const { id, list } = await service.create('dev')
    expect(id).toBe('env-2')
    expect(list.map((e) => e.name)).toEqual(['dev', 'Staging'])
    expect((await readdir(envDir())).sort()).toEqual(['dev.json', 'staging.json'])
    expect(await readJson(path.join(envDir(), 'dev.json'))).toEqual({
      version: 1,
      id: 'env-2',
      name: 'dev',
      variables: []
    })
  })

  it('stores secret values only in .hachi-secrets.json', async () => {
    const { id } = await service.create('dev')
    const saved = await service.save(id, {
      name: 'dev',
      variables: [variable('a', 'base', 'https://dev'), variable('b', 'token', 'T0P', true)]
    })
    expect(saved.variables.map((v) => v.value)).toEqual(['https://dev', 'T0P'])

    const file = await readFile(path.join(envDir(), 'dev.json'), 'utf8')
    expect(file).not.toContain('T0P')
    expect(JSON.parse(file).variables[1]).toMatchObject({ key: 'token', value: '', secret: true })
    const secrets = await readJson(path.join(root, '.hachi-secrets.json'))
    expect(secrets.environments).toEqual({ [id]: { b: 'T0P' } })

    const layer = await service.layer(id)
    expect(layer).toMatchObject({ source: 'environment', sourceName: 'dev' })
    expect(layer?.variables[1]?.value).toBe('T0P')
    expect(await service.layer(null)).toBeNull()
  })

  it('renames the file with the environment, keeping secrets', async () => {
    const { id } = await service.create('dev')
    await service.save(id, { name: 'Development', variables: [variable('s', 'k', 'v', true)] })
    expect(await readdir(envDir())).toEqual(['development.json'])
    expect((await service.get(id)).variables[0]?.value).toBe('v')
  })

  it('duplicates with a copy name, a new id and the secrets', async () => {
    const { id } = await service.create('dev')
    await service.save(id, { name: 'dev', variables: [variable('s', 'k', 'v', true)] })
    const copy = await service.duplicate(id)
    expect(copy.list.map((e) => e.name)).toEqual(['dev', 'dev copy'])
    expect((await service.get(copy.id)).variables[0]?.value).toBe('v')
  })

  it('deletes to the trash', async () => {
    const { id } = await service.create('dev')
    expect(await service.delete(id)).toEqual([])
    expect(trashed).toEqual([path.join(envDir(), 'dev.json')])
    await expect(service.get(id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('lists unreadable files as errors and fixes duplicated ids', async () => {
    const { id } = await service.create('dev')
    await writeFile(path.join(envDir(), 'broken.json'), '{ nope')
    const original = await readFile(path.join(envDir(), 'dev.json'), 'utf8')
    await writeFile(path.join(envDir(), 'zz-copy.json'), original.replace('"dev"', '"copied"'))
    const list = await service.list()
    expect(list.find((e) => e.name === 'broken.json')?.error).toBeTruthy()
    const copied = list.find((e) => e.name === 'copied')
    expect(copied?.id).not.toBe(id)
    expect(list.find((e) => e.name === 'dev')?.id).toBe(id)
    await expect(service.get(list.find((e) => e.error)!.id)).rejects.toMatchObject({
      code: 'INVALID_FILE'
    })
  })

  it('reports a corrupt secrets file instead of overwriting it', async () => {
    const { id } = await service.create('dev')
    await writeFile(path.join(root, '.hachi-secrets.json'), 'garbage')
    await expect(service.get(id)).rejects.toMatchObject({ code: 'INVALID_FILE' })
    await expect(
      service.save(id, { name: 'dev', variables: [variable('s', 'k', 'v', true)] })
    ).rejects.toMatchObject({ code: 'INVALID_FILE' })
    expect(await readFile(path.join(root, '.hachi-secrets.json'), 'utf8')).toBe('garbage')
  })

  it('fails without a Workspace', async () => {
    const closed = new EnvironmentService(async () => undefined)
    closed.open(null)
    await expect(closed.list()).rejects.toMatchObject({ code: 'NO_WORKSPACE' })
  })
})
