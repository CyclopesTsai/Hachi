import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

/** Error codes that indicate a transient lock (mostly Windows: antivirus / indexer). */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRIES = 5

/** Temp files are hidden and end in `.tmp` so scans and git can ignore them. */
export function isTempFileName(fileName: string): boolean {
  return fileName.startsWith('.') && fileName.endsWith('.tmp')
}

function tempPathFor(filePath: string): string {
  const suffix = `${process.pid}.${randomBytes(6).toString('hex')}`
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${suffix}.tmp`)
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= RENAME_RETRIES || !code || !RETRYABLE_RENAME_CODES.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Runs `task` after every previously queued task for the same key has settled.
 * Guarantees that writes to one file land in call order.
 */
function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  const settled = next.catch(() => undefined)
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return next
}

async function writeUnqueued(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const tmp = tempPathFor(target)
  let handle: FileHandle | undefined
  try {
    handle = await open(tmp, 'w', 0o644)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameWithRetry(tmp, target)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Atomically replaces `filePath` with `data`:
 * write to a temp file in the same directory → fsync → rename over the target.
 * Readers see either the old or the new content, never a partial file.
 */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const target = path.resolve(filePath)
  return enqueue(target, () => writeUnqueued(target, data))
}

/** Serializes `value` as pretty JSON (2 spaces, trailing newline) and writes it atomically. */
export function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  return writeFileAtomic(filePath, toJson(value))
}

/**
 * Read-modify-write of a JSON file as one queued step, so concurrent updates
 * to the same file (e.g. from two services) cannot overwrite each other.
 * `read` loads and validates the current content; `mutate` returns the new value.
 */
export function updateJsonAtomic<T>(
  filePath: string,
  read: () => Promise<T>,
  mutate: (current: T) => unknown
): Promise<void> {
  const target = path.resolve(filePath)
  return enqueue(target, async () => {
    const next = mutate(await read())
    await writeUnqueued(target, toJson(next))
  })
}
