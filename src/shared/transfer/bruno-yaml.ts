/**
 * Bruno collections in OpenCollection YAML (Bruno 3+, decision 107): opencollection.yml,
 * folder.yml, one `.yml` per request, environments/*.yml ↔ the shared Bruno model.
 * Field names follow https://docs.usebruno.com/opencollection-yaml/structure-reference.
 */
import { parse, stringify } from 'yaml'
import {
  asArray,
  asString,
  emptyPart,
  isObject,
  type BrunoCollectionData,
  type BrunoEnvironment,
  type BrunoFile,
  type BrunoItem,
  type BrunoPair,
  type BrunoRequestPart,
  type Json
} from './bruno-model'
import { safeName, uniqueIn } from './bruno-bru'

export class YamlError extends Error {}

function parseYaml(path: string, text: string): Json {
  let doc: unknown
  try {
    doc = parse(text) as unknown
  } catch (error) {
    throw new YamlError(`${path}：${error instanceof Error ? error.message : String(error)}`)
  }
  return isObject(doc) ? doc : {}
}

/** `description` / `docs` may be a string or `{ content }`. */
const textOf = (v: unknown): string => (isObject(v) ? asString(v.content) : asString(v))

/** Variable values may be typed: `{ type: number, data: "3" }`. */
const valueOf = (v: unknown): string =>
  isObject(v) && 'data' in v ? asString(v.data) : asString(v)

const pairs = (list: unknown): BrunoPair[] =>
  asArray(list)
    .filter(isObject)
    .map((p) => ({ name: asString(p.name), value: valueOf(p.value), enabled: p.disabled !== true }))

function readAuth(raw: unknown, missing: string): BrunoRequestPart['auth'] {
  if (raw === undefined || raw === null) return { mode: missing }
  if (raw === 'inherit') return { mode: 'inherit' }
  if (!isObject(raw)) return { mode: missing }
  const type = asString(raw.type)
  switch (type) {
    case 'bearer':
      return { mode: 'bearer', bearer: { token: asString(raw.token) } }
    case 'basic':
      return {
        mode: 'basic',
        basic: { username: asString(raw.username), password: asString(raw.password) }
      }
    case 'apikey':
      return {
        mode: 'apikey',
        apikey: {
          key: asString(raw.key),
          value: asString(raw.value),
          placement: asString(raw.placement) === 'query' ? 'queryparams' : 'header'
        }
      }
    default:
      return { mode: type || 'none' }
  }
}

function readBody(raw: unknown, part: BrunoRequestPart): void {
  if (!isObject(raw)) return
  const type = asString(raw.type)
  switch (type) {
    case 'json':
    case 'text':
    case 'xml':
      part.body = { mode: type, [type]: asString(raw.data) }
      return
    case 'form-urlencoded':
      part.body = { mode: 'formUrlEncoded', formUrlEncoded: pairs(raw.data) }
      return
    case 'multipart-form':
      part.body = {
        mode: 'multipartForm',
        multipartForm: asArray(raw.data)
          .filter(isObject)
          .map((f) => {
            const file = asString(f.type) === 'file'
            return {
              name: asString(f.name),
              value: file
                ? asArray(f.value).map(asString).join('|') || asString(f.value)
                : valueOf(f.value),
              enabled: f.disabled !== true,
              type: file ? ('file' as const) : ('text' as const)
            }
          })
      }
      return
    default:
      part.body = { mode: type || 'none' }
  }
}

/** `request` defaults of opencollection.yml / folder.yml, and `runtime` of requests. */
function readRuntime(raw: Json, part: BrunoRequestPart): void {
  part.vars.req = pairs(raw.variables)
  part.vars.res = asArray(raw.actions)
    .filter(isObject)
    .filter((a) => asString(a.type) === 'set-variable' && asString(a.phase) !== 'before-request')
    .map((a) => ({
      name: asString(isObject(a.variable) ? a.variable.name : ''),
      value: asString(isObject(a.selector) ? a.selector.expression : ''),
      enabled: a.disabled !== true
    }))
  for (const s of asArray(raw.scripts).filter(isObject)) {
    const code = asString(s.code)
    if (s.type === 'before-request') part.script.req = code
    else if (s.type === 'after-response') part.script.res = code
    else if (s.type === 'tests') part.tests = code
  }
  part.assertions = asArray(raw.assertions)
    .filter(isObject)
    .map((a) => {
      const operator = asString(a.operator)
      const value = a.value === undefined || a.value === null ? '' : valueOf(a.value)
      return {
        name: asString(a.expression),
        value: value === '' ? operator : `${operator} ${value}`,
        enabled: a.disabled !== true
      }
    })
}

/** Headers, auth, variables and scripts shared by a collection or folder. */
function readDefaults(raw: unknown, missingAuth: string): BrunoRequestPart {
  const part = emptyPart()
  const r = isObject(raw) ? raw : {}
  part.headers = pairs(r.headers)
  part.auth = readAuth(r.auth, missingAuth)
  readRuntime(r, part)
  return part
}

function readRequest(doc: Json, fallbackName: string): BrunoFile {
  const info = isObject(doc.info) ? doc.info : {}
  const type = asString(info.type) || 'http'
  const section = isObject(doc[type]) ? (doc[type] as Json) : isObject(doc.http) ? doc.http : {}
  const part = emptyPart()
  part.url = asString(section.url)
  part.method = asString(section.method).toUpperCase() || (type === 'graphql' ? 'POST' : 'GET')
  part.headers = pairs(section.headers)
  part.params = asArray(section.params)
    .filter(isObject)
    .map((p) => ({ ...pairs([p])[0]!, type: asString(p.type) === 'path' ? 'path' : 'query' }))
  // A request without `auth` uses none (Bruno writes `auth: inherit` explicitly).
  part.auth = readAuth(section.auth, 'none')
  if (type === 'graphql') {
    const body = isObject(section.body) ? section.body : {}
    const variables = body.variables
    part.body = {
      mode: 'graphql',
      graphql: {
        query: asString(body.query),
        variables:
          typeof variables === 'string' ? variables : variables ? JSON.stringify(variables) : ''
      }
    }
  } else {
    readBody(section.body, part)
  }
  readRuntime(isObject(doc.runtime) ? doc.runtime : {}, part)
  part.docs = textOf(doc.docs)
  const settings = isObject(doc.settings) ? doc.settings : {}
  if (typeof settings.timeout === 'number' || typeof settings.followRedirects === 'boolean') {
    part.settings = {
      ...(typeof settings.timeout === 'number' ? { timeout: settings.timeout } : {}),
      ...(typeof settings.followRedirects === 'boolean'
        ? { followRedirects: settings.followRedirects }
        : {})
    }
  }
  return {
    kind: 'request',
    item: {
      type,
      name: asString(info.name) || fallbackName,
      seq: typeof info.seq === 'number' ? info.seq : Number.MAX_SAFE_INTEGER,
      request: part
    }
  }
}

function readEnvironment(doc: Json, fallbackName: string): BrunoEnvironment {
  return {
    name: asString(doc.name) || fallbackName,
    variables: asArray(doc.variables)
      .filter(isObject)
      .map((v) =>
        v.secret === true
          ? { name: asString(v.name), value: '', enabled: v.disabled !== true, secret: true }
          : {
              name: asString(v.name),
              value: valueOf(v.value),
              enabled: v.disabled !== true,
              secret: false
            }
      )
  }
}

/** opencollection.yml: name, collection defaults, docs, and inline items if bundled. */
export function readOpenCollection(text: string): {
  name: string
  root: BrunoRequestPart
  items: BrunoItem[]
  environments: BrunoEnvironment[]
} {
  const doc = parseYaml('opencollection.yml', text)
  const info = isObject(doc.info) ? doc.info : {}
  const root = readDefaults(doc.request, 'none')
  root.docs = textOf(doc.docs)
  const bundledItems = (list: unknown): BrunoItem[] =>
    asArray(list)
      .filter(isObject)
      .map((raw, index): BrunoItem | null => {
        const itemInfo = isObject(raw.info) ? raw.info : {}
        if (asString(itemInfo.type) === 'folder') {
          return {
            type: 'folder',
            name: asString(itemInfo.name) || 'Folder',
            seq: typeof itemInfo.seq === 'number' ? itemInfo.seq : index + 1,
            items: bundledItems(raw.items),
            root: readDefaults(raw.request, 'inherit')
          }
        }
        const file = readRequest(raw, 'Untitled')
        return file.kind === 'request' ? file.item : null
      })
      .filter((i): i is BrunoItem => i !== null)
  return {
    name: asString(info.name),
    root,
    items: bundledItems(doc.items),
    environments: asArray(isObject(doc.config) ? doc.config.environments : undefined)
      .filter(isObject)
      .map((env) => readEnvironment(env, 'Environment'))
  }
}

/** Any other .yml file of a collection folder (`path` relative to the collection). */
export function readYamlFile(path: string, text: string): BrunoFile {
  const slash = path.lastIndexOf('/')
  const dir = slash < 0 ? '' : path.slice(0, slash)
  const base = path.slice(slash + 1).replace(/\.ya?ml$/, '')
  const doc = parseYaml(path, text)
  if (dir === 'environments') {
    return { kind: 'environment', environment: readEnvironment(doc, base) }
  }
  const info = isObject(doc.info) ? doc.info : null
  if (base === 'folder' || asString(info?.type) === 'folder') {
    return {
      kind: 'folder',
      name: asString(info?.name),
      seq: typeof info?.seq === 'number' ? info.seq : null,
      // Folders without `auth` pass the collection's auth down.
      part: Object.assign(readDefaults(doc.request, 'inherit'), { docs: textOf(doc.docs) })
    }
  }
  // Other YAML files (CI config, OpenAPI specs…) are not requests.
  if (!info || !isObject(doc[asString(info.type) || 'http'])) return { kind: 'ignore' }
  return readRequest(doc, base)
}

// ---------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------

const toYaml = (doc: Json) => stringify(doc, { lineWidth: 0 })

/** Drops empty arrays / undefined so the files stay short. */
function compact(doc: Json): Json {
  const out: Json = {}
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue
    if (isObject(v)) {
      const inner = compact(v)
      if (Object.keys(inner).length > 0) out[k] = inner
    } else out[k] = v
  }
  return out
}

const pairsOut = (list: readonly BrunoPair[]) =>
  list
    .filter((p) => p.name.trim() !== '')
    .map((p) => ({ name: p.name, value: p.value, ...(p.enabled ? {} : { disabled: true }) }))

function authOut(auth: BrunoRequestPart['auth']): unknown {
  switch (auth.mode) {
    case 'inherit':
      return 'inherit'
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
        type: 'apikey',
        key: auth.apikey?.key ?? '',
        value: auth.apikey?.value ?? '',
        placement: auth.apikey?.placement === 'queryparams' ? 'query' : 'header'
      }
    default:
      return undefined
  }
}

function bodyOut(body: BrunoRequestPart['body']): unknown {
  switch (body.mode) {
    case 'json':
    case 'text':
    case 'xml':
      return { type: body.mode, data: body[body.mode] ?? '' }
    case 'formUrlEncoded':
      return { type: 'form-urlencoded', data: pairsOut(body.formUrlEncoded ?? []) }
    case 'multipartForm':
      return {
        type: 'multipart-form',
        data: (body.multipartForm ?? [])
          .filter((f) => f.name.trim() !== '')
          .map((f) => ({
            name: f.name,
            type: f.type,
            value: f.type === 'file' ? f.value.split('|').filter((p) => p !== '') : f.value,
            ...(f.enabled ? {} : { disabled: true })
          }))
      }
    default:
      return undefined
  }
}

/** variables / actions / scripts / assertions of a request, folder or collection. */
function runtimeOut(part: BrunoRequestPart): Json {
  const scripts = [
    ['before-request', part.script.req],
    ['after-response', part.script.res],
    ['tests', part.tests]
  ]
    .filter(([, code]) => (code ?? '').trim() !== '')
    .map(([type, code]) => ({ type, code }))
  return {
    variables: pairsOut(part.vars.req),
    actions: part.vars.res
      .filter((v) => v.name.trim() !== '')
      .map((v) => ({
        type: 'set-variable',
        phase: 'after-response',
        selector: { expression: v.value, method: 'jsonq' },
        variable: { name: v.name, scope: 'runtime' },
        ...(v.enabled ? {} : { disabled: true })
      })),
    scripts,
    assertions: part.assertions.map((a) => {
      const m = /^(\S+)\s*(.*)$/s.exec(a.value.trim())
      return {
        expression: a.name,
        operator: m?.[1] ?? a.value,
        ...(m?.[2] ? { value: m[2] } : {}),
        ...(a.enabled ? {} : { disabled: true })
      }
    })
  }
}

function defaultsOut(part: BrunoRequestPart | null): Json | undefined {
  if (!part) return undefined
  const runtime = runtimeOut(part)
  return {
    headers: pairsOut(part.headers),
    auth: part.auth.mode === 'none' ? undefined : authOut(part.auth),
    variables: runtime.variables,
    actions: runtime.actions,
    scripts: runtime.scripts
  }
}

function requestYaml(item: BrunoItem & { request: BrunoRequestPart }): string {
  const part = item.request
  const runtime = runtimeOut(part)
  return toYaml(
    compact({
      info: { name: item.name, type: 'http', seq: item.seq },
      http: {
        method: part.method,
        url: part.url,
        params: part.params
          .filter((p) => p.name.trim() !== '')
          .map((p) => ({
            name: p.name,
            value: p.value,
            type: p.type,
            ...(p.enabled ? {} : { disabled: true })
          })),
        headers: pairsOut(part.headers),
        body: bodyOut(part.body),
        auth: authOut(part.auth)
      },
      runtime,
      settings: part.settings
        ? {
            encodeUrl: true,
            ...(part.settings.timeout !== undefined ? { timeout: part.settings.timeout } : {}),
            ...(part.settings.followRedirects !== undefined
              ? { followRedirects: part.settings.followRedirects }
              : {})
          }
        : undefined,
      docs: part.docs.trim() === '' ? undefined : part.docs
    })
  )
}

function environmentYaml(env: BrunoEnvironment): string {
  return toYaml({
    name: env.name,
    variables: env.variables
      .filter((v) => v.name.trim() !== '')
      .map((v) =>
        v.secret
          ? { secret: true, name: v.name, ...(v.enabled ? {} : { disabled: true }) }
          : { name: v.name, value: v.value, ...(v.enabled ? {} : { disabled: true }) }
      )
  })
}

/** The files of an OpenCollection YAML collection folder, by relative path. */
export function writeYamlFiles(data: BrunoCollectionData): Record<string, string> {
  const files: Record<string, string> = {
    'opencollection.yml': toYaml(
      compact({
        opencollection: '1.0.0',
        info: { name: data.name },
        request: defaultsOut(data.root),
        bundled: false,
        extensions: { bruno: { ignore: ['node_modules', '.git'] } }
      })
    )
  }
  const walk = (items: BrunoItem[], dir: string) => {
    const taken = new Set<string>(['folder.yml', 'opencollection.yml', 'environments'])
    for (const item of items) {
      if (item.type === 'folder' && 'items' in item) {
        const name = uniqueIn(taken, safeName(item.name), '')
        const path = dir === '' ? name : `${dir}/${name}`
        files[`${path}/folder.yml`] = toYaml(
          compact({
            info: { name: item.name, type: 'folder', seq: item.seq },
            request: defaultsOut(item.root)
          })
        )
        walk(item.items, path)
      } else if ('request' in item) {
        const file = uniqueIn(taken, safeName(item.name), '.yml')
        files[dir === '' ? file : `${dir}/${file}`] = requestYaml(item)
      }
    }
  }
  walk(data.items, '')
  const envTaken = new Set<string>()
  for (const env of data.environments) {
    files[`environments/${uniqueIn(envTaken, safeName(env.name), '.yml')}`] = environmentYaml(env)
  }
  return files
}
