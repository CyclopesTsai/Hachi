import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { HachiError, isHachiError } from '@shared/errors'
import type { EnvironmentData, EnvironmentSummary } from '@shared/ipc/api'
import { copyName, slugify } from '@shared/file-names'
import { ITEM_NAME_MAX, type Variable } from '@shared/schemas/collection'
import type { PortableEnvironment } from '@shared/transfer/portable'
import {
  ENVIRONMENT_VERSION,
  environmentFileSchema,
  environmentFormat,
  mergeSecrets,
  splitSecrets
} from '@shared/schemas/environment'
import { parseVersioned } from '@shared/schemas/versioned'
import { WORKSPACE_LAYOUT } from '@shared/schemas/workspace'
import { INVALID_ID_PREFIX } from '@shared/tree'
import { applyVariableChanges, type VariableLayer } from '@shared/variables'
import type { TrashFn } from './collection-service'
import { isTempFileName, updateJsonAtomic, writeJsonAtomic } from './fs/atomic-write'
import { readJsonFile } from './fs/json-file'
import { uniqueFileName } from './fs/unique-name'
import { copySecrets, getSecrets, setSecrets } from './secrets'

interface EnvEntry {
  file: string
  name: string
  invalid: boolean
}

function errorText(error: unknown): string {
  return isHachiError(error) ? error.message : String(error)
}

/**
 * Environments of the current Workspace: `environments/<slug>.json`.
 * Secret values live in `.hachi-secrets.json` (by environment id → variable id).
 * Like collections, files are re-read on every listing instead of being watched.
 */
export class EnvironmentService {
  private root: string | null = null
  private index = new Map<string, EnvEntry>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly trash: TrashFn,
    private readonly newId: () => string = randomUUID
  ) {}

  open(root: string | null): void {
    void this.run(async () => {
      this.root = root ? path.resolve(root) : null
      this.index = new Map()
    })
  }

  /** All environments, sorted by name. */
  list(): Promise<EnvironmentSummary[]> {
    return this.run(() => this.scan())
  }

  get(id: string): Promise<EnvironmentData> {
    return this.run(async () => this.read(await this.requireValid(id), id))
  }

  create(nameInput: string): Promise<{ id: string; list: EnvironmentSummary[] }> {
    return this.run(async () => {
      const dir = await this.requireDir()
      const id = this.newId()
      const name = nameInput.trim()
      const file = path.join(dir, await uniqueFileName(dir, slugify(name), '.json'))
      await writeJsonAtomic(
        file,
        environmentFileSchema.parse({ version: ENVIRONMENT_VERSION, id, name })
      )
      return { id, list: await this.scan() }
    })
  }

  /** Applies `set` / `unset` from a script or an extraction row (decision 71). */
  async applyVariableChanges(
    id: string,
    changes: readonly { name: string; value: string | null }[]
  ): Promise<EnvironmentData> {
    const env = await this.get(id)
    return this.save(id, {
      name: env.name,
      variables: applyVariableChanges(env.variables, changes, this.newId)
    })
  }

  /** Creates an environment from an import. A name already in use gets " copy". */
  importEnvironment(env: PortableEnvironment): Promise<{ id: string; list: EnvironmentSummary[] }> {
    return this.run(async () => {
      const dir = await this.requireDir()
      const existing = (await this.scan()).map((e) => e.name)
      const taken = new Set(existing.map((n) => n.toLowerCase()))
      const name = (taken.has(env.name.toLowerCase()) ? copyName(env.name, existing) : env.name)
        .slice(0, ITEM_NAME_MAX)
        .trim()
      const id = this.newId()
      const { stored, secrets } = splitSecrets(env.variables)
      // Secrets first: if this fails the committed file still has no secret values.
      await setSecrets(this.requireRoot(), 'environments', id, secrets)
      const file = path.join(dir, await uniqueFileName(dir, slugify(name), '.json'))
      await writeJsonAtomic(
        file,
        environmentFileSchema.parse({ version: ENVIRONMENT_VERSION, id, name, variables: stored })
      )
      return { id, list: await this.scan() }
    })
  }

  /**
   * Saves name and variables. Secret values go to the secrets file; the
   * environment file keeps them empty. Renaming also renames the file.
   */
  save(id: string, data: { name: string; variables: Variable[] }): Promise<EnvironmentData> {
    return this.run(async () => {
      const entry = await this.requireValid(id)
      const root = this.requireRoot()
      const name = data.name.trim()
      const { stored, secrets } = splitSecrets(data.variables)
      // Secrets first: if this fails the committed file still has no secret values.
      await setSecrets(root, 'environments', id, secrets)
      await updateJsonAtomic(
        entry.file,
        async () => (await readJsonFile(entry.file)) as Record<string, unknown>,
        (raw) => ({ ...raw, version: ENVIRONMENT_VERSION, id, name, variables: stored })
      )
      let file = entry.file
      if (name !== entry.name) {
        const dir = path.dirname(file)
        const target = await uniqueFileName(dir, slugify(name), '.json', {
          keep: path.basename(file)
        })
        if (target !== path.basename(file)) {
          await rename(file, path.join(dir, target))
          file = path.join(dir, target)
        }
      }
      this.index.set(id, { file, name, invalid: false })
      return this.read(this.index.get(id) as EnvEntry, id)
    })
  }

  duplicate(id: string): Promise<{ id: string; list: EnvironmentSummary[] }> {
    return this.run(async () => {
      const entry = await this.requireValid(id)
      const root = this.requireRoot()
      const dir = await this.requireDir()
      const raw = (await readJsonFile(entry.file)) as Record<string, unknown>
      const others = [...this.index.values()].map((e) => e.name)
      const name = copyName(entry.name, others)
      const newId = this.newId()
      await copySecrets(root, 'environments', id, newId)
      const file = path.join(dir, await uniqueFileName(dir, slugify(name), '.json'))
      await writeJsonAtomic(file, { ...raw, id: newId, name })
      return { id: newId, list: await this.scan() }
    })
  }

  /** Moves the file to the system trash. Its secret values are kept (so a restore works). */
  delete(id: string): Promise<EnvironmentSummary[]> {
    return this.run(async () => {
      const entry = await this.requireEntry(id)
      await this.trash(entry.file)
      return this.scan()
    })
  }

  /** Variables of an environment for sending, or null for "no environment". */
  layer(id: string | null): Promise<VariableLayer | null> {
    if (id === null) return Promise.resolve(null)
    return this.run(async () => {
      const env = await this.read(await this.requireValid(id), id)
      return { source: 'environment', sourceName: env.name, variables: env.variables }
    })
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private requireRoot(): string {
    if (!this.root) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    return this.root
  }

  private async requireDir(): Promise<string> {
    const dir = path.join(this.requireRoot(), WORKSPACE_LAYOUT.environmentsDir)
    await mkdir(dir, { recursive: true })
    return dir
  }

  /** Looks up an id, re-scanning once if it is unknown (e.g. the list was never loaded). */
  private async requireEntry(id: string): Promise<EnvEntry> {
    if (!this.index.has(id)) await this.scan()
    const entry = this.index.get(id)
    if (!entry) throw new HachiError('NOT_FOUND', 'Environment not found')
    return entry
  }

  private async requireValid(id: string): Promise<EnvEntry> {
    const entry = await this.requireEntry(id)
    if (entry.invalid) throw new HachiError('INVALID_FILE', 'This environment file is unreadable')
    return entry
  }

  private async read(entry: EnvEntry, id: string): Promise<EnvironmentData> {
    const file = parseVersioned(environmentFormat, await readJsonFile(entry.file))
    const secrets = await getSecrets(this.requireRoot(), 'environments', id)
    return { id, name: file.name, variables: mergeSecrets(file.variables, secrets) }
  }

  private async scan(): Promise<EnvironmentSummary[]> {
    const dir = await this.requireDir()
    const names = (await readdir(dir)).filter(
      (n) => n.endsWith('.json') && !n.startsWith('.') && !isTempFileName(n)
    )
    const index = new Map<string, EnvEntry>()
    const list: EnvironmentSummary[] = []
    for (const fileName of names.sort()) {
      const file = path.join(dir, fileName)
      try {
        const raw = await readJsonFile(file)
        const env = parseVersioned(environmentFormat, raw)
        let id = env.id
        if (index.has(id)) {
          // A copied file: give it its own id so both can be used.
          id = this.newId()
          await updateJsonAtomic(
            file,
            async () => (await readJsonFile(file)) as Record<string, unknown>,
            (r) => ({ ...r, id })
          )
        }
        index.set(id, { file, name: env.name, invalid: false })
        list.push({ id, name: env.name })
      } catch (error) {
        const id = `${INVALID_ID_PREFIX}${fileName}`
        index.set(id, { file, name: fileName, invalid: true })
        list.push({ id, name: fileName, error: errorText(error) })
      }
    }
    this.index = index
    return list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }
}
