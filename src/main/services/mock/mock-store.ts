/**
 * Mock Server files of the current Workspace (decision 133): `mocks/<slug>.json`.
 * Re-read on every listing (no watching), like environments.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { HachiError } from '@shared/errors'
import { copyName, slugify } from '@shared/file-names'
import type { MockSummary } from '@shared/mock'
import {
  MOCK_VERSION,
  MOCKS_DIR,
  mockFileSchema,
  mockFormat,
  type MockFile,
  type MockSettings
} from '@shared/schemas/mock'
import { parseVersioned } from '@shared/schemas/versioned'
import { INVALID_ID_PREFIX } from '@shared/tree'
import type { TrashFn } from '../collection-service'
import { isTempFileName, writeJsonAtomic } from '../fs/atomic-write'
import { readJsonFile } from '../fs/json-file'
import { uniqueFileName } from '../fs/unique-name'

interface Entry {
  file: string
  name: string
  invalid: boolean
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class MockStore {
  private root: string | null = null
  private index = new Map<string, Entry>()
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

  /** Sorted by name; an empty list when no Workspace is open. */
  list(): Promise<MockSummary[]> {
    return this.run(() => (this.root ? this.scan() : Promise.resolve([])))
  }

  get(id: string): Promise<MockFile> {
    return this.run(async () => this.read(await this.requireValid(id)))
  }

  create(nameInput: string, settings: Partial<MockSettings> = {}): Promise<MockFile> {
    return this.run(async () => {
      const dir = await this.requireDir()
      const name = nameInput.trim()
      const mock = mockFileSchema.parse({
        ...settings,
        version: MOCK_VERSION,
        id: this.newId(),
        name
      })
      const file = path.join(dir, await uniqueFileName(dir, slugify(name), '.json'))
      await writeJsonAtomic(file, mock)
      await this.scan()
      return mock
    })
  }

  /** Saves the settings (routes, endpoints, port…). */
  save(id: string, settings: MockSettings): Promise<MockFile> {
    return this.run(async () => {
      const entry = await this.requireValid(id)
      const current = await this.read(entry)
      const mock = mockFileSchema.parse({ ...current, ...settings, version: MOCK_VERSION })
      await writeJsonAtomic(entry.file, mock)
      return mock
    })
  }

  /** Renames the Mock Server and its file. */
  rename(id: string, nameInput: string): Promise<MockFile> {
    return this.run(async () => {
      const entry = await this.requireValid(id)
      const name = nameInput.trim()
      const mock = { ...(await this.read(entry)), name }
      await writeJsonAtomic(entry.file, mockFileSchema.parse(mock))
      const dir = path.dirname(entry.file)
      const target = await uniqueFileName(dir, slugify(name), '.json', {
        keep: path.basename(entry.file)
      })
      let file = entry.file
      if (target !== path.basename(file)) {
        file = path.join(dir, target)
        await rename(entry.file, file)
      }
      this.index.set(id, { file, name, invalid: false })
      return mock
    })
  }

  duplicate(id: string): Promise<MockFile> {
    return this.run(async () => {
      const entry = await this.requireValid(id)
      const source = await this.read(entry)
      const dir = await this.requireDir()
      const name = copyName(
        source.name,
        [...this.index.values()].map((e) => e.name)
      )
      const mock = { ...source, id: this.newId(), name }
      await writeJsonAtomic(path.join(dir, await uniqueFileName(dir, slugify(name), '.json')), mock)
      await this.scan()
      return mock
    })
  }

  /** Moves the file to the system trash. */
  delete(id: string): Promise<void> {
    return this.run(async () => {
      const entry = await this.requireEntry(id)
      await this.trash(entry.file)
      this.index.delete(id)
    })
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async requireDir(): Promise<string> {
    if (!this.root) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    const dir = path.join(this.root, MOCKS_DIR)
    await mkdir(dir, { recursive: true })
    return dir
  }

  private async requireEntry(id: string): Promise<Entry> {
    if (!this.index.has(id)) await this.scan()
    const entry = this.index.get(id)
    if (!entry) throw new HachiError('NOT_FOUND', 'Mock Server not found')
    return entry
  }

  private async requireValid(id: string): Promise<Entry> {
    const entry = await this.requireEntry(id)
    if (entry.invalid) throw new HachiError('INVALID_FILE', 'This Mock Server file is unreadable')
    return entry
  }

  private async read(entry: Entry): Promise<MockFile> {
    return parseVersioned(mockFormat, await readJsonFile(entry.file))
  }

  private async scan(): Promise<MockSummary[]> {
    const dir = await this.requireDir()
    const names = (await readdir(dir)).filter(
      (n) => n.endsWith('.json') && !n.startsWith('.') && !isTempFileName(n)
    )
    const index = new Map<string, Entry>()
    const list: MockSummary[] = []
    for (const fileName of names.sort()) {
      const file = path.join(dir, fileName)
      try {
        let mock = parseVersioned(mockFormat, await readJsonFile(file))
        if (index.has(mock.id)) {
          // A copied file: give it its own id so both can be used.
          mock = { ...mock, id: this.newId() }
          await writeJsonAtomic(file, mock)
        }
        index.set(mock.id, { file, name: mock.name, invalid: false })
        list.push({ id: mock.id, name: mock.name })
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
