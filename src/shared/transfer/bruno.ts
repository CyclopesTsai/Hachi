/**
 * Bruno collections (decisions 103 / 107): import from a collection folder (`.bru` or
 * OpenCollection `.yml` files) or from Bruno's exported JSON; export as a collection
 * folder in either file format. Every source is read into the shared Bruno model
 * (bruno-model.ts) and mapped from there; exports are built as that model, then written
 * by bruno-bru.ts / bruno-yaml.ts. Mapping rules: docs/schema.md「Bruno」.
 */
import {
  HTTP_METHODS,
  ITEM_NAME_MAX,
  type Auth,
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
import { BruParseError } from './bru-lang'
import { readBruFile, readCollectionBru, writeBruFiles } from './bruno-bru'
import {
  asArray,
  asString,
  buildTree,
  emptyPart,
  isObject,
  type BrunoCollectionData,
  type BrunoFile,
  type BrunoFolderItem,
  type BrunoItem,
  type BrunoPair,
  type BrunoRequestItem,
  type BrunoRequestPart,
  type Json
} from './bruno-model'
import { YamlError, readOpenCollection, readYamlFile, writeYamlFiles } from './bruno-yaml'
import type {
  PortableCollection,
  PortableContainer,
  PortableEnvironment,
  PortableItem
} from './portable'
import { TransferError } from './postman'
import { TransferWarnings } from './warnings'

export { safeName } from './bruno-bru'

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

/** `scripts.flow` of bruno.json / opencollection.yml / the exported JSON's brunoConfig. */
function flowOf(scripts: unknown): 'sequential' | 'sandwich' | undefined {
  const flow = isObject(scripts) ? scripts.flow : undefined
  return flow === 'sequential' || flow === 'sandwich' ? flow : undefined
}

function normalizeJson(json: Json): BrunoCollectionData {
  const root = isObject(json.root) && isObject(json.root.request) ? json.root.request : null
  const config = isObject(json.brunoConfig) ? json.brunoConfig : {}
  const flow = flowOf(config.scripts)
  return {
    ...(flow ? { scriptFlow: flow } : {}),
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
// Collection folders (.bru or OpenCollection .yml files)
// ---------------------------------------------------------------------------------

/** Files that mark the top folder of a Bruno collection. */
export const BRUNO_COLLECTION_FILES = ['bruno.json', 'opencollection.yml'] as const

/** Files read from a Bruno folder (everything else is left alone). */
export const isBrunoFilePath = (path: string): boolean =>
  /\.(bru|ya?ml)$/i.test(path) || path === 'bruno.json'

function guard<T>(path: string, read: () => T): T {
  try {
    return read()
  } catch (error) {
    if (error instanceof YamlError) throw new TransferError(error.message)
    if (error instanceof BruParseError) throw new TransferError(`${path}：${error.message}`)
    throw error
  }
}

/**
 * A Bruno folder as `{ relative path: content }` (forward slashes). With bruno.json it
 * is a `.bru` collection, with opencollection.yml a YAML one; with neither it is a
 * folder inside a collection, imported on its own (named after its folder file, or
 * `folderName`).
 */
export function brunoFolderToData(
  files: Readonly<Record<string, string>>,
  folderName = ''
): BrunoCollectionData {
  let name = ''
  let root: BrunoRequestPart | null = null
  const items: BrunoItem[] = []
  const environments: BrunoCollectionData['environments'] = []
  let format: 'bru' | 'yaml' | null = null
  let flow: 'sequential' | 'sandwich' | undefined
  const yaml = files['opencollection.yml']
  const config = files['bruno.json']
  if (yaml !== undefined) {
    format = 'yaml'
    const oc = guard('opencollection.yml', () => readOpenCollection(yaml))
    name = oc.name
    flow = oc.scriptFlow
    root = oc.root
    items.push(...oc.items)
    environments.push(...oc.environments)
  } else if (config !== undefined) {
    format = 'bru'
    try {
      const parsed = JSON.parse(config) as Json
      name = asString(parsed.name)
      flow = flowOf(parsed.scripts)
    } catch {
      throw new TransferError('bruno.json 不是有效的 JSON')
    }
    const collectionBru = files['collection.bru']
    if (collectionBru !== undefined) {
      root = guard('collection.bru', () => readCollectionBru(collectionBru))
    }
  }

  const parsed: [string, BrunoFile][] = []
  for (const [path, text] of Object.entries(files)) {
    if (path === 'bruno.json' || path === 'opencollection.yml' || path === 'collection.bru')
      continue
    // A collection uses one file format; other files (CI configs…) are not part of it.
    if (/\.bru$/i.test(path) && format !== 'yaml') {
      parsed.push([path, guard(path, () => readBruFile(path, text))])
    } else if (/\.ya?ml$/i.test(path) && format !== 'bru') {
      parsed.push([path, guard(path, () => readYamlFile(path, text))])
    }
  }
  const tree = buildTree(parsed)
  items.push(...tree.items)
  environments.push(...tree.environments)
  if (format === null) {
    if (!tree.top && tree.items.length === 0) {
      throw new TransferError('找不到 Bruno 的檔案（bruno.json、opencollection.yml、.bru 或 .yml）')
    }
    name = tree.top?.name || folderName
    root = tree.top?.part ?? null
  }
  return {
    name,
    items,
    root,
    environments,
    partial: format === null,
    ...(flow ? { scriptFlow: flow } : {})
  }
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
    docs: r.docs,
    // OpenCollection YAML only: 0 means no timeout in Bruno.
    settings: {
      ...(r.settings?.timeout !== undefined && r.settings.timeout > 0
        ? { timeoutMs: Math.min(r.settings.timeout, 3_600_000) }
        : {}),
      ...(r.settings?.followRedirects !== undefined
        ? { followRedirects: r.settings.followRedirects }
        : {})
    }
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
  if (data.partial) {
    warnings.add(
      '選的是 Collection 裡面的資料夾：只匯入這個資料夾，上層的 Headers / Auth / 變數 / 環境沒有匯入'
    )
  }
  const name = itemName(data.name, 'Bruno Collection')
  const collection: PortableCollection = {
    name,
    headers: (root?.headers ?? []).map((p) => kv(ctx, p)),
    auth: root?.auth
      ? mapAuth(root.auth as BrunoRequestPart['auth'], { type: 'none' }, '', ctx)
      : { type: 'none' },
    variables,
    // Bruno's default flow is sandwich (decision 126).
    scriptFlow: data.scriptFlow ?? 'sandwich',
    scripts: containerScripts(root, '', ctx),
    children: mapItems(data.items, [], ctx)
  }
  // Hachi environments are shared by the Workspace: name them after the collection.
  const environments: PortableEnvironment[] = data.environments.map((env) => ({
    name: itemName(`${name} / ${env.name || 'Environment'}`, 'Environment'),
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

/** `folderName` names a folder imported on its own when its folder file has no name. */
export function importBrunoFolder(
  files: Readonly<Record<string, string>>,
  newId: () => string = defaultId,
  folderName = ''
): BrunoImport {
  return mapCollection(brunoFolderToData(files, folderName), newId)
}

// ---------------------------------------------------------------------------------
// Export: portable → Bruno model → .bru or .yml files
// ---------------------------------------------------------------------------------

export type BrunoFileFormat = 'bru' | 'yaml'

export interface BrunoExport {
  /** Relative path → content. */
  files: Record<string, string>
  skipped: string[]
  warnings: string[]
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

const bodyPath = (path: string) =>
  path === '' ? 'res.body' : `res.body${path.startsWith('[') ? '' : '.'}${path}`

function assertionOut(a: Assertion): BrunoPair | null {
  const left =
    a.target === 'status'
      ? 'res.status'
      : a.target === 'responseTime'
        ? 'res.responseTime'
        : a.target === 'header'
          ? `res.headers.${a.path.toLowerCase()}`
          : a.target === 'body'
            ? 'res.body'
            : bodyPath(a.path)
  let right: string | undefined
  if (a.operator === 'isType') {
    right = {
      number: 'isNumber',
      string: 'isString',
      boolean: 'isBoolean',
      array: 'isArray',
      object: 'isJson',
      null: 'isNull'
    }[a.expected.trim()]
  } else {
    const op = OP_BACK[a.operator]
    if (op) right = op === 'isDefined' || op === 'isUndefined' ? op : `${op} ${a.expected}`
  }
  return right ? { name: left, value: right, enabled: a.enabled } : null
}

function authOut(auth: Auth): BrunoRequestPart['auth'] {
  switch (auth.type) {
    case 'inherit':
    case 'none':
      return { mode: auth.type }
    case 'bearer':
      return { mode: 'bearer', bearer: { token: auth.token } }
    case 'basic':
      return { mode: 'basic', basic: { username: auth.username, password: auth.password } }
    case 'apiKey':
      return {
        mode: 'apikey',
        apikey: {
          key: auth.key,
          value: auth.value,
          placement: auth.in === 'query' ? 'queryparams' : 'header'
        }
      }
  }
}

const pairsOut = (rows: readonly KeyValue[]): BrunoPair[] =>
  rows.map((r) => ({ name: r.key, value: r.value, enabled: r.enabled }))

function containerPart(container: PortableContainer): BrunoRequestPart {
  const part = emptyPart()
  part.headers = pairsOut(container.headers)
  part.auth = authOut(container.auth)
  part.script = {
    req: container.scripts?.preRequest ?? '',
    res: container.scripts?.postResponse ?? ''
  }
  return part
}

function bodyOut(b: HttpBody): BrunoRequestPart['body'] {
  switch (b.mode) {
    case 'json':
      return { mode: 'json', json: b.json }
    case 'raw':
      return /xml/i.test(b.rawContentType)
        ? { mode: 'xml', xml: b.raw }
        : { mode: 'text', text: b.raw }
    case 'urlencoded':
      return { mode: 'formUrlEncoded', formUrlEncoded: pairsOut(b.urlencoded) }
    case 'formData':
      return {
        mode: 'multipartForm',
        multipartForm: b.formData.map((f) => ({
          name: f.key,
          value: f.type === 'file' ? f.filePath : f.value,
          enabled: f.enabled,
          type: f.type
        }))
      }
    default:
      return { mode: 'none' }
  }
}

function requestPart(
  request: HttpRequest,
  format: BrunoFileFormat,
  where: string,
  warnings: TransferWarnings
): BrunoRequestPart {
  const part = emptyPart()
  part.url = request.url
  part.method = request.method
  part.params = request.params.map((p) => ({ ...pairsOut([p])[0]!, type: 'query' as const }))
  part.headers = pairsOut(request.headers)
  part.body = bodyOut(request.body)
  part.auth = authOut(request.auth)
  part.vars.res = request.extractions
    .filter((e) => e.variable.trim() !== '')
    .map((e) => ({
      name: e.variable,
      value:
        e.source === 'status'
          ? 'res.status'
          : e.source === 'header'
            ? `res.headers[${JSON.stringify(e.path.toLowerCase())}]`
            : e.source === 'jsonBody'
              ? bodyPath(e.path)
              : 'res.body',
      enabled: e.enabled
    }))
  if (request.extractions.some((e) => e.source === 'body' && e.path.trim() !== '')) {
    warnings.add('用 Regex 擷取 Body 的列 Bruno 不支援，已改為整個 Body', where)
  }
  if (request.extractions.some((e) => e.scope === 'environment')) {
    warnings.add('存到環境的擷取在 Bruno 會變成暫存變數', where)
  }
  const asserts = request.assertions.map(assertionOut)
  if (asserts.some((a) => a === null)) warnings.add('部分斷言 Bruno 沒有對應寫法，已略過', where)
  part.assertions = asserts.filter((a): a is BrunoPair => a !== null)
  part.script = { req: request.scripts.preRequest, res: request.scripts.postResponse }
  if (/\bhachi\./.test(request.scripts.preRequest + request.scripts.postResponse)) {
    warnings.add('腳本使用了 hachi.* 寫法，Bruno 無法執行，請改成 bru / req / res', where)
  }
  part.docs = request.docs
  const { timeoutMs, validateSSL, followRedirects } = request.settings
  if (format === 'yaml') {
    if (timeoutMs !== null || followRedirects !== null) {
      part.settings = {
        ...(timeoutMs !== null ? { timeout: timeoutMs } : {}),
        ...(followRedirects !== null ? { followRedirects } : {})
      }
    }
    if (validateSSL !== null) warnings.add('請求的 SSL 設定 Bruno 沒有對應，未匯出', where)
  } else if (timeoutMs !== null || validateSSL !== null || followRedirects !== null) {
    warnings.add('請求的逾時 / SSL / 轉址設定 Bruno 的 .bru 檔沒有對應，未匯出', where)
  }
  return part
}

/**
 * A Collection as a Bruno collection folder (`.bru` or OpenCollection `.yml` files),
 * with the Workspace environments (secret values left out, as in Bruno).
 */
export function exportBrunoCollection(
  collection: PortableCollection,
  environments: readonly PortableEnvironment[],
  format: BrunoFileFormat = 'bru'
): BrunoExport {
  const warnings = new TransferWarnings()
  const skipped: string[] = []

  const root = containerPart(collection)
  const vars = collection.variables.filter((v) => v.key.trim() !== '')
  if (vars.some((v) => v.secret)) warnings.add('機密的 Collection 變數不會匯出值（已留空）')
  root.vars.req = vars.map((v) => ({
    name: v.key,
    value: v.secret ? '' : v.value,
    enabled: v.enabled
  }))

  const itemsOf = (container: PortableContainer, trail: string[]): BrunoItem[] =>
    container.children.flatMap((child, index): BrunoItem[] => {
      if (child.kind === 'folder') {
        return [
          {
            type: 'folder',
            name: child.name,
            seq: index + 1,
            items: itemsOf(child, [...trail, child.name]),
            root: containerPart(child)
          }
        ]
      }
      const where = [...trail, child.request.name].join(' / ')
      if (child.request.type !== 'http') {
        skipped.push(where)
        return []
      }
      return [
        {
          type: 'http',
          name: child.request.name,
          seq: index + 1,
          request: requestPart(child.request, format, where, warnings)
        }
      ]
    })

  // Imported environments are named "<Collection> / <name>" (decision 107): drop the prefix.
  const prefix = `${collection.name} / `
  const envs = environments.map((env) => ({
    name: env.name.startsWith(prefix) ? env.name.slice(prefix.length) : env.name,
    variables: env.variables
      .filter((v) => v.key.trim() !== '')
      .map((v) => ({
        name: v.key,
        value: v.secret ? '' : v.value,
        enabled: v.enabled,
        secret: v.secret
      }))
  }))
  if (envs.some((e) => e.variables.some((v) => v.secret))) {
    warnings.add('環境的機密變數只匯出名稱（Bruno 也不把值存在檔案中）')
  }
  const data: BrunoCollectionData = {
    name: collection.name,
    scriptFlow: collection.scriptFlow ?? 'sequential',
    items: itemsOf(collection, []),
    root,
    environments: envs
  }
  return {
    files: format === 'yaml' ? writeYamlFiles(data) : writeBruFiles(data),
    skipped,
    warnings: warnings.list()
  }
}
