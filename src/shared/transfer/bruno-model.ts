/**
 * Bruno's in-memory collection shape (the same as Bruno's exported JSON). Every Bruno
 * source (`.bru` files, OpenCollection `.yml` files, exported JSON) is read into it, and
 * exports are built from it, so the mapping to Hachi (bruno.ts) exists once.
 */

export interface BrunoPair {
  name: string
  value: string
  enabled: boolean
}

export interface BrunoRequestPart {
  url: string
  method: string
  headers: BrunoPair[]
  params: (BrunoPair & { type: 'query' | 'path' })[]
  body: {
    mode: string // none | json | text | xml | formUrlEncoded | multipartForm | graphql | …
    json?: string
    text?: string
    xml?: string
    formUrlEncoded?: BrunoPair[]
    /** File fields: `value` holds the path(s), separated by `|`. */
    multipartForm?: (BrunoPair & { type: 'text' | 'file' })[]
    graphql?: { query: string; variables: string }
  }
  auth: {
    mode: string // inherit | none | bearer | basic | apikey | …
    bearer?: { token: string }
    basic?: { username: string; password: string }
    apikey?: { key: string; value: string; placement: string } // placement: header | queryparams
    digest?: { username: string; password: string }
    awsv4?: BrunoAwsV4
    oauth2?: BrunoOAuth2
  }
  script: { req: string; res: string }
  /** `req`: set before the request; `res`: name = response expression (e.g. res.body.id). */
  vars: { req: BrunoPair[]; res: BrunoPair[] }
  /** name = expression (`res.status`), value = `operator argument` (`eq 200`). */
  assertions: BrunoPair[]
  tests: string
  docs: string
  /** Only in OpenCollection YAML. */
  settings?: { timeout?: number; followRedirects?: boolean }
}

export interface BrunoAwsV4 {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  service: string
  region: string
  profileName: string
}

export interface BrunoOAuth2 {
  grantType: string // client_credentials | password | authorization_code | implicit
  accessTokenUrl: string
  authorizationUrl: string
  callbackUrl: string
  clientId: string
  clientSecret: string
  scope: string
  username: string
  password: string
  pkce: boolean
  credentialsPlacement: string // basic_auth_header | body
  tokenHeaderPrefix: string
}

const AWS_KEYS = [
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
  'service',
  'region',
  'profileName'
] as const

/** Reads the AWS fields from any object with Bruno's (camelCase) names. */
export function readAwsV4(get: (key: string) => string): BrunoAwsV4 {
  return Object.fromEntries(AWS_KEYS.map((k) => [k, get(k)])) as unknown as BrunoAwsV4
}

export const awsV4Entries = (a: BrunoAwsV4 | undefined): [string, string][] =>
  AWS_KEYS.map((k) => [k, a?.[k] ?? ''])

/**
 * Reads the OAuth 2.0 fields; `get` is tried with the camelCase name (JSON / YAML)
 * and the snake_case one (.bru).
 */
export function readOAuth2(get: (key: string) => unknown): BrunoOAuth2 {
  const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  const text = (k: string) => {
    const v = get(k) ?? get(snake(k))
    return asString(v)
  }
  return {
    grantType: text('grantType') || text('flow') || 'authorization_code',
    accessTokenUrl: text('accessTokenUrl'),
    authorizationUrl: text('authorizationUrl'),
    callbackUrl: text('callbackUrl'),
    clientId: text('clientId'),
    clientSecret: text('clientSecret'),
    scope: text('scope'),
    username: text('username'),
    password: text('password'),
    pkce: ['true', '1'].includes(text('pkce').toLowerCase()),
    credentialsPlacement: text('credentialsPlacement') || 'basic_auth_header',
    tokenHeaderPrefix: text('tokenHeaderPrefix') || 'Bearer'
  }
}

/** .bru `auth:oauth2` entries (snake_case, as Bruno writes them). */
export function oauth2Entries(o: BrunoOAuth2 | undefined): [string, string][] {
  if (!o) return []
  const entries: [string, string][] = [['grant_type', o.grantType]]
  if (o.grantType === 'authorization_code') {
    entries.push(['callback_url', o.callbackUrl], ['authorization_url', o.authorizationUrl])
  }
  entries.push(
    ['access_token_url', o.accessTokenUrl],
    ['client_id', o.clientId],
    ['client_secret', o.clientSecret],
    ['scope', o.scope]
  )
  if (o.grantType === 'password') entries.push(['username', o.username], ['password', o.password])
  if (o.grantType === 'authorization_code') entries.push(['pkce', String(o.pkce)])
  entries.push(
    ['credentials_placement', o.credentialsPlacement],
    ['token_placement', 'header'],
    ['token_header_prefix', o.tokenHeaderPrefix]
  )
  return entries
}

export interface BrunoRequestItem {
  type: string // http | graphql | grpc | ws …
  name: string
  seq: number
  request: BrunoRequestPart
}

export interface BrunoFolderItem {
  type: 'folder'
  name: string
  seq: number
  items: BrunoItem[]
  root: BrunoRequestPart | null
}

export type BrunoItem = BrunoRequestItem | BrunoFolderItem

export interface BrunoEnvironment {
  name: string
  /** Secret values are never stored in Bruno files (always empty). */
  variables: (BrunoPair & { secret: boolean })[]
}

export interface BrunoCollectionData {
  name: string
  items: BrunoItem[]
  root: BrunoRequestPart | null
  environments: BrunoEnvironment[]
  /** Bruno's script flow (bruno.json / opencollection.yml `scripts.flow`), if set. */
  scriptFlow?: 'sequential' | 'sandwich'
  /**
   * Imported from a folder inside a collection (no bruno.json / opencollection.yml):
   * settings of the folders above it are missing.
   */
  partial?: boolean
}

export type Json = Record<string, unknown>
export const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const asString = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''

export function emptyPart(): BrunoRequestPart {
  return {
    url: '',
    method: 'GET',
    headers: [],
    params: [],
    body: { mode: 'none' },
    auth: { mode: 'inherit' },
    script: { req: '', res: '' },
    vars: { req: [], res: [] },
    assertions: [],
    tests: '',
    docs: ''
  }
}

/** One collection file, read by the `.bru` or `.yml` reader. */
export type BrunoFile =
  | { kind: 'request'; item: BrunoRequestItem }
  | { kind: 'folder'; name: string; seq: number | null; part: BrunoRequestPart }
  | { kind: 'environment'; environment: BrunoEnvironment }
  | { kind: 'ignore' }

/**
 * Builds the folder tree from files keyed by relative path (forward slashes). Folder
 * names come from their folder file, or the directory name. The folder file of the top
 * directory (a folder imported on its own) is returned as `top`.
 */
export function buildTree(files: readonly (readonly [string, BrunoFile])[]): {
  items: BrunoItem[]
  top: { name: string; part: BrunoRequestPart } | null
  environments: BrunoEnvironment[]
} {
  const root: BrunoFolderItem = { type: 'folder', name: '', seq: 0, items: [], root: null }
  const folders = new Map<string, BrunoFolderItem>([['', root]])
  const folderOf = (dir: string): BrunoFolderItem => {
    const existing = folders.get(dir)
    if (existing) return existing
    const slash = dir.lastIndexOf('/')
    const parent = folderOf(slash < 0 ? '' : dir.slice(0, slash))
    const folder: BrunoFolderItem = {
      type: 'folder',
      name: dir.slice(slash + 1),
      seq: Number.MAX_SAFE_INTEGER,
      items: [],
      root: null
    }
    parent.items.push(folder)
    folders.set(dir, folder)
    return folder
  }
  let top: { name: string; part: BrunoRequestPart } | null = null
  const environments: BrunoEnvironment[] = []
  for (const [path, file] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const slash = path.lastIndexOf('/')
    const dir = slash < 0 ? '' : path.slice(0, slash)
    if (file.kind === 'environment') environments.push(file.environment)
    else if (file.kind === 'request') folderOf(dir).items.push(file.item)
    else if (file.kind === 'folder') {
      if (dir === '') {
        top = { name: file.name, part: file.part }
        continue
      }
      const folder = folderOf(dir)
      folder.root = file.part
      if (file.name !== '') folder.name = file.name
      if (file.seq !== null) folder.seq = file.seq
    }
  }
  return { items: root.items, top, environments }
}
