import { createHash } from 'node:crypto'
import path from 'node:path'
import { isHachiError } from '@shared/errors'
import {
  SESSION_VERSION,
  sessionDataSchema,
  sessionFormat,
  type SessionData
} from '@shared/schemas/session'
import { writeJsonAtomic } from './fs/atomic-write'
import { readVersionedJson } from './fs/json-file'
import { rm } from 'node:fs/promises'

/**
 * Per-Workspace UI state on this computer (open tabs, active environment):
 * `<sessionsDir>/<sha1(workspacePath)>.json`. Lost or corrupt files just mean
 * "start with no tabs".
 */
export class SessionService {
  constructor(
    private readonly sessionsDir: string,
    private readonly log: (message: string) => void = console.warn
  ) {}

  fileFor(workspacePath: string): string {
    const hash = createHash('sha1').update(path.resolve(workspacePath)).digest('hex')
    return path.join(this.sessionsDir, `${hash}.json`)
  }

  async get(workspacePath: string): Promise<SessionData> {
    try {
      const file = await readVersionedJson(this.fileFor(workspacePath), sessionFormat)
      return {
        tabs: file.tabs,
        activeTab: file.activeTab,
        activeEnvironmentId: file.activeEnvironmentId
      }
    } catch (error) {
      if (!(isHachiError(error) && error.code === 'NOT_FOUND')) {
        this.log(`[session] ignoring unreadable session: ${String(error)}`)
      }
      return sessionDataSchema.parse({})
    }
  }

  async save(workspacePath: string, data: SessionData): Promise<void> {
    const valid = sessionDataSchema.parse(data)
    if (valid.activeTab !== null && valid.activeTab >= valid.tabs.length) valid.activeTab = null
    await writeJsonAtomic(this.fileFor(workspacePath), {
      version: SESSION_VERSION,
      workspacePath: path.resolve(workspacePath),
      ...valid
    })
  }

  async remove(workspacePath: string): Promise<void> {
    await rm(this.fileFor(workspacePath), { force: true })
  }
}
