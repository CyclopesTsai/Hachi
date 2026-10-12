import { z } from 'zod'
import { HTTP_METHODS, itemNameSchema, keyValueSchema } from './collection'
import type { VersionedFormat } from './versioned'

/**
 * Mock Server (decision 133): `<workspace>/mocks/<name>.json`. Routes answer with fixed
 * content (nothing is substituted); WebSocket endpoints send messages on connect, reply
 * to matching messages and push on a timer.
 */
export const MOCK_VERSION = 1
export const MOCKS_DIR = 'mocks'
export const MOCK_DEFAULT_PORT = 4010
export const MOCK_ROWS_MAX = 500
export const MOCK_BODY_MAX = 10 * 1024 * 1024
export const MOCK_DELAY_MAX_MS = 60_000
export const MOCK_INTERVAL_MIN_MS = 100
export const MOCK_INTERVAL_MAX_MS = 3_600_000

export const MOCK_METHODS = ['ANY', ...HTTP_METHODS] as const
export type MockMethod = (typeof MOCK_METHODS)[number]

const id = z.string().min(1).max(100)
const text = z.string().max(MOCK_BODY_MAX).default('')

export const mockRouteSchema = z.looseObject({
  id,
  enabled: z.boolean().default(true),
  method: z.enum(MOCK_METHODS).default('GET'),
  /** `/users/:id` (one segment), `/files/*` (the rest); the query string is ignored. */
  path: z.string().max(2000).default('/'),
  status: z.number().int().min(100).max(599).default(200),
  headers: z.array(keyValueSchema).max(MOCK_ROWS_MAX).default([]),
  body: text,
  delayMs: z.number().int().min(0).max(MOCK_DELAY_MAX_MS).default(0),
  /** Free text (e.g. the request it came from). */
  description: z.string().max(1000).default('')
})
export type MockRoute = z.infer<typeof mockRouteSchema>

export const WS_MATCH_MODES = ['contains', 'equals', 'regex'] as const
export type WsMatchMode = (typeof WS_MATCH_MODES)[number]

export const mockWsMessageSchema = z.looseObject({
  id,
  enabled: z.boolean().default(true),
  message: text
})
export const mockWsRuleSchema = z.looseObject({
  id,
  enabled: z.boolean().default(true),
  match: z.enum(WS_MATCH_MODES).default('contains'),
  pattern: z.string().max(10_000).default(''),
  reply: text
})
export const mockWsIntervalSchema = z.looseObject({
  id,
  enabled: z.boolean().default(true),
  everyMs: z.number().int().min(MOCK_INTERVAL_MIN_MS).max(MOCK_INTERVAL_MAX_MS).default(5000),
  message: text
})

export const mockWsEndpointSchema = z.looseObject({
  id,
  enabled: z.boolean().default(true),
  /** Exact path, or `/prefix/*`. */
  path: z.string().max(2000).default('/ws'),
  onConnect: z.array(mockWsMessageSchema).max(MOCK_ROWS_MAX).default([]),
  /** The first enabled rule that matches replies. */
  rules: z.array(mockWsRuleSchema).max(MOCK_ROWS_MAX).default([]),
  intervals: z.array(mockWsIntervalSchema).max(MOCK_ROWS_MAX).default([])
})
export type MockWsEndpoint = z.infer<typeof mockWsEndpointSchema>

/** What the editor changes (everything except identity). */
export const mockSettingsSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(MOCK_DEFAULT_PORT),
  /** false: 127.0.0.1 only; true: every network interface (other devices can connect). */
  lan: z.boolean().default(false),
  /** Allow any origin and answer preflight requests. */
  cors: z.boolean().default(true),
  routes: z.array(mockRouteSchema).max(MOCK_ROWS_MAX).default([]),
  websockets: z.array(mockWsEndpointSchema).max(MOCK_ROWS_MAX).default([])
})
export type MockSettings = z.infer<typeof mockSettingsSchema>

export const mockFileSchema = mockSettingsSchema.extend({
  version: z.literal(MOCK_VERSION),
  id: z.string().min(1),
  name: itemNameSchema
})
export type MockFile = z.infer<typeof mockFileSchema>

export const mockFormat: VersionedFormat<typeof mockFileSchema> = {
  name: 'mock.json',
  currentVersion: MOCK_VERSION,
  schema: mockFileSchema
}
