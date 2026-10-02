/** Any editable request file: HTTP (Phase 2) or WebSocket (Phase 4). */
import { z } from 'zod'
import { ITEM_VERSION } from './collection'
import { httpRequestSchema, type HttpRequest } from './http-request'
import type { VersionedFormat } from './versioned'
import { wsRequestSchema, type WsRequest } from './ws-request'

export const anyRequestSchema = z.discriminatedUnion('type', [httpRequestSchema, wsRequestSchema])
export type AnyRequest = HttpRequest | WsRequest

export const anyRequestFormat: VersionedFormat<typeof anyRequestSchema> = {
  name: 'request file',
  currentVersion: ITEM_VERSION,
  schema: anyRequestSchema
}
