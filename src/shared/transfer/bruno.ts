/**
 * Bruno collections (decision 103): import from a collection folder (`*.bru` files) or
 * from Bruno's exported JSON, export as a collection folder Bruno can open.
 * Both import forms are first normalized to Bruno's JSON shape (`BrunoItem`), then mapped.
 * Mapping rules: docs/schema.md「Bruno」.
 */
import {
  HTTP_METHODS,
  ITEM_NAME_MAX,
  type Auth,
  type HttpMethod,
  type KeyValue,
  type Variable
} from '../schemas/collection'
import {
  httpRequestSchema,
  type Assertion,
  type AssertionOperator,
  type AssertionTarget,
  type Extraction,
  type FormDataField,
  type HttpBody,
  type HttpRequest,
  type RequestScripts
} from '../schemas/http-request'
import { parseBru, serializeBru, type BruBlock, type BruEntry } from './bru-lang'
import type {
  PortableCollection,
  PortableContainer,
  PortableEnvironment,
  PortableItem
} from './portable'
import { TransferError } from './postman'
import { TransferWarnings } from './warnings'

// ---------------------------------------------------------------------------------
// Bruno's JSON shape (also what .bru files are normalized to)
// ---------------------------------------------------------------------------------

interface BrunoPair {
  name: string
  value: string
  enabled: boolean
}

interface BrunoRequestPart {
  url: string
  method: string
  headers: BrunoPair[]
  params: (BrunoPair & { type: 'query' | 'path' })[]
  body: {
    mode: string
    json?: string
    text?: string
    xml?: string
    formUrlEncoded?: BrunoPair[]
    multipartForm?: (BrunoPair & { type: 'text' | 'file' })[]
    graphql?: { query: string; variables: string }
  }
  auth: {
    mode: string
    bearer?: { token: string }
    basic?: { username: string; password: string }
    apikey?: { key: string; value: string; placement: string }
  }
  script: { req: string; res: string }
  vars: { req: BrunoPair[]; res: BrunoPair[] }
  assertions: BrunoPair[]
  tests: string
  docs: string
}

interface BrunoRequestItem {
  type: string // http | graphql | grpc | ws …
  name: string
  seq: number
  request: BrunoRequestPart
}

interface BrunoFolderItem {
  type: 'folder'
  name: string
  seq: number
  items: BrunoItem[]
  root: Partial<BrunoRequestPart> | null
}

type BrunoItem = BrunoRequestItem | BrunoFolderItem

interface BrunoCollectionData {
  name: string
  items: BrunoItem[]
  root: Partial<BrunoRequestPart> | null
  environments: { name: string; variables: (BrunoPair & { secret: boolean })[] }[]
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asString = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''

function itemName(v: unknown, fallback: string): string {
  const name = asString(v).replace(/\s+/g, ' ').trim()
  return (name === '' ? fallback : name).slice(0, ITEM_NAME_MAX).trim() || fallback
}

function pairs(list: unknown): BrunoPair[] {
  return asArray(list)
    .filter(isObject)
    .map((p) => ({
      name: asString(p.name),
      value: asString(p.value),
      enabled: p.enabled !== false
    }))
}

function emptyPart(): BrunoRequestPart {
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

// ---------------------------------------------------------------------------------
// Detection and JSON normalization
// ---------------------------------------------------------------------------------

/** Bruno's "Export Collection" JSON (not a Postman file: no `info.schema`). */
export function isBrunoJson(json: unknown): boolean {
  if (!isObject(json) || isObject(json.info) || !Array.isArray(json.items)) return false
  return 'brunoConfig' in json || asString(json.version) === '1' || 'environments' in json
}

function normalizePart(raw: unknown): BrunoRequestPart {
  const r = isObject(raw) ? raw : {}
  const body = isObject(r.body) ? r.body : {}
  const auth = isObject(r.auth) ? r.auth : {}
  const script = isObject(r.script) ? r.script : {}
  const vars = isObject(r.vars) ? r.vars : {}
  const part = emptyPart()
  part.url = asString(r.url)
  part.method = asString(r.method) || 'GET'
  part.headers = pairs(r.headers)
  part.params = asArray(r.params)
    .filter(isObject)
    .map((p) => ({ ...pairs([p])[0]!, type: asString(p.type) === 'path' ? 'path' : 'query' }))
  part.body = {
    mode: asString(body.mode) || 'none',
    json: asString(body.json),
    text: asString(body.text),
    xml: asString(body.xml),
    formUrlEncoded: pairs(body.formUrlEncoded),
    multipartForm: asArray(body.multipartForm)
      .filter(isObject)
      .map((p) => ({
        name: asString(p.name),
        value: Array.isArray(p.value) ? p.value.map(asString).join('|') : asString(p.value),
        enabled: p.enabled !== false,
        type: asString(p.type) === 'file' ? ('file' as const) : ('text' as const)
      })),
    graphql: isObject(body.graphql)
      ? { query: asString(body.graphql.query), variables: asString(body.graphql.variables) }
      : undefined
  }
  part.auth = {
    mode: asString(auth.mode) || 'inherit',
    bearer: isObject(auth.bearer) ? { token: asString(auth.bearer.token) } : undefined,
    basic: isObject(auth.basic)
      ? { username: asString(auth.basic.username), password: asString(auth.basic.password) }
      : undefined,
    apikey: isObject(auth.apikey)
      ? {
          key: asString(auth.apikey.key),
          value: asString(auth.apikey.value),
          placement: asString(auth.apikey.placement)
        }
      : undefined
  }
  part.script = { req: asString(script.req), res: asString(script.res) }
  part.vars = { req: pairs(vars.req), res: pairs(vars.res) }
  part.assertions = pairs(r.assertions)
  part.tests = asString(r.tests)
  part.docs = asString(r.docs)
  return part
}

function normalizeItems(list: unknown): BrunoItem[] {
  return asArray(list)
    .filter(isObject)
    .map((item, index): BrunoItem => {
      const seq = typeof item.seq === 'number' ? item.seq : index + 1
      if (asString(item.type) === 'folder') {
        const root = isObject(item.root) && isObject(item.root.request) ? item.root.request : null
        return {
          type: 'folder',
          name: asString(item.name),
          seq,
          items: normalizeItems(item.items),
          root: root ? normalizePart(root) : null
        }
      }
      return {
        type: asString(item.type) || 'http',
        name: asString(item.name),
        seq,
        request: normalizePart(item.request)
      }
    })
}

function normalizeJson(json: Json): BrunoCollectionData {
  const root = isObject(json.root) && isObject(json.root.request) ? json.root.request : null
  return {
    name: asString(json.name),
    items: normalizeItems(json.items),
    root: root ? normalizePart(root) : null,
    environments: asArray(json.environments)
      .filter(isObject)
      .map((env) => ({
        name: asString(env.name),
        variables: asArray(env.variables)
          .filter(isObject)
          .map((v) => ({ ...pairs([v])[0]!, secret: v.secret === true }))
      }))
  }
}

// ---------------------------------------------------------------------------------
// .bru files → JSON shape
// ---------------------------------------------------------------------------------

const BODY_BLOCK_MODES: Record<string, string> = {
  'body:json': 'json',
  'body:text': 'text',
  'body:xml': 'xml',
  'body:form-urlencoded': 'formUrlEncoded',
  'body:multipart-form': 'multipartForm',
  'body:graphql': 'graphql'
}

const entryPairs = (entries: BruEntry[]): BrunoPair[] =>
  entries.map((e) => ({ name: e.key, value: e.value, enabled: e.enabled }))

/** One .bru file (request, folder.bru or collection.bru) → request part + meta. */
function partFromBru(blocks: BruBlock[]): {
  part: BrunoRequestPart
  meta: Record<string, string>
  type: string
} {
  const part = emptyPart()
  const meta: Record<string, string> = {}
  let type = 'http'
  const dict = (b: BruBlock) => (b.kind === 'dict' ? b.entries : [])
  const text = (b: BruBlock) => (b.kind === 'text' ? b.text : '')
  for (const block of blocks) {
    const name = block.name
    if (name === 'meta') {
      for (const e of dict(block)) meta[e.key] = e.value
      if (meta.type) type = meta.type
    } else if (
      HTTP_METHODS.includes(name.toUpperCase() as HttpMethod) ||
      name === 'connect' ||
      name === 'trace'
    ) {
      part.method = name.toUpperCase()
      for (const e of dict(block)) {
        if (e.key === 'url') part.url = e.value
        if (e.key === 'body') part.body.mode = e.value
        if (e.key === 'auth') part.auth.mode = e.value
      }
    } else if (name === 'params:query' || name === 'query' || name === 'params:path') {
      part.params.push(
        ...entryPairs(dict(block)).map((p) => ({
          ...p,
          type: name === 'params:path' ? ('path' as const) : ('query' as const)
        }))
      )
    } else if (name === 'headers') {
      part.headers = entryPairs(dict(block))
    } else if (name === 'auth') {
      // collection.bru / folder.bru: `auth { mode: bearer }`
      const mode = dict(block).find((e) => e.key === 'mode')
      if (mode) part.auth.mode = mode.value
    } else if (name === 'auth:bearer') {
      part.auth.bearer = { token: dict(block).find((e) => e.key === 'token')?.value ?? '' }
    } else if (name === 'auth:basic') {
      const get = (k: string) => dict(block).find((e) => e.key === k)?.value ?? ''
      part.auth.basic = { username: get('username'), password: get('password') }
    } else if (name === 'auth:apikey') {
      const get = (k: string) => dict(block).find((e) => e.key === k)?.value ?? ''
      part.auth.apikey = { key: get('key'), value: get('value'), placement: get('placement') }
    } else if (name in BODY_BLOCK_MODES) {
      const mode = BODY_BLOCK_MODES[name] as string
      if (mode === 'formUrlEncoded') part.body.formUrlEncoded = entryPairs(dict(block))
      else if (mode === 'multipartForm') {
        part.body.multipartForm = entryPairs(dict(block)).map((p) => {
          const file = /^@file\((.*)\)$/.exec(p.value)
          return file
            ? { ...p, value: file[1] ?? '', type: 'file' as const }
            : { ...p, type: 'text' as const }
        })
      } else if (mode === 'graphql') {
        part.body.graphql = { query: text(block), variables: part.body.graphql?.variables ?? '' }
      } else {
        part.body[mode as 'json' | 'text' | 'xml'] = text(block)
      }
    } else if (name === 'body:graphql:vars') {
      part.body.graphql = { query: part.body.graphql?.query ?? '', variables: text(block) }
    } else if (name === 'script:pre-request') {
      part.script.req = text(block)
    } else if (name === 'script:post-response') {
      part.script.res = text(block)
    } else if (name === 'vars:pre-request' || name === 'vars') {
      part.vars.req = entryPairs(dict(block))
    } else if (name === 'vars:post-response') {
      part.vars.res = entryPairs(dict(block))
    } else if (name === 'assert') {
      part.assertions = entryPairs(dict(block))
    } else if (name === 'tests') {
      part.tests = text(block)
    } else if (name === 'docs') {
      part.docs = text(block)
    }
  }
  return { part, meta, type }
}

/**
 * A Bruno collection folder as `{ relative path: file content }` (forward slashes):
 * bruno.json, collection.bru, folder.bru, *.bru, environments/*.bru.
 */
export function brunoFolderToData(files: Readonly<Record<string, string>>): BrunoCollectionData {
  const config = files['bruno.json']
  if (config === undefined)
    throw new TransferError('不是 Bruno collection 資料夾（找不到 bruno.json）')
  let name: string
  try {
    name = asString((JSON.parse(config) as Json).name)
  } catch {
    throw new TransferError('bruno.json 不是有效的 JSON')
  }

  const parse = (path: string) => {
    try {
      return parseBru(files[path] as string)
    } catch (error) {
      throw new TransferError(`${path}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const environments: BrunoCollectionData['environments'] = []
  const folders = new Map<string, BrunoFolderItem>()
  const root: BrunoFolderItem = { type: 'folder', name, seq: 0, items: [], root: null }
  folders.set('', root)
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

  for (const path of Object.keys(files).sort()) {
    if (!path.endsWith('.bru')) continue
    const slash = path.lastIndexOf('/')
    const dir = slash < 0 ? '' : path.slice(0, slash)
    const file = path.slice(slash + 1)
    if (dir === 'environments') {
      const blocks = parse(path)
      const vars = blocks.find((b) => b.name === 'vars')
      const secret = blocks.find((b) => b.name === 'vars:secret')
      environments.push({
        name: file.replace(/\.bru$/, ''),
        variables: [
          ...(vars?.kind === 'dict' ? entryPairs(vars.entries) : []).map((v) => ({
            ...v,
            secret: false
          })),
          ...(secret?.kind === 'list' ? secret.items : []).map((item) => ({
            name: item.replace(/^~/, ''),
            value: '',
            enabled: !item.startsWith('~'),
            secret: true
          }))
        ]
      })
      continue
    }
    const { part, meta, type } = partFromBru(parse(path))
    if (file === 'collection.bru' && dir === '') {
      root.root = part
    } else if (file === 'folder.bru') {
      const folder = folderOf(dir)
      folder.root = part
      if (meta.name) folder.name = meta.name
      if (meta.seq && !Number.isNaN(Number(meta.seq))) folder.seq = Number(meta.seq)
    } else {
      folderOf(dir).items.push({
        type,
        name: meta.name || file.replace(/\.bru$/, ''),
        seq: Number(meta.seq) || Number.MAX_SAFE_INTEGER,
        request: part
      })
    }
  }
  return { name, items: root.items, root: root.root, environments }
}

// ---------------------------------------------------------------------------------
// JSON shape → portable
// ---------------------------------------------------------------------------------

export interface BrunoImport {
  collection: PortableCollection
  environments: PortableEnvironment[]
  warnings: string[]
}

interface Ctx {
  newId: () => string
  warnings: TransferWarnings
}

const kv = (ctx: Ctx, p: BrunoPair): KeyValue => ({
  id: ctx.newId(),
  key: p.name,
  value: p.value,
  enabled: p.enabled
})

function mapAuth(auth: BrunoRequestPart['auth'], fallback: Auth, where: string, ctx: Ctx): Auth {
  switch (auth.mode) {
    case 'inherit':
      return fallback
    case 'none':
      return { type: 'none' }
    case 'bearer':
      return { type: 'bearer', token: auth.bearer?.token ?? '' }
    case 'basic':
      return {
        type: 'basic',
        username: auth.basic?.username ?? '',
        password: auth.basic?.password ?? ''
      }
    case 'apikey':
      return {
        type: 'apiKey',
        key: auth.apikey?.key ?? '',
        value: auth.apikey?.value ?? '',
        in: auth.apikey?.placement === 'queryparams' ? 'query' : 'header'
      }
    default:
      ctx.warnings.add(`不支援的 Auth 類型「${auth.mode}」，已改為 None`, where)
      return { type: 'none' }
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const unquote = (v: string) => {
  const t = v.trim()
  return t.length >= 2 && /^(["'`]).*\1$/.test(t) ? t.slice(1, -1) : t
}

/** `res.body.data.id` → jsonBody `data.id`; `res.headers.x-id` → header; `res.status`… */
function mapTarget(expr: string): { target: AssertionTarget; path: string } | null {
  const e = expr.trim()
  if (e === 'res.status' || e === 'res.getStatus()') return { target: 'status', path: '' }
  if (e === 'res.responseTime' || e === 'res.getResponseTime()') {
    return { target: 'responseTime', path: '' }
  }
  if (e === 'res.body' || e === 'res.getBody()') return { target: 'jsonBody', path: '' }
  const header = /^res\.(?:headers|getHeader\()\.?\[?['"]?([^'")\]]+)['"]?\]?\)?$/.exec(e)
  if (header && (e.startsWith('res.headers') || e.startsWith('res.getHeader('))) {
    return { target: 'header', path: header[1] ?? '' }
  }
  // Only plain paths (`.a.b[0]["c"]`); anything else is an expression for a script.
  const body = /^res\.body((?:\.[\w$-]+|\[(?:\d+|"[^"]*"|'[^']*')\])+)$/.exec(e)
  if (body) return { target: 'jsonBody', path: (body[1] ?? '').replace(/^\./, '') }
  return null
}

const UNARY: Record<string, [AssertionOperator, string]> = {
  isDefined: ['exists', ''],
  isUndefined: ['notExists', ''],
  isNull: ['eq', 'null'],
  isNumber: ['isType', 'number'],
  isString: ['isType', 'string'],
  isBoolean: ['isType', 'boolean'],
  isArray: ['isType', 'array'],
  isJson: ['isType', 'object']
}
const BINARY = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'matches'
])

function mapAssertion(p: BrunoPair, ctx: Ctx, where: string): Assertion | null {
  const target = mapTarget(p.name)
  const m = /^(\w+)\s*(.*)$/s.exec(p.value.trim())
  const op = m?.[1] ?? ''
  const arg = unquote(m?.[2] ?? '')
  const fail = () => {
    ctx.warnings.add(`無法對應的 Bruno 斷言已略過：${p.name}: ${p.value}`, where)
    return null
  }
  if (!target || !m) return fail()
  let operator: AssertionOperator
  let expected = arg
  if (op in UNARY) [operator, expected] = UNARY[op] as [AssertionOperator, string]
  else if (BINARY.has(op)) operator = op as AssertionOperator
  else if (op === 'startsWith') [operator, expected] = ['matches', `^${escapeRegExp(arg)}`]
  else if (op === 'endsWith') [operator, expected] = ['matches', `${escapeRegExp(arg)}$`]
  else return fail()
  if (target.target === 'jsonBody' && target.path === '' && operator === 'contains') {
    target.target = 'body'
  }
  return {
    id: ctx.newId(),
    enabled: p.enabled,
    target: target.target,
    path: target.path,
    operator,
    expected
  }
}

const jsString = (s: string) => JSON.stringify(s)

function mapRequest(item: BrunoRequestItem, path: string[], ctx: Ctx): HttpRequest | null {
  const where = [...path, item.name].join(' / ')
  const r = item.request
  if (
    item.type !== 'http' &&
    item.type !== 'http-request' &&
    item.type !== 'graphql' &&
    item.type !== 'graphql-request'
  ) {
    ctx.warnings.add(`不支援的 Bruno 請求類型「${item.type}」，已略過`, where)
    return null
  }
  let method = r.method.toUpperCase()
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    ctx.warnings.add(`不支援的 HTTP 方法「${method}」，已改為 GET`, where)
    method = 'GET'
  }

  // Path params (`/users/:id`) go into the URL, as for Postman imports.
  let url = r.url
  for (const p of r.params.filter((p) => p.type === 'path' && p.value !== '')) {
    url = url.replace(new RegExp(`/:${escapeRegExp(p.name)}(?=[/?#]|$)`, 'g'), `/${p.value}`)
  }
  // Query params live both in the URL and in params:query; keep the table, drop the query.
  const query = r.params.filter((p) => p.type === 'query')
  if (query.length > 0) url = url.replace(/\?[^#]*/, '')

  const body: Partial<HttpBody> = { mode: 'none' }
  const mode = r.body.mode
  if (mode === 'json') Object.assign(body, { mode: 'json', json: r.body.json ?? '' })
  else if (mode === 'text')
    Object.assign(body, { mode: 'raw', raw: r.body.text ?? '', rawContentType: 'text/plain' })
  else if (mode === 'xml')
    Object.assign(body, { mode: 'raw', raw: r.body.xml ?? '', rawContentType: 'application/xml' })
  else if (mode === 'formUrlEncoded') {
    Object.assign(body, {
      mode: 'urlencoded',
      urlencoded: (r.body.formUrlEncoded ?? []).map((p) => kv(ctx, p))
    })
  } else if (mode === 'multipartForm') {
    const fields: FormDataField[] = (r.body.multipartForm ?? []).map((p) => ({
      id: ctx.newId(),
      key: p.name,
      enabled: p.enabled,
      type: p.type,
      value: p.type === 'text' ? p.value : '',
      filePath: p.type === 'file' ? (p.value.split('|')[0] ?? '') : ''
    }))
    if (fields.some((f) => f.type === 'file')) {
      ctx.warnings.add(
        'Form-data 檔案路徑來自原本的電腦（Bruno 用相對路徑），可能需要重新選擇檔案',
        where
      )
    }
    Object.assign(body, { mode: 'formData', formData: fields })
  } else if (mode === 'graphql' || item.type.startsWith('graphql')) {
    let variables: unknown
    const varsText = r.body.graphql?.variables?.trim() ?? ''
    if (varsText !== '') {
      try {
        variables = JSON.parse(varsText) as unknown
      } catch {
        ctx.warnings.add('GraphQL variables 不是有效的 JSON，未匯入', where)
      }
    }
    Object.assign(body, {
      mode: 'json',
      json: JSON.stringify(
        variables === undefined
          ? { query: r.body.graphql?.query ?? '' }
          : { query: r.body.graphql?.query ?? '', variables },
        null,
        2
      )
    })
    ctx.warnings.add('GraphQL 請求已轉成 JSON Body', where)
    if (method === 'GET') method = 'POST'
  } else if (mode !== 'none' && mode !== '') {
    ctx.warnings.add(`不支援的 Body 類型「${mode}」，已改為 none`, where)
  }

  // vars:pre-request → set before the script runs; vars:post-response → extraction rows
  // when they are plain response paths, otherwise script lines (bru compatibility layer).
  const pre = r.vars.req
    .filter((v) => v.enabled && v.name.trim() !== '')
    .map((v) => `bru.setVar(${jsString(v.name)}, bru.interpolate(${jsString(v.value)}))`)
  const extractions: Extraction[] = []
  const postLines: string[] = []
  for (const v of r.vars.res.filter((x) => x.name.trim() !== '')) {
    const target = mapTarget(v.value)
    if (v.enabled && target && target.target !== 'responseTime') {
      extractions.push({
        id: ctx.newId(),
        enabled: true,
        source:
          target.target === 'jsonBody'
            ? 'jsonBody'
            : target.target === 'header'
              ? 'header'
              : 'status',
        path: target.path,
        variable: v.name,
        scope: 'runtime'
      })
    } else if (v.enabled) {
      postLines.push(`bru.setVar(${jsString(v.name)}, ${v.value})`)
    }
  }
  const scripts: RequestScripts = {
    preRequest: [...pre, r.script.req].filter((s) => s.trim() !== '').join('\n'),
    postResponse: [...postLines, r.script.res, r.tests].filter((s) => s.trim() !== '').join('\n\n')
  }
  const unsupported = unsupportedBrunoApis(`${scripts.preRequest}\n${scripts.postResponse}`)
  if (unsupported.length > 0) {
    ctx.warnings.add(`腳本使用了 Hachi 不支援的寫法：${unsupported.join('、')}`, where)
  }

  return httpRequestSchema.parse({
    version: 1,
    id: ctx.newId(),
    type: 'http',
    name: itemName(item.name, 'Untitled'),
    method,
    url,
    params: query.map((p) => kv(ctx, p)),
    headers: r.headers.map((p) => kv(ctx, p)),
    body,
    auth: mapAuth(r.auth, { type: 'inherit' }, where, ctx),
    scripts,
    assertions: r.assertions
      .map((a) => mapAssertion(a, ctx, where))
      .filter((a): a is Assertion => a !== null),
    extractions,
    docs: r.docs
  })
}

/** Bruno script APIs the Hachi compatibility layer does not provide (decision 104). */
const UNSUPPORTED_BRUNO_APIS: [RegExp, string][] = [
  [/\bbru\.(?:sendRequest|runRequest)\b/, 'bru.sendRequest / runRequest'],
  [/\bbru\.setNextRequest\b/, 'bru.setNextRequest'],
  [/\bbru\.runner\b/, 'bru.runner'],
  [/\bbru\.cookies\b/, 'bru.cookies'],
  [/\bbru\.getProcessEnv\b|\bprocess\.env\b/, 'process.env'],
  [/\bsetTimeout\s*\(/, 'setTimeout'],
  [/\b(?:await|async)\b/, 'async / await']
]

export function unsupportedBrunoApis(code: string): string[] {
  const found = UNSUPPORTED_BRUNO_APIS.filter(([re]) => re.test(code)).map(([, name]) => name)
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (m[1] !== 'crypto-js') found.push(`require('${m[1]}')`)
  }
  return [...new Set(found)]
}

function containerScripts(part: Partial<BrunoRequestPart> | null, where: string, ctx: Ctx) {
  const req = part?.script?.req ?? ''
  const res = [part?.script?.res ?? '', part?.tests ?? '']
    .filter((s) => s.trim() !== '')
    .join('\n\n')
  if (req.trim() === '' && res.trim() === '') return null
  ctx.warnings.add('Collection / 資料夾的腳本已保留，但目前不會執行', where)
  return { preRequest: req, postResponse: res }
}

function mapItems(items: BrunoItem[], path: string[], ctx: Ctx): PortableItem[] {
  return [...items]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((item): PortableItem[] => {
      if (item.type === 'folder') {
        const folder = item as BrunoFolderItem
        const name = itemName(folder.name, 'Folder')
        const where = [...path, name].join(' / ')
        if ((folder.root?.vars?.req.length ?? 0) > 0) {
          ctx.warnings.add('資料夾變數 Hachi 不支援，未匯入', where)
        }
        return [
          {
            kind: 'folder',
            name,
            headers: (folder.root?.headers ?? []).map((p) => kv(ctx, p)),
            auth: folder.root?.auth
              ? mapAuth(
                  folder.root.auth as BrunoRequestPart['auth'],
                  { type: 'inherit' },
                  where,
                  ctx
                )
              : { type: 'inherit' },
            scripts: containerScripts(folder.root, where, ctx),
            children: mapItems(folder.items, [...path, name], ctx)
          }
        ]
      }
      const request = mapRequest(item as BrunoRequestItem, path, ctx)
      return request ? [{ kind: 'request', request }] : []
    })
}

function mapCollection(data: BrunoCollectionData, newId: () => string): BrunoImport {
  const warnings = new TransferWarnings()
  const ctx: Ctx = { newId, warnings }
  const root = data.root
  const variables: Variable[] = (root?.vars?.req ?? [])
    .filter((v) => v.name.trim() !== '')
    .map((v) => ({ ...kv(ctx, v), secret: false }))
  const collection: PortableCollection = {
    name: itemName(data.name, 'Bruno Collection'),
    headers: (root?.headers ?? []).map((p) => kv(ctx, p)),
    auth: root?.auth
      ? mapAuth(root.auth as BrunoRequestPart['auth'], { type: 'none' }, '', ctx)
      : { type: 'none' },
    variables,
    scripts: containerScripts(root, '', ctx),
    children: mapItems(data.items, [], ctx)
  }
  const environments: PortableEnvironment[] = data.environments.map((env) => ({
    name: itemName(env.name, 'Environment'),
    variables: env.variables
      .filter((v) => v.name.trim() !== '')
      .map((v) => ({ ...kv(ctx, v), secret: v.secret }))
  }))
  if (environments.some((e) => e.variables.some((v) => v.secret))) {
    warnings.add('Bruno 不把機密變數的值存在檔案中，請在環境中重新輸入')
  }
  return { collection, environments, warnings: warnings.list() }
}

const defaultId = () => globalThis.crypto.randomUUID()

export function importBrunoJson(json: unknown, newId: () => string = defaultId): BrunoImport {
  if (!isBrunoJson(json)) throw new TransferError('不是 Bruno 匯出的 collection JSON')
  return mapCollection(normalizeJson(json as Json), newId)
}

export function importBrunoFolder(
  files: Readonly<Record<string, string>>,
  newId: () => string = defaultId
): BrunoImport {
  return mapCollection(brunoFolderToData(files), newId)
}

// ---------------------------------------------------------------------------------
// Export: portable → collection folder files
// ---------------------------------------------------------------------------------

export interface BrunoExport {
  /** Relative path → content (bruno.json, collection.bru, *.bru, environments/*.bru). */
  files: Record<string, string>
  skipped: string[]
  warnings: string[]
}

/** File / folder name Bruno and every OS accept. */
/** A file / folder name Bruno (and every OS) accepts. */
export function safeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/, '')
      .trim() || 'untitled'
  )
}

function uniqueIn(taken: Set<string>, base: string, ext: string): string {
  let candidate = `${base}${ext}`
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}${ext}`
  taken.add(candidate.toLowerCase())
  return candidate
}

const OP_BACK: Partial<Record<AssertionOperator, string>> = {
  eq: 'eq',
  neq: 'neq',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  contains: 'contains',
  notContains: 'notContains',
  matches: 'matches',
  exists: 'isDefined',
  notExists: 'isUndefined'
}

function assertionToBru(a: Assertion): BruEntry | null {
  const left =
    a.target === 'status'
      ? 'res.status'
      : a.target === 'responseTime'
        ? 'res.responseTime'
        : a.target === 'header'
          ? `res.headers.${a.path.toLowerCase()}`
          : a.target === 'body'
            ? 'res.body'
            : a.path === ''
              ? 'res.body'
              : `res.body${a.path.startsWith('[') ? '' : '.'}${a.path}`
  let right: string | undefined
  if (a.operator === 'isType') {
    const type = {
      number: 'isNumber',
      string: 'isString',
      boolean: 'isBoolean',
      array: 'isArray',
      object: 'isJson',
      null: 'isNull'
    }[a.expected.trim()]
    right = type
  } else {
    const op = OP_BACK[a.operator]
    if (op) right = op === 'isDefined' || op === 'isUndefined' ? op : `${op} ${a.expected}`
  }
  return right ? { key: left, value: right, enabled: a.enabled } : null
}

function authBlocks(auth: Auth): { mode: string; blocks: BruBlock[] } {
  switch (auth.type) {
    case 'inherit':
      return { mode: 'inherit', blocks: [] }
    case 'none':
      return { mode: 'none', blocks: [] }
    case 'bearer':
      return {
        mode: 'bearer',
        blocks: [
          {
            kind: 'dict',
            name: 'auth:bearer',
            entries: [{ key: 'token', value: auth.token, enabled: true }]
          }
        ]
      }
    case 'basic':
      return {
        mode: 'basic',
        blocks: [
          {
            kind: 'dict',
            name: 'auth:basic',
            entries: [
              { key: 'username', value: auth.username, enabled: true },
              { key: 'password', value: auth.password, enabled: true }
            ]
          }
        ]
      }
    case 'apiKey':
      return {
        mode: 'apikey',
        blocks: [
          {
            kind: 'dict',
            name: 'auth:apikey',
            entries: [
              { key: 'key', value: auth.key, enabled: true },
              { key: 'value', value: auth.value, enabled: true },
              {
                key: 'placement',
                value: auth.in === 'query' ? 'queryparams' : 'header',
                enabled: true
              }
            ]
          }
        ]
      }
  }
}

const dictBlock = (name: string, rows: readonly KeyValue[]): BruBlock[] => {
  const entries = rows
    .filter((r) => r.key.trim() !== '')
    .map((r) => ({ key: r.key, value: r.value.replace(/\n/g, ' '), enabled: r.enabled }))
  return entries.length > 0 ? [{ kind: 'dict', name, entries }] : []
}

function requestBru(
  request: HttpRequest,
  seq: number,
  where: string,
  warnings: TransferWarnings
): string {
  const b = request.body
  const bodyMode =
    b.mode === 'json'
      ? 'json'
      : b.mode === 'raw'
        ? /xml/i.test(b.rawContentType)
          ? 'xml'
          : 'text'
        : b.mode === 'urlencoded'
          ? 'formUrlEncoded'
          : b.mode === 'formData'
            ? 'multipartForm'
            : 'none'
  const auth = authBlocks(request.auth)
  const blocks: BruBlock[] = [
    {
      kind: 'dict',
      name: 'meta',
      entries: [
        { key: 'name', value: request.name, enabled: true },
        { key: 'type', value: 'http', enabled: true },
        { key: 'seq', value: String(seq), enabled: true }
      ]
    },
    {
      kind: 'dict',
      name: request.method.toLowerCase(),
      entries: [
        { key: 'url', value: request.url, enabled: true },
        { key: 'body', value: bodyMode, enabled: true },
        { key: 'auth', value: auth.mode, enabled: true }
      ]
    },
    ...dictBlock('params:query', request.params),
    ...dictBlock('headers', request.headers),
    ...auth.blocks
  ]
  if (b.mode === 'json') blocks.push({ kind: 'text', name: 'body:json', text: b.json })
  if (b.mode === 'raw')
    blocks.push({ kind: 'text', name: bodyMode === 'xml' ? 'body:xml' : 'body:text', text: b.raw })
  if (b.mode === 'urlencoded') blocks.push(...dictBlock('body:form-urlencoded', b.urlencoded))
  if (b.mode === 'formData') {
    const entries = b.formData
      .filter((f) => f.key.trim() !== '')
      .map((f) => ({
        key: f.key,
        value: f.type === 'file' ? `@file(${f.filePath})` : f.value,
        enabled: f.enabled
      }))
    if (entries.length > 0) blocks.push({ kind: 'dict', name: 'body:multipart-form', entries })
  }
  const vars = request.extractions
    .filter((e) => e.variable.trim() !== '')
    .map((e) => ({
      key: e.variable,
      value:
        e.source === 'status'
          ? 'res.status'
          : e.source === 'header'
            ? `res.headers[${JSON.stringify(e.path.toLowerCase())}]`
            : e.source === 'jsonBody'
              ? e.path === ''
                ? 'res.body'
                : `res.body${e.path.startsWith('[') ? '' : '.'}${e.path}`
              : 'res.body',
      enabled: e.enabled
    }))
  if (request.extractions.some((e) => e.source === 'body' && e.path.trim() !== '')) {
    warnings.add('用 Regex 擷取 Body 的列 Bruno 不支援，已改為整個 Body', where)
  }
  if (request.extractions.some((e) => e.scope === 'environment')) {
    warnings.add('存到環境的擷取在 Bruno 會變成暫存變數', where)
  }
  if (vars.length > 0) blocks.push({ kind: 'dict', name: 'vars:post-response', entries: vars })
  const asserts = request.assertions.map(assertionToBru)
  if (asserts.some((a) => a === null)) warnings.add('部分斷言 Bruno 沒有對應寫法，已略過', where)
  const assertEntries = asserts.filter((a): a is BruEntry => a !== null)
  if (assertEntries.length > 0)
    blocks.push({ kind: 'dict', name: 'assert', entries: assertEntries })
  const { preRequest, postResponse } = request.scripts
  if (preRequest.trim() !== '')
    blocks.push({ kind: 'text', name: 'script:pre-request', text: preRequest })
  if (postResponse.trim() !== '')
    blocks.push({ kind: 'text', name: 'script:post-response', text: postResponse })
  if (/\bhachi\./.test(preRequest + postResponse)) {
    warnings.add('腳本使用了 hachi.* 寫法，Bruno 無法執行，請改成 bru / req / res', where)
  }
  if (request.docs.trim() !== '') blocks.push({ kind: 'text', name: 'docs', text: request.docs })
  if (request.settings.timeoutMs !== null || request.settings.validateSSL !== null) {
    warnings.add('請求的逾時 / SSL 設定 Bruno 的 .bru 檔沒有對應，未匯出', where)
  }
  return serializeBru(blocks)
}

function containerBru(container: PortableContainer, meta: BruEntry[] | null): string | null {
  const auth = authBlocks(container.auth)
  const blocks: BruBlock[] = [
    ...(meta ? [{ kind: 'dict' as const, name: 'meta', entries: meta }] : []),
    ...dictBlock('headers', container.headers),
    ...(auth.mode === 'inherit'
      ? []
      : [
          {
            kind: 'dict' as const,
            name: 'auth',
            entries: [{ key: 'mode', value: auth.mode, enabled: true }]
          },
          ...auth.blocks
        ])
  ]
  if (container.scripts?.preRequest.trim())
    blocks.push({ kind: 'text', name: 'script:pre-request', text: container.scripts.preRequest })
  if (container.scripts?.postResponse.trim())
    blocks.push({
      kind: 'text',
      name: 'script:post-response',
      text: container.scripts.postResponse
    })
  return blocks.length > 0 ? serializeBru(blocks) : null
}

export function exportBrunoCollection(
  collection: PortableCollection,
  environments: readonly PortableEnvironment[]
): BrunoExport {
  const warnings = new TransferWarnings()
  const skipped: string[] = []
  const files: Record<string, string> = {
    'bruno.json': `${JSON.stringify(
      { version: '1', name: collection.name, type: 'collection', ignore: ['node_modules', '.git'] },
      null,
      2
    )}\n`
  }
  const rootBru = containerBru(collection, null)
  const vars = collection.variables.filter((v) => v.key.trim() !== '')
  if (vars.some((v) => v.secret)) warnings.add('機密的 Collection 變數不會匯出值（已留空）')
  const varBlock = dictBlock(
    'vars:pre-request',
    vars.map((v) => (v.secret ? { ...v, value: '' } : v))
  )
  if (rootBru || varBlock.length > 0) {
    files['collection.bru'] =
      `${rootBru ?? ''}${rootBru && varBlock.length > 0 ? '\n' : ''}${varBlock.length > 0 ? serializeBru(varBlock) : ''}`
  }

  const walk = (container: PortableContainer, dir: string, trail: string[]) => {
    const taken = new Set<string>(['folder.bru', 'collection.bru', 'bruno.json', 'environments'])
    container.children.forEach((child, index) => {
      if (child.kind === 'folder') {
        const name = uniqueIn(taken, safeName(child.name), '')
        const path = dir === '' ? name : `${dir}/${name}`
        const meta: BruEntry[] = [
          { key: 'name', value: child.name, enabled: true },
          { key: 'seq', value: String(index + 1), enabled: true }
        ]
        files[`${path}/folder.bru`] = containerBru(child, meta) as string
        walk(child, path, [...trail, child.name])
        return
      }
      const where = [...trail, child.request.name].join(' / ')
      if (child.request.type !== 'http') {
        skipped.push(where)
        return
      }
      const file = uniqueIn(taken, safeName(child.request.name), '.bru')
      files[dir === '' ? file : `${dir}/${file}`] = requestBru(
        child.request,
        index + 1,
        where,
        warnings
      )
    })
  }
  walk(collection, '', [])

  const envTaken = new Set<string>()
  for (const env of environments) {
    const plain = env.variables.filter((v) => !v.secret && v.key.trim() !== '')
    const secret = env.variables.filter((v) => v.secret && v.key.trim() !== '')
    const blocks: BruBlock[] = [
      {
        kind: 'dict',
        name: 'vars',
        entries: plain.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled }))
      }
    ]
    if (secret.length > 0) {
      blocks.push({
        kind: 'list',
        name: 'vars:secret',
        items: secret.map((v) => `${v.enabled ? '' : '~'}${v.key}`)
      })
      warnings.add('環境的機密變數只匯出名稱（Bruno 也不把值存在檔案中）')
    }
    files[`environments/${uniqueIn(envTaken, safeName(env.name), '.bru')}`] = serializeBru(blocks)
  }
  return { files, skipped, warnings: warnings.list() }
}
