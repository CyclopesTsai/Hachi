import { z } from 'zod'
import { itemNameSchema } from './collection'
import { httpRequestSchema } from './http-request'
import type { VersionedFormat } from './versioned'

/**
 * Saved results ("examples", decision 140): a request and the response it got, kept
 * read-only next to the request as `<request>.examples/<name>.json` (one file each, so
 * they merge well in git). Secret variable values are put back as `{{name}}` and
 * credential headers are hidden before anything is written.
 */
export const EXAMPLE_VERSION = 1
/** `get-users.json` keeps its examples in the folder `get-users.examples/`. */
export const EXAMPLES_DIR_SUFFIX = '.examples'
/** Response bodies above this (decoded size) cannot be saved. */
export const EXAMPLE_BODY_MAX_BYTES = 1024 * 1024
/** Stands in for credential header values. */
export const HIDDEN_VALUE = '（已隱藏）'
/** Header values that carry credentials (OAuth tokens, signatures, Basic, cookies): never saved. */
export const CREDENTIAL_REQUEST_HEADERS = ['authorization', 'proxy-authorization', 'cookie']
export const CREDENTIAL_RESPONSE_HEADERS = ['set-cookie']

const headerSchema = z.tuple([z.string(), z.string()])

export const exampleSentBodySchema = z.looseObject({
  kind: z.enum(['none', 'text', 'form']).default('none'),
  /** JSON / raw / urlencoded bodies as sent. */
  text: z.string().default(''),
  /** form-data fields; files appear as their file name. */
  fields: z
    .array(
      z.looseObject({
        name: z.string(),
        value: z.string().default(''),
        file: z.boolean().default(false)
      })
    )
    .default([])
})
export type ExampleSentBody = z.infer<typeof exampleSentBodySchema>

/** What was actually sent: variables resolved, secrets and credentials hidden. */
export const exampleSentSchema = z.looseObject({
  method: z.string().default('GET'),
  url: z.string().default(''),
  headers: z.array(headerSchema).default([]),
  body: exampleSentBodySchema.prefault({})
})
export type ExampleSent = z.infer<typeof exampleSentSchema>

export const exampleResponseSchema = z.looseObject({
  status: z.number().int().min(0).max(999).default(200),
  statusText: z.string().default(''),
  headers: z.array(headerSchema).default([]),
  contentType: z.string().default(''),
  body: z
    .looseObject({
      /** base64 for bodies that are not text (images…). */
      encoding: z.enum(['text', 'base64']).default('text'),
      data: z
        .string()
        .max(EXAMPLE_BODY_MAX_BYTES * 2)
        .default('')
    })
    .prefault({}),
  /** Decoded body size in bytes. */
  bodyBytes: z.number().int().min(0).default(0),
  timeMs: z.number().min(0).default(0)
})
export type ExampleResponse = z.infer<typeof exampleResponseSchema>

export const exampleFileSchema = z.looseObject({
  version: z.literal(EXAMPLE_VERSION),
  id: z.string().min(1),
  name: itemNameSchema,
  /** ISO time; empty for imported examples. */
  savedAt: z.string().default(''),
  /** The request as written in the editor ({{variables}} kept). */
  request: httpRequestSchema,
  /** Null for imported examples (Postman / Bruno keep only the request as written). */
  sent: exampleSentSchema.nullable().default(null),
  response: exampleResponseSchema.prefault({})
})
export type ExampleFile = z.infer<typeof exampleFileSchema>

export const exampleFormat: VersionedFormat<typeof exampleFileSchema> = {
  name: 'example',
  currentVersion: EXAMPLE_VERSION,
  schema: exampleFileSchema
}

/** Folder of a request file's examples: `a/get-users.json` → `a/get-users.examples`. */
export function examplesDirOf(requestFile: string): string {
  return requestFile.replace(/\.json$/i, '') + EXAMPLES_DIR_SUFFIX
}
