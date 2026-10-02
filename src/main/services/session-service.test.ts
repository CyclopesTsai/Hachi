import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from './session-service'

let tmp: string
let service: SessionService

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-session-'))
  service = new SessionService(path.join(tmp, 'sessions'), () => undefined)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('SessionService', () => {
  it('returns an empty session when nothing was saved', async () => {
    expect(await service.get('/ws/a')).toEqual({
      tabs: [],
      activeTab: null,
      activeEnvironmentId: null
    })
  })

  it('saves per Workspace path, in a file named by its hash', async () => {
    const data = {
      tabs: [{ kind: 'item' as const, id: 'r1' }, { kind: 'environments' as const }],
      activeTab: 1,
      activeEnvironmentId: 'env-1'
    }
    await service.save('/ws/a', data)
    expect(await service.get('/ws/a')).toEqual(data)
    expect(await service.get('/ws/b')).toMatchObject({ tabs: [] })
    const file = JSON.parse(await readFile(service.fileFor('/ws/a'), 'utf8'))
    expect(file).toMatchObject({ version: 1, workspacePath: path.resolve('/ws/a') })
    expect(path.basename(service.fileFor('/ws/a'))).toMatch(/^[0-9a-f]{40}\.json$/)
  })

  it('drops an out-of-range active tab, ignores corrupt files and removes sessions', async () => {
    await service.save('/ws/a', { tabs: [], activeTab: 3, activeEnvironmentId: null })
    expect((await service.get('/ws/a')).activeTab).toBeNull()
    await writeFile(service.fileFor('/ws/a'), 'corrupt')
    expect(await service.get('/ws/a')).toMatchObject({ tabs: [] })
    await service.remove('/ws/a')
    await service.remove('/ws/a') // twice is fine
  })
})
