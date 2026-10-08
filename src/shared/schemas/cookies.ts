import { z } from 'zod'
import type { VersionedFormat } from './versioned'

/**
 * A Workspace's cookie jar (decision 129), stored on this computer only at
 * `<userData>/cookies/<workspace id>.json` (not in the Workspace folder / git).
 */
export const COOKIES_VERSION = 1
export const COOKIES_DIR = 'cookies'
/** Upper bounds: the jar drops the oldest cookies beyond them. */
export const COOKIES_MAX = 3000
export const COOKIES_MAX_PER_DOMAIN = 180
export const COOKIE_MAX_BYTES = 4096

export const storedCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  /** Lowercase, without a leading dot. */
  domain: z.string(),
  /** No Domain attribute: sent to this exact host only. */
  hostOnly: z.boolean(),
  path: z.string(),
  /** ms since epoch; null = session cookie (kept until deleted, as Postman). */
  expires: z.number().nullable(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.string().nullable(),
  createdAt: z.number()
})
export type StoredCookie = z.infer<typeof storedCookieSchema>

export const cookiesFileSchema = z.object({
  version: z.literal(COOKIES_VERSION),
  cookies: z.array(storedCookieSchema).max(COOKIES_MAX)
})

export const cookiesFormat: VersionedFormat<typeof cookiesFileSchema> = {
  name: 'cookies.json',
  currentVersion: COOKIES_VERSION,
  schema: cookiesFileSchema
}
