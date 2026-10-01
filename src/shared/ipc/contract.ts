/**
 * Input validation schemas for every invoke channel. Used by the main process
 * before any handler runs (renderer input is never trusted).
 */
import { z } from 'zod'
import { themeSchema } from '../schemas/app-config'
import { workspaceNameSchema } from '../schemas/workspace'
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

export const inputSchemas = {
  [INVOKE.appGetInfo]: noInput,
  [INVOKE.appGetDefaultWorkspaceDir]: noInput,
  [INVOKE.configGet]: noInput,
  [INVOKE.configUpdate]: z.strictObject({ theme: themeSchema.optional() }),
  [INVOKE.workspaceGetCurrent]: noInput,
  [INVOKE.workspaceCreate]: z.strictObject({
    name: workspaceNameSchema,
    parentDir: absolutePathSchema
  }),
  [INVOKE.workspaceOpen]: z.strictObject({ path: absolutePathSchema }),
  [INVOKE.workspaceOpenWithDialog]: noInput,
  [INVOKE.workspaceListRecent]: noInput,
  [INVOKE.workspaceRemoveRecent]: z.strictObject({ path: absolutePathSchema }),
  [INVOKE.dialogSelectDirectory]: z.strictObject({
    title: z.string().max(200).optional(),
    defaultPath: absolutePathSchema.optional()
  })
} as const satisfies Record<InvokeChannel, z.ZodType>

export type InputOf<C extends InvokeChannel> = z.output<(typeof inputSchemas)[C]>

// Compile-time guarantee that each validated input satisfies the declared API input type.
type InputsMatch = {
  [C in InvokeChannel]: InputOf<C> extends InvokeMap[C]['input'] ? true : never
}
export const inputSchemasMatchApi: InputsMatch[InvokeChannel] = true
