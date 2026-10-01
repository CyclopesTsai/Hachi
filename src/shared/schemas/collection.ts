/**
 * Schemas for files inside `<workspace>/collections/`. See docs/schema.md.
 *
 * All item files use `looseObject`: fields this build does not know (added by a
 * newer Hachi, or by a later Phase) are preserved when the file is rewritten.
 */
import { z } from 'zod'
import type { VersionedFormat } from './versioned'

export const ITEM_VERSION = 1
export const COLLECTION_FILE = 'collection.json'
export const FOLDER_FILE = 'folder.json'
/** File names that can never be used by a request file. */
export const RESERVED_FILE_NAMES = [COLLECTION_FILE, FOLDER_FILE] as const
export const ITEM_NAME_MAX = 100

export const itemNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(ITEM_NAME_MAX, `Name must be at most ${ITEM_NAME_MAX} characters`)

/** A row of Query Params / Headers / form fields / variables. */
export const keyValueSchema = z.looseObject({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().optional()
})
export type KeyValue = z.infer<typeof keyValueSchema>

/** Auth settings. Editing UI arrives in Phase 2; `inherit` uses the parent folder / collection. */
export const authSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('inherit') }),
  z.looseObject({ type: z.literal('none') }),
  z.looseObject({ type: z.literal('bearer'), token: z.string().default('') }),
  z.looseObject({
    type: z.literal('basic'),
    username: z.string().default(''),
    password: z.string().default('')
  }),
  z.looseObject({
    type: z.literal('apiKey'),
    key: z.string().default(''),
    value: z.string().default(''),
    in: z.enum(['header', 'query']).default('header')
  })
])
export type Auth = z.infer<typeof authSchema>

const containerFields = {
  version: z.literal(ITEM_VERSION),
  id: z.string().min(1),
  name: itemNameSchema,
  headers: z.array(keyValueSchema).default([]),
  /** Child item ids in display order. */
  order: z.array(z.string()).default([])
}

export const collectionFileSchema = z.looseObject({
  ...containerFields,
  auth: authSchema.default({ type: 'none' }),
  variables: z.array(keyValueSchema).default([])
})
export type CollectionFile = z.infer<typeof collectionFileSchema>

export const folderFileSchema = z.looseObject({
  ...containerFields,
  auth: authSchema.default({ type: 'inherit' })
})
export type FolderFile = z.infer<typeof folderFileSchema>

export const REQUEST_TYPES = ['http', 'websocket'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/**
 * Request files: only the fields the tree needs are validated here. The full
 * HTTP (Phase 2) and WebSocket (Phase 4) shapes are validated by their editors.
 */
export const requestFileSchema = z.looseObject({
  version: z.literal(ITEM_VERSION),
  id: z.string().min(1),
  type: z.enum(REQUEST_TYPES),
  name: itemNameSchema,
  method: z.string().optional()
})
export type RequestFile = z.infer<typeof requestFileSchema>

export const collectionFormat: VersionedFormat<typeof collectionFileSchema> = {
  name: COLLECTION_FILE,
  currentVersion: ITEM_VERSION,
  schema: collectionFileSchema
}
export const folderFormat: VersionedFormat<typeof folderFileSchema> = {
  name: FOLDER_FILE,
  currentVersion: ITEM_VERSION,
  schema: folderFileSchema
}
export const requestFormat: VersionedFormat<typeof requestFileSchema> = {
  name: 'request file',
  currentVersion: ITEM_VERSION,
  schema: requestFileSchema
}

export function newCollectionFile(id: string, name: string): CollectionFile {
  return collectionFileSchema.parse({ version: ITEM_VERSION, id, name })
}

export function newFolderFile(id: string, name: string): FolderFile {
  return folderFileSchema.parse({ version: ITEM_VERSION, id, name })
}

/** Default content of a new request. Later Phases add fields with defaults (no version bump). */
export function newRequestFile(
  id: string,
  name: string,
  type: RequestType
): Record<string, unknown> {
  if (type === 'http') {
    return {
      version: ITEM_VERSION,
      id,
      type,
      name,
      method: 'GET',
      url: '',
      params: [],
      headers: [],
      body: { mode: 'none' },
      auth: { type: 'inherit' },
      settings: { timeoutMs: null, validateSSL: null }
    }
  }
  return {
    version: ITEM_VERSION,
    id,
    type,
    name,
    url: '',
    params: [],
    headers: [],
    subprotocols: [],
    auth: { type: 'inherit' },
    settings: {
      autoReconnect: false,
      reconnectIntervalMs: 3000,
      heartbeat: { enabled: false, intervalMs: 30000, payload: '' }
    },
    messageTemplates: []
  }
}
