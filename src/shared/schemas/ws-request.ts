/**
 * Full shape of a WebSocket request file (`type: "websocket"`). See docs/schema.md.
 * Every field has a default, so files written by Phase 1 load unchanged.
 */
import { z } from 'zod'
import { ITEM_VERSION, authSchema, itemNameSchema, keyValueSchema } from './collection'

/** Upper bound for a message typed in the editor or stored as a template. */
export const MAX_WS_MESSAGE_TEXT = 10 * 1024 * 1024

export const WS_MESSAGE_FORMATS = ['text', 'json', 'binary-hex', 'binary-base64'] as const
export type WsMessageFormat = (typeof WS_MESSAGE_FORMATS)[number]

export const wsMessageTemplateSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().max(100).default('Template'),
  format: z.enum(WS_MESSAGE_FORMATS).default('text'),
  content: z.string().max(MAX_WS_MESSAGE_TEXT).default('')
})
export type WsMessageTemplate = z.infer<typeof wsMessageTemplateSchema>

export const HEARTBEAT_MODES = ['ping', 'text'] as const

/** Close codes a client may send: 1000 (normal) or 3000–4999 (application defined). */
export const wsCloseCodeSchema = z
  .number()
  .int()
  .refine((c) => c === 1000 || (c >= 3000 && c <= 4999), 'Close code must be 1000 or 3000–4999')

/** UTF-8 byte length (the close reason is limited to 123 bytes by the protocol). */
const utf8Length = (s: string) => new TextEncoder().encode(s).length

export const wsSettingsSchema = z.looseObject({
  /** Handshake timeout; null = the Workspace timeout. 0 = none. */
  connectTimeoutMs: z.number().int().min(0).max(3_600_000).nullable().default(null),
  /** null = the Workspace setting. */
  validateSSL: z.boolean().nullable().default(null),
  /** Turn off to connect directly even if an app proxy is configured. */
  useProxy: z.boolean().default(true),
  heartbeat: z
    .looseObject({
      enabled: z.boolean().default(false),
      /** "ping": WebSocket ping frame; "text": a text message (`payload`). */
      mode: z.enum(HEARTBEAT_MODES).default('ping'),
      intervalMs: z.number().int().min(1000).max(3_600_000).default(30_000),
      payload: z
        .string()
        .max(64 * 1024)
        .default('')
    })
    .prefault({}),
  /** Sent by 「中斷」. */
  closeCode: wsCloseCodeSchema.default(1000),
  closeReason: z
    .string()
    .default('')
    .refine((r) => utf8Length(r) <= 123, 'Close reason must be at most 123 bytes')
})
export type WsSettings = z.infer<typeof wsSettingsSchema>

export const wsRequestSchema = z.looseObject({
  version: z.literal(ITEM_VERSION),
  id: z.string().min(1),
  type: z.literal('websocket'),
  name: itemNameSchema,
  url: z
    .string()
    .max(64 * 1024)
    .default(''),
  params: z.array(keyValueSchema).default([]),
  headers: z.array(keyValueSchema).default([]),
  /** Sec-WebSocket-Protocol values offered to the server. */
  subprotocols: z.array(z.string().max(200)).max(50).default([]),
  auth: authSchema.default({ type: 'inherit' }),
  settings: wsSettingsSchema.prefault({}),
  messageTemplates: z.array(wsMessageTemplateSchema).max(500).default([])
})
export type WsRequest = z.infer<typeof wsRequestSchema>
