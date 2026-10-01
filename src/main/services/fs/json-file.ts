import { readFile } from 'node:fs/promises'
import type { z } from 'zod'
import { HachiError } from '@shared/errors'
import { parseVersioned, type VersionedFormat } from '@shared/schemas/versioned'

/**
 * Reads and parses a JSON file.
 * @throws HachiError NOT_FOUND | INVALID_FILE | IO_ERROR
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new HachiError('NOT_FOUND', `File not found: ${filePath}`, { cause: error })
    }
    throw new HachiError('IO_ERROR', `Cannot read ${filePath}: ${String(error)}`, { cause: error })
  }
  try {
    // Tolerate a UTF-8 BOM written by some editors.
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  } catch (error) {
    throw new HachiError('INVALID_FILE', `${filePath} is not valid JSON`, { cause: error })
  }
}

/** Reads a JSON file, migrates it to the current version and validates it. */
export async function readVersionedJson<S extends z.ZodType>(
  filePath: string,
  format: VersionedFormat<S>
): Promise<z.output<S>> {
  return parseVersioned(format, await readJsonFile(filePath))
}
