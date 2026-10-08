/**
 * Full shape of an HTTP request file (`type: "http"`). See docs/schema.md.
 * Every field has a default, so files written by Phase 1 load unchanged.
 */
import { z } from 'zod'
import {
  HTTP_METHODS,
  ITEM_VERSION,
  MAX_SCRIPT_TEXT,
  authSchema,
  itemNameSchema,
  keyValueSchema,
  requestScriptsSchema
} from './collection'

/** Upper bound for text bodies sent from the editor (bytes of UTF-16 text, roughly). */
export const MAX_BODY_TEXT = 50 * 1024 * 1024

export const BODY_MODES = ['none', 'json', 'raw', 'formData', 'urlencoded'] as const
export type BodyMode = (typeof BODY_MODES)[number]

/** Content types offered for "Raw" bodies; any other string is accepted too. */
export const RAW_CONTENT_TYPES = [
  'text/plain',
  'application/xml',
  'text/xml',
  'text/html',
  'application/javascript',
  'text/csv'
] as const

export const formDataFieldSchema = z.looseObject({
  id: z.string(),
  key: z.string(),
  enabled: z.boolean().default(true),
  type: z.enum(['text', 'file']).default('text'),
  /** Value of a text field. */
  value: z.string().default(''),
  /** Absolute path of a file field. Machine-specific: may not exist on another computer. */
  filePath: z.string().default(''),
  description: z.string().optional()
})
export type FormDataField = z.infer<typeof formDataFieldSchema>

export const httpBodySchema = z.looseObject({
  mode: z.enum(BODY_MODES).default('none'),
  /** Each mode keeps its own content, so switching modes loses nothing. */
  json: z.string().max(MAX_BODY_TEXT).default(''),
  raw: z.string().max(MAX_BODY_TEXT).default(''),
  rawContentType: z.string().max(200).default('text/plain'),
  formData: z.array(formDataFieldSchema).default([]),
  urlencoded: z.array(keyValueSchema).default([])
})
export type HttpBody = z.infer<typeof httpBodySchema>

/** Per-request overrides; `null` = use the Workspace setting. */
export const httpRequestSettingsSchema = z.looseObject({
  timeoutMs: z.number().int().min(0).max(3_600_000).nullable().default(null),
  validateSSL: z.boolean().nullable().default(null),
  followRedirects: z.boolean().nullable().default(null),
  /** Turn off to send this request directly even if an app proxy is configured. */
  useProxy: z.boolean().default(true)
})
export type HttpRequestSettings = z.infer<typeof httpRequestSettingsSchema>

// Scripts live in collection.ts (collections / folders have them too, decision 126).
export { MAX_SCRIPT_TEXT, requestScriptsSchema, type RequestScripts } from './collection'

/** Rows of the assertion table (decision 73). Evaluated after the Post-response script. */
export const ASSERTION_TARGETS = ['status', 'responseTime', 'header', 'jsonBody', 'body'] as const
export type AssertionTarget = (typeof ASSERTION_TARGETS)[number]

export const ASSERTION_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'notContains',
  'exists',
  'notExists',
  'gt',
  'gte',
  'lt',
  'lte',
  'matches',
  'isType'
] as const
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number]

export const ROWS_MAX = 500

export const assertionSchema = z.looseObject({
  id: z.string(),
  enabled: z.boolean().default(true),
  target: z.enum(ASSERTION_TARGETS).default('status'),
  /** Header name, JSON path (`data.items[0].id`) — unused for status / responseTime / body. */
  path: z.string().max(1000).default(''),
  operator: z.enum(ASSERTION_OPERATORS).default('eq'),
  /** May contain `{{variables}}`; resolved when the assertion runs. */
  expected: z.string().max(100_000).default('')
})
export type Assertion = z.infer<typeof assertionSchema>

/** Rows of "從回應擷取變數" (decision 73 / 81). Run before the Post-response script. */
export const EXTRACTION_SOURCES = ['jsonBody', 'header', 'status', 'body'] as const
export type ExtractionSource = (typeof EXTRACTION_SOURCES)[number]
export const EXTRACTION_SCOPES = ['runtime', 'environment'] as const
export type ExtractionScope = (typeof EXTRACTION_SCOPES)[number]

export const extractionSchema = z.looseObject({
  id: z.string(),
  enabled: z.boolean().default(true),
  source: z.enum(EXTRACTION_SOURCES).default('jsonBody'),
  /** JSON path, header name, or for `body` an optional regex (first group, or the match). */
  path: z.string().max(1000).default(''),
  variable: z.string().max(200).default(''),
  scope: z.enum(EXTRACTION_SCOPES).default('runtime')
})
export type Extraction = z.infer<typeof extractionSchema>

export const httpMethodSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  z.enum(HTTP_METHODS)
)

export const httpRequestSchema = z.looseObject({
  version: z.literal(ITEM_VERSION),
  id: z.string().min(1),
  type: z.literal('http'),
  name: itemNameSchema,
  method: httpMethodSchema.default('GET'),
  url: z
    .string()
    .max(64 * 1024)
    .default(''),
  params: z.array(keyValueSchema).default([]),
  headers: z.array(keyValueSchema).default([]),
  body: httpBodySchema.prefault({}),
  auth: authSchema.default({ type: 'inherit' }),
  settings: httpRequestSettingsSchema.prefault({}),
  scripts: requestScriptsSchema.prefault({}),
  assertions: z.array(assertionSchema).max(ROWS_MAX).default([]),
  extractions: z.array(extractionSchema).max(ROWS_MAX).default([]),
  /** Markdown notes (e.g. Bruno `docs`); used as the description in OpenAPI exports. */
  docs: z.string().max(MAX_SCRIPT_TEXT).default('')
})
export type HttpRequest = z.infer<typeof httpRequestSchema>
