import type { z } from 'zod'
import { HachiError } from '../errors'

/**
 * Migrates `raw` JSON from version N to N+1. Receives the raw (unvalidated)
 * object and returns the raw object for the next version.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>

export interface VersionedFormat<S extends z.ZodType> {
  /** Human readable name used in error messages, e.g. "app-config.json". */
  name: string
  currentVersion: number
  schema: S
  /** `migrations[n]` upgrades a version-n object to version n+1. */
  migrations?: Record<number, Migration>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates a parsed JSON value against a versioned format, running migrations first.
 *
 * - Missing / non-integer `version` → INVALID_FILE
 * - `version` newer than this build understands → UNSUPPORTED_VERSION
 * - Schema mismatch after migration → INVALID_FILE
 */
export function parseVersioned<S extends z.ZodType>(
  format: VersionedFormat<S>,
  raw: unknown
): z.output<S> {
  if (!isPlainObject(raw)) {
    throw new HachiError('INVALID_FILE', `${format.name}: expected a JSON object`)
  }
  let current: Record<string, unknown> = raw
  let version = current.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new HachiError('INVALID_FILE', `${format.name}: missing or invalid "version" field`)
  }
  if (version > format.currentVersion) {
    throw new HachiError(
      'UNSUPPORTED_VERSION',
      `${format.name}: version ${version} is newer than supported (${format.currentVersion}). Please update Hachi.`
    )
  }
  while (version < format.currentVersion) {
    const migrate = format.migrations?.[version]
    if (!migrate) {
      throw new HachiError(
        'INVALID_FILE',
        `${format.name}: no migration from version ${version} to ${version + 1}`
      )
    }
    current = { ...migrate(current), version: version + 1 }
    version += 1
  }
  const result = format.schema.safeParse(current)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : ''
    throw new HachiError(
      'INVALID_FILE',
      `${format.name}: invalid content${where}: ${issue?.message ?? 'unknown error'}`
    )
  }
  return result.data
}
