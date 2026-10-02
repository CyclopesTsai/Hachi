/**
 * `<userData>/sessions/<sha1(workspacePath)>.json`: open tabs and the active
 * environment of one Workspace on this computer. Never inside the Workspace.
 * Unsaved content is not stored (closing always asks first). See docs/schema.md.
 */
import { z } from 'zod'
import type { VersionedFormat } from './versioned'

export const SESSION_VERSION = 1
export const SESSIONS_DIR = 'sessions'
export const MAX_SESSION_TABS = 100

export const sessionTabSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), id: z.string().min(1).max(1024) }),
  z.object({ kind: z.literal('environments') })
])
export type SessionTab = z.infer<typeof sessionTabSchema>

export const sessionDataSchema = z.object({
  tabs: z.array(sessionTabSchema).max(MAX_SESSION_TABS).default([]),
  /** Index into `tabs`; null = none. */
  activeTab: z.number().int().min(0).nullable().default(null),
  activeEnvironmentId: z.string().min(1).max(1024).nullable().default(null)
})
export type SessionData = z.infer<typeof sessionDataSchema>

export const sessionFileSchema = sessionDataSchema.extend({
  version: z.literal(SESSION_VERSION),
  /** For humans inspecting the folder; the file name is the hash of this path. */
  workspacePath: z.string()
})
export type SessionFile = z.infer<typeof sessionFileSchema>

export const sessionFormat: VersionedFormat<typeof sessionFileSchema> = {
  name: 'session file',
  currentVersion: SESSION_VERSION,
  schema: sessionFileSchema
}
