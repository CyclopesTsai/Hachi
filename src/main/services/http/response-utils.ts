import zlib from 'node:zlib'
import { sanitizeFileName } from '@shared/file-names'
import type { ResponseCookie } from '@shared/http'

/** Parses one Set-Cookie header value. Returns null if it has no name=value part. */
export function parseSetCookie(header: string): ResponseCookie | null {
  const [pair, ...attributes] = header.split(';')
  if (!pair) return null
  const eq = pair.indexOf('=')
  if (eq <= 0) return null
  const cookie: ResponseCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    httpOnly: false,
    secure: false
  }
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=')
    const key = (rawKey ?? '').trim().toLowerCase()
    const value = rest.join('=').trim()
    if (key === 'domain') cookie.domain = value
    else if (key === 'path') cookie.path = value
    else if (key === 'expires') cookie.expires = value
    else if (key === 'max-age' && /^-?\d+$/.test(value)) cookie.maxAge = Number(value)
    else if (key === 'httponly') cookie.httpOnly = true
    else if (key === 'secure') cookie.secure = true
    else if (key === 'samesite') cookie.sameSite = value
  }
  return cookie
}

/** Thrown when a decompressed body would exceed the size limit (e.g. a zip bomb). */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Response body is too large')
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Undoes Content-Encoding. Unknown encodings and corrupt data return the input unchanged;
 * output larger than `maxBytes` throws BodyTooLargeError.
 */
export function decompress(
  data: Buffer,
  contentEncoding: string | undefined,
  maxBytes = Number.MAX_SAFE_INTEGER
): Buffer {
  const limit = { maxOutputLength: Math.min(maxBytes, 2 ** 31 - 1) }
  const encodings = (contentEncoding ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '' && e !== 'identity')
  let result = data
  try {
    // Encodings are listed in the order they were applied; undo them in reverse.
    for (const encoding of encodings.reverse()) {
      if (encoding === 'gzip' || encoding === 'x-gzip') result = zlib.gunzipSync(result, limit)
      else if (encoding === 'deflate') result = inflateAny(result, limit)
      else if (encoding === 'br') result = zlib.brotliDecompressSync(result, limit)
      else if (encoding === 'zstd' && typeof zlib.zstdDecompressSync === 'function') {
        result = zlib.zstdDecompressSync(result, limit)
      } else return data
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new BodyTooLargeError()
    }
    return data
  }
  return result
}

/** "deflate" is zlib-wrapped per spec, but some servers send raw deflate. */
function inflateAny(data: Buffer, limit: zlib.ZlibOptions): Buffer {
  try {
    return zlib.inflateSync(data, limit)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw error
    return zlib.inflateRawSync(data, limit)
  }
}

const EXTENSIONS: [RegExp, string][] = [
  [/json/, 'json'],
  [/html/, 'html'],
  [/xml/, 'xml'],
  [/javascript|ecmascript/, 'js'],
  [/css/, 'css'],
  [/csv/, 'csv'],
  [/yaml/, 'yaml'],
  [/^text\//, 'txt'],
  [/png/, 'png'],
  [/jpe?g/, 'jpg'],
  [/gif/, 'gif'],
  [/webp/, 'webp'],
  [/svg/, 'svg'],
  [/pdf/, 'pdf'],
  [/zip/, 'zip']
]

/** Default file name for "download response": last URL path segment, else response.<ext>. */
export function suggestFileName(url: string, contentType: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const ext = EXTENSIONS.find(([re]) => re.test(mime))?.[1] ?? 'bin'
  let segment: string
  try {
    segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
  } catch {
    segment = ''
  }
  segment = sanitizeFileName(segment, '')
  if (segment === '') return `response.${ext}`
  return /\.[a-z0-9]{1,8}$/i.test(segment) ? segment : `${segment}.${ext}`
}

const TEXT_TYPES =
  /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|x-yaml|toml|sql|ld\+json))|\+(json|xml)\b/i

/** True if the body should be shown as text. Without a content type, sniff the bytes. */
export function isTextual(contentType: string, sample: Buffer): boolean {
  const mime = contentType.split(';')[0]?.trim() ?? ''
  if (mime !== '') return TEXT_TYPES.test(mime)
  const head = sample.subarray(0, 4096)
  if (head.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, lastCompleteUtf8(head)))
    return true
  } catch {
    return false
  }
}

/** Length of `bytes` without a trailing partial UTF-8 sequence. */
function lastCompleteUtf8(bytes: Buffer): number {
  const end = bytes.length
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const byte = bytes[end - i] as number
    if ((byte & 0xc0) === 0x80) continue // continuation byte
    const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return needed > i ? end - i : end
  }
  return end
}

/** Decodes text using the charset from the content type (UTF-8 by default). */
export function decodeText(data: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(data)
  } catch {
    return new TextDecoder('utf-8').decode(data)
  }
}
