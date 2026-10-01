import { z } from 'zod'
import type { VersionedFormat } from './versioned'

/** Stored at `<workspace>/workspace.json`. See docs/schema.md. */
export const WORKSPACE_VERSION = 1
export const WORKSPACE_FILE = 'workspace.json'
export const WORKSPACE_NAME_MAX = 100

/** Files / folders inside a Workspace folder. */
export const WORKSPACE_LAYOUT = {
  collectionsDir: 'collections',
  environmentsDir: 'environments',
  historyFile: 'history.json',
  secretsFile: '.hachi-secrets.json',
  gitignoreFile: '.gitignore'
} as const

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(WORKSPACE_NAME_MAX, `Name must be at most ${WORKSPACE_NAME_MAX} characters`)

export const workspaceSettingsSchema = z.object({
  /** Default request timeout in milliseconds. 0 = no timeout. */
  timeoutMs: z.number().int().min(0).default(30_000),
  /** Default TLS certificate verification. */
  validateSSL: z.boolean().default(true)
})

export const workspaceFileSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  id: z.string().min(1),
  name: workspaceNameSchema,
  createdAt: z.string(),
  settings: workspaceSettingsSchema.default({ timeoutMs: 30_000, validateSSL: true }),
  /** Collection ids, in display order. Unknown / missing ids are tolerated (see docs/schema.md). */
  collectionOrder: z.array(z.string()).default([])
})
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>

export const workspaceFormat: VersionedFormat<typeof workspaceFileSchema> = {
  name: WORKSPACE_FILE,
  currentVersion: WORKSPACE_VERSION,
  schema: workspaceFileSchema
}

/** History file skeleton. Entry format is finalized in Phase 3 (see docs/schema.md). */
export const HISTORY_VERSION = 1
export function emptyHistoryFile(): { version: number; entries: unknown[] } {
  return { version: HISTORY_VERSION, entries: [] }
}

/** Content of the `.gitignore` written into every new Workspace. */
export const WORKSPACE_GITIGNORE = [
  '# Hachi — files that must not be committed',
  '# Secret variable values (environments keep only the variable names)',
  WORKSPACE_LAYOUT.secretsFile,
  '# Request history may contain tokens and resolved secrets',
  WORKSPACE_LAYOUT.historyFile,
  '# Temporary files from atomic writes',
  '*.tmp',
  ''
].join('\n')
