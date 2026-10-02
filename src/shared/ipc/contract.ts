/**
 * Input validation schemas for every invoke channel. Used by the main process
 * before any handler runs (renderer input is never trusted).
 */
import { z } from 'zod'
import { proxySettingsSchema, themeSchema } from '../schemas/app-config'
import {
  REQUEST_TYPES,
  VARIABLES_MAX,
  authSchema,
  itemNameSchema,
  keyValueSchema,
  variableSchema
} from '../schemas/collection'
import { historySettingsSchema } from '../schemas/app-config'
import { sessionDataSchema } from '../schemas/session'
import { httpRequestSchema } from '../schemas/http-request'
import { anyRequestSchema } from '../schemas/request'
import {
  MAX_WS_MESSAGE_TEXT,
  WS_MESSAGE_FORMATS,
  wsCloseCodeSchema,
  wsRequestSchema
} from '../schemas/ws-request'
import { websocketSettingsSchema } from '../schemas/app-config'
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

/** Import files are limited to 50 MB (bytes); a JS string of that file is at most this long. */
const MAX_IMPORT_TEXT = 50 * 1024 * 1024

/** Item ids come from the tree the renderer received; paths are never accepted. */
const itemIdSchema = z.string().min(1).max(1024)

const runIdSchema = z.string().min(1).max(100)

const variablesSchema = z.array(variableSchema).max(VARIABLES_MAX)

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
  [INVOKE.appSetCloseGuard]: z.strictObject({ dirty: z.boolean() }),
  [INVOKE.appConfirmClose]: noInput,
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
      .optional(),
    history: historySettingsSchema.optional(),
    websocket: websocketSettingsSchema.optional()
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
  [INVOKE.workspaceSetScriptTrust]: z.strictObject({ trusted: z.boolean() }),
  [INVOKE.runtimeList]: noInput,
  [INVOKE.runtimeDelete]: z.strictObject({ name: z.string().min(1).max(200) }),
  [INVOKE.runtimeClear]: noInput,
  [INVOKE.dialogSelectDirectory]: z.strictObject({
    title: z.string().max(200).optional(),
    defaultPath: absolutePathSchema.optional()
  }),
  [INVOKE.dialogSelectFile]: z.strictObject({ title: z.string().max(200).optional() }),
  [INVOKE.dialogSaveTextFile]: z.strictObject({
    title: z.string().max(200).optional(),
    defaultName: z.string().min(1).max(200),
    content: z.string().max(512 * 1024 * 1024)
  }),
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
  [INVOKE.requestSave]: z.strictObject({ id: itemIdSchema, request: anyRequestSchema }),
  [INVOKE.requestSaveAs]: z.strictObject({
    parentId: itemIdSchema,
    name: itemNameSchema,
    request: anyRequestSchema
  }),
  [INVOKE.requestGetInherited]: z.strictObject({ parentId: itemIdSchema.nullable() }),
  [INVOKE.containerGet]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.containerSave]: z.strictObject({
    id: itemIdSchema,
    headers: z.array(keyValueSchema).max(1000),
    auth: authSchema,
    variables: variablesSchema
  }),
  [INVOKE.httpSend]: z.strictObject({
    runId: runIdSchema,
    requestId: itemIdSchema.nullable(),
    parentId: itemIdSchema.nullable(),
    environmentId: itemIdSchema.nullable(),
    request: httpRequestSchema,
    skipScripts: z.boolean().optional()
  }),
  [INVOKE.httpCancel]: z.strictObject({ runId: runIdSchema }),
  [INVOKE.httpGetBody]: z.strictObject({ runId: runIdSchema }),
  [INVOKE.httpSaveResponse]: z.strictObject({ runId: runIdSchema }),
  [INVOKE.httpResolve]: z.strictObject({
    parentId: itemIdSchema.nullable(),
    environmentId: itemIdSchema.nullable(),
    request: httpRequestSchema,
    revealSecrets: z.boolean()
  }),
  [INVOKE.transferImportFile]: noInput,
  [INVOKE.transferImportText]: z.strictObject({
    fileName: z.string().max(1000),
    text: z.string().max(MAX_IMPORT_TEXT)
  }),
  [INVOKE.transferExportPostman]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.envList]: noInput,
  [INVOKE.envGet]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.envCreate]: z.strictObject({ name: itemNameSchema }),
  [INVOKE.envSave]: z.strictObject({
    id: itemIdSchema,
    name: itemNameSchema,
    variables: variablesSchema
  }),
  [INVOKE.envDuplicate]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.envDelete]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.historyList]: noInput,
  [INVOKE.historyDelete]: z.strictObject({ id: itemIdSchema }),
  [INVOKE.historyClear]: noInput,
  [INVOKE.historyGetUsage]: noInput,
  [INVOKE.sessionGet]: noInput,
  [INVOKE.sessionSave]: sessionDataSchema,
  [INVOKE.wsConnect]: z.strictObject({
    connectionId: runIdSchema,
    requestId: itemIdSchema.nullable(),
    parentId: itemIdSchema.nullable(),
    environmentId: itemIdSchema.nullable(),
    request: wsRequestSchema
  }),
  [INVOKE.wsSend]: z.strictObject({
    connectionId: runIdSchema,
    parentId: itemIdSchema.nullable(),
    environmentId: itemIdSchema.nullable(),
    format: z.enum(WS_MESSAGE_FORMATS),
    content: z.string().max(MAX_WS_MESSAGE_TEXT)
  }),
  [INVOKE.wsPing]: z.strictObject({ connectionId: runIdSchema }),
  [INVOKE.wsDisconnect]: z.strictObject({
    connectionId: runIdSchema,
    code: wsCloseCodeSchema.optional(),
    reason: z.string().max(123).optional()
  })
} as const satisfies Record<InvokeChannel, z.ZodType>

export type InputOf<C extends InvokeChannel> = z.output<(typeof inputSchemas)[C]>

// Compile-time guarantee that each validated input satisfies the declared API input type.
type InputsMatch = {
  [C in InvokeChannel]: InputOf<C> extends InvokeMap[C]['input'] ? true : never
}
export const inputSchemasMatchApi: InputsMatch[InvokeChannel] = true
