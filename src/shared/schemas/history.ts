/**
 * `<workspace>/history.json` (per Workspace) and `<userData>/history-index.json`
 * (one index for all Workspaces, used for the shared entry limit). See docs/schema.md.
 */
import { z } from 'zod'
import { HTTP_ERROR_CODES } from '../http'
import { httpRequestSchema } from './http-request'
import type { VersionedFormat } from './versioned'

export const HISTORY_VERSION = 1
export const HISTORY_INDEX_VERSION = 1
export const HISTORY_INDEX_FILE = 'history-index.json'

export const HISTORY_LIMIT_MIN = 50
export const HISTORY_LIMIT_MAX = 1000
export const HISTORY_LIMIT_DEFAULT = 200

export const historyResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('response'),
    status: z.number().int(),
    statusText: z.string().default(''),
    timeMs: z.number(),
    sizeBytes: z.number().int().min(0)
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum(HTTP_ERROR_CODES).catch('UNKNOWN'),
    message: z.string(),
    timeMs: z.number()
  })
])
export type HistoryResult = z.infer<typeof historyResultSchema>

export const httpHistoryEntrySchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('http'),
  /** ISO time the request was sent. */
  sentAt: z.string(),
  /** The tree item that was sent, or null for an unsaved request. */
  requestId: z.string().nullable().default(null),
  /** Name of the active environment at the time, for display. */
  environmentName: z.string().nullable().default(null),
  /** The request as edited, before variable substitution. */
  request: httpRequestSchema,
  /** Summary only: response bodies are never stored. */
  result: historyResultSchema
})
export type HttpHistoryEntry = z.infer<typeof httpHistoryEntrySchema>

/**
 * Entries are only checked for the fields every type shares, so entries written
 * by a newer build (e.g. WebSocket in Phase 4) are kept when the file is rewritten.
 */
const storedEntrySchema = z.looseObject({
  id: z.string().min(1),
  type: z.string(),
  sentAt: z.string()
})

export const historyFileSchema = z.object({
  version: z.literal(HISTORY_VERSION),
  /** Newest first. */
  entries: z.array(storedEntrySchema).default([])
})
export type HistoryFile = z.infer<typeof historyFileSchema>

export const historyFormat: VersionedFormat<typeof historyFileSchema> = {
  name: 'history.json',
  currentVersion: HISTORY_VERSION,
  schema: historyFileSchema
}

export function emptyHistoryFile(): HistoryFile {
  return { version: HISTORY_VERSION, entries: [] }
}

export const historyIndexSchema = z.object({
  version: z.literal(HISTORY_INDEX_VERSION),
  entries: z
    .array(
      z.object({
        workspacePath: z.string().min(1),
        id: z.string().min(1),
        sentAt: z.string()
      })
    )
    .default([])
})
export type HistoryIndex = z.infer<typeof historyIndexSchema>
export type HistoryIndexEntry = HistoryIndex['entries'][number]

export const historyIndexFormat: VersionedFormat<typeof historyIndexSchema> = {
  name: HISTORY_INDEX_FILE,
  currentVersion: HISTORY_INDEX_VERSION,
  schema: historyIndexSchema
}
