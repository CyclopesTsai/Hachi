/**
 * The current Workspace's cookie jar (decision 129), saved on this computer at
 * `<userData>/cookies/<workspace id>.json`. Saves are batched and atomic.
 */
import path from 'node:path'
import { HachiError } from '@shared/errors'
import { COOKIES_DIR, COOKIES_VERSION, cookiesFormat } from '@shared/schemas/cookies'
import { writeJsonAtomic } from './fs/atomic-write'
import { readVersionedJson } from './fs/json-file'
import { CookieJar } from './http/cookie-jar'

const SAVE_DELAY_MS = 500

export class CookieService {
  private jar: CookieJar | null = null
  private workspaceId: string | null = null
  private timer: NodeJS.Timeout | null = null
  private unsubscribe: (() => void) | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly userDataDir: string,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  private fileOf(workspaceId: string): string {
    // Ids come from workspace.json; keep them to a safe file name.
    return path.join(this.userDataDir, COOKIES_DIR, `${workspaceId.replace(/[^\w-]/g, '_')}.json`)
  }

  /** Switches to a Workspace's jar (null = none open). Unsaved changes are saved first. */
  async open(workspaceId: string | null): Promise<void> {
    if (workspaceId === this.workspaceId) return
    await this.flush()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.workspaceId = workspaceId
    this.jar = null
    if (!workspaceId) return
    let cookies: ConstructorParameters<typeof CookieJar>[0] = []
    try {
      cookies = (await readVersionedJson(this.fileOf(workspaceId), cookiesFormat)).cookies
    } catch (error) {
      // A missing file is an empty jar; a broken one is replaced on the next save.
      if (!(error instanceof HachiError && error.code === 'NOT_FOUND')) this.onError(error)
    }
    if (this.workspaceId !== workspaceId) return // switched again meanwhile
    const jar = new CookieJar(cookies)
    this.jar = jar
    this.unsubscribe = jar.onChange(() => this.schedule())
  }

  /** Changes not written yet. */
  dirty(): boolean {
    return this.timer !== null
  }

  /** The current jar; null when no Workspace is open (or still loading). */
  current(): CookieJar | null {
    return this.jar
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, SAVE_DELAY_MS)
  }

  private save(): Promise<void> {
    const jar = this.jar
    const id = this.workspaceId
    if (!jar || !id) return this.pending
    const cookies = jar.toJSON()
    this.pending = this.pending
      .then(() => writeJsonAtomic(this.fileOf(id), { version: COOKIES_VERSION, cookies }))
      .catch(this.onError)
    return this.pending
  }

  /** Writes pending changes now (Workspace switch, quit). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      await this.save()
    }
    await this.pending
  }
}
