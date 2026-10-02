/**
 * Input validation schemas for every invoke channel. Used by the main process
 * before any handler runs (renderer input is never trusted).
 */
import { z } from 'zod'
import { proxySettingsSchema, themeSchema } from '../schemas/app-config'
import { REQUEST_TYPES, authSchema, itemNameSchema, keyValueSchema } from '../schemas/collection'
import { httpRequestSchema } from '../schemas/http-request'
import { workspaceNameSchema, workspaceSettingsSchema } from '../schemas/workspace'
import type { InvokeMap } from './api'
import { INVOKE, type InvokeChannel } from './channels'

const MAX_PATH_LENGTH = 4096

/** Absolute path in either POSIX or Windows form. Resolution happens in main. */
export const absolutePathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((p) => !p.includes('\0'), 'Path must not contain NUL characters')
  .refine(
    (p) => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\'),
    'Path must be absolute'
  )

const noInput = z.undefined()

/** Item ids come from the tree the renderer received; paths are never accepted. */
const itemIdSchema = z.string().min(1).max(1024)

const runIdSchema = z.string().min(1).max(100)

const itemCreateSchema = z
  .strictObject({
    parentId: itemIdSchema.nullable(),
    kind: z.enum(['collection', 'folder', 'request']),
    name: itemNameSchema,
    requestType: z.enum(REQUEST_TYPES).optional()
  })
  .refine((v) => v.kind !== 'request' || v.requestType !== undefined, {
    message: 'requestType is required for requests',
    path: ['requestType']
  })

export const inputSchemas = {
  [INVOKE.appGetInfo]: noInput,
  [INVOKE.appGetDefaultWorkspaceDir]: noInput,
  [INVOKE.configGet]: noInput,
  [INVOKE.configUpdate]: z.strictObject({
    theme: themeSchema.optional(),
    proxy: proxySettingsSchema.optional(),
    // Not uiSettingsSchema.partial(): its defaults would reset the keys left out.
    ui: z
      .strictObject({
        requestBodyWrap: z.boolean().optional(),
        responseBodyWrap: z.boolean().optional()
      })
      .optional()
  }),
  [INVOKE.workspaceGetCurrent]: noInput,
  [INVOKE.workspaceCreate]: z.strictObject({
    name: workspaceNameSchema,
    parentDir: absolutePathSchema
  }),
  [INVOKE.workspaceOpen]: z.strictObject({ path: absolutePathSchema }),
  [INVOKE.workspaceOpenWithDialog]: noInput,
  [INVOKE.workspaceListRecent]: noInput,
  [INVOKE.workspaceRemoveRecent]: z.strictObject({ path: absolutePathSchema }),
  [INVOKE.workspaceRename]: z.strictObject({ name: workspaceNameSchema }),
  [INVOKE.workspaceDelete]: z.strictObject({ path: absolutePathSchema }),
  [INVOKE.workspaceGetSettings]: noInput,
  [INVOKE.workspaceSaveSettings]: workspaceSettingsSchema,
  [INVOKE.dialogSelectDirectory]: z.strictObject({
    title: z.string().max(200).optional(),
    defaultPath: absolutePathSchema.optional()
  }),
  [INVOKE.dialogSelectFile]: z.strictObject({ title: z.string().max(200).optional() }),
  [INVOKE.treeGet]: noInput,
  [INVOKE.treeReload]: z.discriminatedUnion('scope', [
    z.strictObject({ scope: z.literal('workspace') }),
    z.strictObject({ scope: z.literal('item'), id: itemIdSchema })
  ]),
  [INVOKE.itemCreate]: itemCreateSchema,
  [INVOKE.itemRename]: z.strictObject({ id: itemIdSchema, name: itemNameSchema }),
  [INVOKE.itemDuplicate]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.itemDelete]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.itemMove]: z.strictObject({
    id: itemIdSchema,
    parentId: itemIdSchema.nullable(),
    index: z.number().int().min(0).max(1_000_000)
  }),
  [INVOKE.requestGet]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.requestSave]: z.strictObject({ id: itemIdSchema, request: httpRequestSchema }),
  [INVOKE.containerGet]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.containerSave]: z.strictObject({
    id: itemIdSchema,
    headers: z.array(keyValueSchema).max(1000),
    auth: authSchema
  }),
  [INVOKE.httpSend]: z.strictObject({
    runId: runIdSchema,
    requestId: itemIdSchema,
    request: httpRequestSchema
  }),
  [INVOKE.httpCancel]: z.strictObject({ runId: runIdSchema }),
  [INVOKE.httpGetBody]: z.strictObject({ runId: runIdSchema }),
  [INVOKE.httpSaveResponse]: z.strictObject({ runId: runIdSchema })
} as const satisfies Record<InvokeChannel, z.ZodType>

export type InputOf<C extends InvokeChannel> = z.output<(typeof inputSchemas)[C]>

// Compile-time guarantee that each validated input satisfies the declared API input type.
type InputsMatch = {
  [C in InvokeChannel]: InputOf<C> extends InvokeMap[C]['input'] ? true : never
}
export const inputSchemasMatchApi: InputsMatch[InvokeChannel] = true
