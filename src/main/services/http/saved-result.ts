/**
 * Saved results (decision 140): what a send keeps for "儲存結果", and how it becomes an
 * example file. Nothing secret is written: values of secret variables go back to
 * `{{name}}` wherever they appear (request and response), and credential headers
 * (Authorization, Cookie, Set-Cookie…) are hidden, since tokens, Basic auth and
 * signatures derived from secrets never contain the secret itself.
 */
import {
  CREDENTIAL_REQUEST_HEADERS,
  CREDENTIAL_RESPONSE_HEADERS,
  EXAMPLE_BODY_MAX_BYTES,
  type ExampleSentBody
} from '@shared/schemas/example'
import type { ResponseHttpVersion } from '@shared/http'
import type { HttpRequest } from '@shared/schemas/http-request'
import type { PortableExample } from '@shared/transfer/portable'
import type { VariableMap } from '@shared/variables'
import { decodeText, isTextual } from './response-utils'
import { msg } from '@shared/i18n'

/** Shorter secret values are not searched for (they would match all over the place). */
export const SECRET_MIN_LENGTH = 4

export interface SecretValue {
  name: string
  value: string
}

/** One send, as kept with its response body for "儲存結果". */
export interface Exchange {
  /** The request as written ({{variables}} kept). */
  source: HttpRequest
  method: string
  url: string
  /** Headers actually sent (cookies from the jar included). */
  headers: [string, string][]
  body: ExampleSentBody
  response: {
    status: number
    statusText: string
    headers: [string, string][]
    contentType: string
    timeMs: number
    httpVersion: ResponseHttpVersion
  }
  secrets: SecretValue[]
}

/** Values of the secret variables in use: as written and with nested variables expanded. */
export function secretValues(map: VariableMap, expand: (text: string) => string): SecretValue[] {
  const out: SecretValue[] = []
  for (const variable of map.values()) {
    if (!variable.secret) continue
    for (const value of new Set([variable.value, expand(variable.value)])) {
      if (value.length >= SECRET_MIN_LENGTH) out.push({ name: variable.name, value })
    }
  }
  // Longest first, so a secret that contains another one is replaced whole.
  return out.sort((a, b) => b.value.length - a.value.length)
}

/** `text` with every secret value (also URL-encoded) put back as `{{name}}`. */
export function maskSecrets(text: string, secrets: readonly SecretValue[]): string {
  let out = text
  for (const { name, value } of secrets) {
    out = out.split(value).join(`{{${name}}}`)
    const encoded = encodeURIComponent(value)
    if (encoded !== value) out = out.split(encoded).join(`{{${name}}}`)
  }
  return out
}

function maskHeaders(
  headers: readonly [string, string][],
  credentials: readonly string[],
  secrets: readonly SecretValue[]
): [string, string][] {
  return headers.map(([key, value]) => [
    key,
    // Stands in for credential header values, in the language at save time (issue #6).
    credentials.includes(key.toLowerCase()) ? msg().httpMain.hidden : maskSecrets(value, secrets)
  ])
}

/** The sent body as an example records it (files by name). */
export function sentBodyOf(body: string | FormData | null): ExampleSentBody {
  if (body === null) return { kind: 'none', text: '', fields: [] }
  if (typeof body === 'string') return { kind: 'text', text: body, fields: [] }
  const fields: ExampleSentBody['fields'] = []
  for (const [name, value] of body.entries()) {
    fields.push(
      typeof value === 'string'
        ? { name, value, file: false }
        : { name, value: (value as File).name || 'file', file: true }
    )
  }
  return { kind: 'form', text: '', fields }
}

export class SavedResultError extends Error {}

/** The example file content for a send and its (decoded) response body. */
export function exampleFromExchange(
  exchange: Exchange,
  body: Buffer,
  name: string,
  savedAt: string
): PortableExample {
  if (body.length > EXAMPLE_BODY_MAX_BYTES) {
    throw new SavedResultError(
      msg().httpMain.saveResult.tooLarge(EXAMPLE_BODY_MAX_BYTES / 1024 / 1024)
    )
  }
  const { secrets, response } = exchange
  const text = isTextual(response.contentType, body)
  const sentBody: ExampleSentBody = {
    kind: exchange.body.kind,
    text: maskSecrets(exchange.body.text, secrets),
    fields: exchange.body.fields.map((f) =>
      f.file ? f : { ...f, value: maskSecrets(f.value, secrets) }
    )
  }
  return {
    name,
    savedAt,
    request: exchange.source,
    sent: {
      method: exchange.method,
      url: maskSecrets(exchange.url, secrets),
      headers: maskHeaders(exchange.headers, CREDENTIAL_REQUEST_HEADERS, secrets),
      body: sentBody
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: maskHeaders(response.headers, CREDENTIAL_RESPONSE_HEADERS, secrets),
      contentType: response.contentType,
      body: text
        ? { encoding: 'text', data: maskSecrets(decodeText(body, response.contentType), secrets) }
        : { encoding: 'base64', data: body.toString('base64') },
      bodyBytes: body.length,
      timeMs: Math.round(response.timeMs),
      httpVersion: response.httpVersion
    }
  }
}
