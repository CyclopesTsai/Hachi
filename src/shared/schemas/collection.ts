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

/**
 * A Collection or Environment variable. The value of a `secret` variable is never
 * written to the item file (it is stored in `.hachi-secrets.json`, see docs/schema.md).
 */
export const variableSchema = keyValueSchema.extend({
  secret: z.boolean().default(false)
})
export type Variable = z.infer<typeof variableSchema>

export const VARIABLES_MAX = 1000

export const OAUTH2_GRANTS = ['client_credentials', 'password', 'authorization_code'] as const
export type OAuth2Grant = (typeof OAUTH2_GRANTS)[number]

export const oauth2AuthSchema = z.looseObject({
  type: z.literal('oauth2'),
  grantType: z.enum(OAUTH2_GRANTS).default('client_credentials'),
  accessTokenUrl: z.string().default(''),
  /** Authorization code only. */
  authUrl: z.string().default(''),
  /** Authorization code only; empty = http://127.0.0.1:<free port>/callback. */
  callbackUrl: z.string().default(''),
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  scope: z.string().default(''),
  /** Password grant only. */
  username: z.string().default(''),
  password: z.string().default(''),
  /** Authorization code only (decision 128: on by default). */
  pkce: z.boolean().default(true),
  /** How the client id / secret go to the token URL. */
  clientAuth: z.enum(['header', 'body']).default('header'),
  /** Prefix of the Authorization header ("Bearer"). */
  headerPrefix: z.string().default('Bearer')
})

/** Auth settings; `inherit` uses the parent folder / collection. */
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
  }),
  // Decision 128.
  z.looseObject({
    type: z.literal('digest'),
    username: z.string().default(''),
    password: z.string().default('')
  }),
  z.looseObject({
    type: z.literal('awsSigV4'),
    accessKeyId: z.string().default(''),
    secretAccessKey: z.string().default(''),
    /** Temporary credentials only. */
    sessionToken: z.string().default(''),
    region: z.string().default(''),
    service: z.string().default('')
  }),
  oauth2AuthSchema
])
export type Auth = z.infer<typeof authSchema>
export type OAuth2Auth = z.infer<typeof oauth2AuthSchema>
export type AwsSigV4Auth = Extract<Auth, { type: 'awsSigV4' }>

/** Upper bound for one script (bytes of UTF-16 text, roughly). */
export const MAX_SCRIPT_TEXT = 1024 * 1024

/**
 * Pre-request / Post-response scripts (JavaScript, run in a QuickJS sandbox — decision 70).
 * Requests, collections and folders (decision 126) have them.
 */
export const requestScriptsSchema = z.looseObject({
  preRequest: z.string().max(MAX_SCRIPT_TEXT).default(''),
  postResponse: z.string().max(MAX_SCRIPT_TEXT).default('')
})
export type RequestScripts = z.infer<typeof requestScriptsSchema>

/**
 * Order of collection / folder / request scripts (decision 126). sequential: collection →
 * folders → request for both phases (Postman); sandwich: post-response from the request
 * outwards (Bruno).
 */
export const SCRIPT_FLOWS = ['sequential', 'sandwich'] as const
export type ScriptFlow = (typeof SCRIPT_FLOWS)[number]

const containerFields = {
  version: z.literal(ITEM_VERSION),
  id: z.string().min(1),
  name: itemNameSchema,
  headers: z.array(keyValueSchema).default([]),
  scripts: requestScriptsSchema.prefault({}),
  /** Child item ids in display order. */
  order: z.array(z.string()).default([])
}

export const collectionFileSchema = z.looseObject({
  ...containerFields,
  auth: authSchema.default({ type: 'none' }),
  variables: z.array(variableSchema).default([]),
  scriptFlow: z.enum(SCRIPT_FLOWS).default('sequential')
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
      connectTimeoutMs: null,
      validateSSL: null,
      useProxy: true,
      heartbeat: { enabled: false, mode: 'ping', intervalMs: 30000, payload: '' },
      closeCode: 1000,
      closeReason: ''
    },
    messageTemplates: []
  }
}
