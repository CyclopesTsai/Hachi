/**
 * OpenAPI 3.0 document of a Collection (decision 105), and the self-contained HTML page
 * that shows it with Redoc. Pure: the Redoc bundle is passed in by main.
 *
 * Mapping: folders → tags, the `{{baseUrl}}` / `https://host` prefix → servers,
 * `{{x}}` and `:x` path segments → path parameters, JSON bodies → example + inferred
 * schema, auth → securitySchemes, `status eq N` assertions → documented responses.
 */
import type { Auth, KeyValue } from '../schemas/collection'
import type { HttpBody, HttpRequest } from '../schemas/http-request'
import type { PortableCollection, PortableContainer } from './portable'
import { TransferWarnings } from './warnings'

type Json = Record<string, unknown>

export interface OpenApiExport {
  document: Json
  /** WebSocket requests (OpenAPI describes HTTP only). */
  skipped: string[]
  warnings: string[]
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error'
}

/** Headers OpenAPI describes elsewhere (security, request body, responses). */
const IMPLIED_HEADERS = new Set(['authorization', 'content-type', 'accept'])

const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Replaces `{{name}}` with known values; unknown names stay as they are. */
function resolve(text: string, values: Record<string, string>): string {
  let out = text
  for (let depth = 0; depth < 10 && /\{\{[^{}]+\}\}/.test(out); depth++) {
    const next = out.replace(VARIABLE, (whole, name: string) => values[name] ?? whole)
    if (next === out) break
    out = next
  }
  return out
}

/** JSON Schema of an example value (types and properties only). */
export function inferSchema(value: unknown, depth = 0): Json {
  if (depth > 20) return {}
  if (value === null) return { nullable: true }
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferSchema(value[0], depth + 1) : {} }
  }
  switch (typeof value) {
    case 'string':
      return { type: 'string' }
    case 'boolean':
      return { type: 'boolean' }
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' }
    case 'object': {
      const properties: Json = {}
      for (const [k, v] of Object.entries(value as Json)) properties[k] = inferSchema(v, depth + 1)
      return { type: 'object', properties }
    }
    default:
      return {}
  }
}

/** `{{baseUrl}}/a` → [`{{baseUrl}}`, `/a`]; `https://h:1/a?b` → [`https://h:1`, `/a`]. */
function splitUrl(url: string): { server: string; path: string; query: [string, string][] } {
  const [beforeHash = ''] = url.trim().split('#')
  const q = beforeHash.indexOf('?')
  const base = q < 0 ? beforeHash : beforeHash.slice(0, q)
  const query: [string, string][] = []
  if (q >= 0) {
    for (const part of beforeHash.slice(q + 1).split('&')) {
      if (part === '') continue
      const eq = part.indexOf('=')
      query.push(eq < 0 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)])
    }
  }
  const prefix = /^(\{\{[^{}]+\}\}|[a-z][a-z0-9+.-]*:\/\/[^/]*)/i.exec(base)
  const server = prefix?.[1] ?? ''
  let path = base.slice(server.length)
  if (!path.startsWith('/')) path = `/${path}`
  return { server, path, query }
}

interface Ctx {
  values: Record<string, string>
  warnings: TransferWarnings
  schemes: Json
  tags: string[]
}

function securityOf(auth: Auth, ctx: Ctx): Json[] | null {
  switch (auth.type) {
    case 'none':
      return []
    case 'bearer':
      ctx.schemes.bearerAuth = { type: 'http', scheme: 'bearer' }
      return [{ bearerAuth: [] }]
    case 'basic':
      ctx.schemes.basicAuth = { type: 'http', scheme: 'basic' }
      return [{ basicAuth: [] }]
    case 'apiKey': {
      const name = `apiKey_${auth.in}_${auth.key.replace(/[^\w.-]/g, '_') || 'key'}`
      ctx.schemes[name] = {
        type: 'apiKey',
        in: auth.in === 'query' ? 'query' : 'header',
        name: auth.key
      }
      return [{ [name]: [] }]
    }
    default:
      return null
  }
}

function requestBody(body: HttpBody, where: string, ctx: Ctx): Json | null {
  switch (body.mode) {
    case 'json': {
      let example: unknown
      try {
        example = JSON.parse(body.json)
      } catch {
        ctx.warnings.add('JSON Body 不是有效的 JSON（可能含有變數），只附上原文', where)
        return { content: { 'application/json': { example: body.json } } }
      }
      return { content: { 'application/json': { schema: inferSchema(example), example } } }
    }
    case 'raw':
      return {
        content: {
          [body.rawContentType || 'text/plain']: { schema: { type: 'string' }, example: body.raw }
        }
      }
    case 'urlencoded': {
      const fields = body.urlencoded.filter((f) => f.enabled && f.key !== '')
      const properties: Json = {}
      const example: Json = {}
      for (const f of fields) {
        properties[f.key] = { type: 'string' }
        example[f.key] = f.value
      }
      return {
        content: {
          'application/x-www-form-urlencoded': { schema: { type: 'object', properties }, example }
        }
      }
    }
    case 'formData': {
      const properties: Json = {}
      for (const f of body.formData.filter((x) => x.enabled && x.key !== '')) {
        properties[f.key] =
          f.type === 'file'
            ? { type: 'string', format: 'binary' }
            : { type: 'string', example: f.value }
      }
      return { content: { 'multipart/form-data': { schema: { type: 'object', properties } } } }
    }
    default:
      return null
  }
}

function headerParams(headers: KeyValue[]): Json[] {
  return headers
    .filter((h) => h.enabled && h.key.trim() !== '' && !IMPLIED_HEADERS.has(h.key.toLowerCase()))
    .map((h) => ({
      name: h.key,
      in: 'header',
      required: false,
      schema: { type: 'string' },
      example: h.value,
      ...(h.description ? { description: h.description } : {})
    }))
}

function responses(request: HttpRequest): Json {
  const codes = request.assertions
    .filter((a) => a.enabled && a.target === 'status' && a.operator === 'eq')
    .map((a) => Number(a.expected.trim()))
    .filter((n) => Number.isInteger(n) && n >= 100 && n <= 599)
  const out: Json = {}
  for (const code of [...new Set(codes)]) {
    out[String(code)] = { description: STATUS_TEXT[code] ?? 'Response' }
  }
  return Object.keys(out).length > 0 ? out : { default: { description: 'Response' } }
}

interface Operation {
  where: string
  path: string
  method: string
  server: string
  operation: Json
}

function operationOf(
  request: HttpRequest,
  folders: string[],
  inherited: { headers: KeyValue[]; auth: Auth },
  ctx: Ctx
): Operation | null {
  const where = [...folders, request.name].join(' / ')
  if (request.url.trim() === '') {
    ctx.warnings.add('沒有網址，未匯出', where)
    return null
  }
  const split = splitUrl(request.url)
  const server = split.server === '' ? '' : resolve(split.server, ctx.values)
  if (/\{\{[^{}]+\}\}/.test(server)) {
    ctx.warnings.add(`伺服器網址中的變數沒有值：${server}（可在匯出時選擇環境）`)
  }

  // {{id}} and :id segments become {id}.
  const parameters: Json[] = []
  const pathNames = new Set<string>()
  const addPathParam = (name: string, example?: string) => {
    if (pathNames.has(name)) return
    pathNames.add(name)
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      ...(example !== undefined && example !== '' ? { example } : {})
    })
  }
  const path = split.path
    .replace(VARIABLE, (_, name: string) => {
      const clean = name.replace(/^\$/, '')
      addPathParam(clean, ctx.values[name])
      return `{${clean}}`
    })
    .replace(/(^|\/):([A-Za-z_][\w-]*)/g, (_, slash: string, name: string) => {
      addPathParam(name)
      return `${slash}{${name}}`
    })

  const query = new Map<string, Json>()
  for (const [key, value] of split.query) {
    query.set(key, {
      name: key,
      in: 'query',
      required: false,
      schema: { type: 'string' },
      example: value
    })
  }
  for (const p of request.params.filter((x) => x.key.trim() !== '')) {
    query.set(p.key, {
      name: p.key,
      in: 'query',
      required: false,
      schema: { type: 'string' },
      ...(p.value !== '' ? { example: p.value } : {}),
      ...(p.description ? { description: p.description } : {})
    })
  }
  parameters.push(...query.values())
  const headerNames = new Set(request.headers.map((h) => h.key.toLowerCase()))
  parameters.push(
    ...headerParams(inherited.headers.filter((h) => !headerNames.has(h.key.toLowerCase()))),
    ...headerParams(request.headers)
  )

  const operation: Json = { summary: request.name }
  if (folders.length > 0) {
    const tag = folders.join(' / ')
    if (!ctx.tags.includes(tag)) ctx.tags.push(tag)
    operation.tags = [tag]
  }
  if (request.docs.trim() !== '') operation.description = request.docs
  if (parameters.length > 0) operation.parameters = parameters
  if (!['GET', 'HEAD'].includes(request.method)) {
    const body = requestBody(request.body, where, ctx)
    if (body) operation.requestBody = body
  }
  const auth = request.auth.type === 'inherit' ? inherited.auth : request.auth
  const security = securityOf(auth, ctx)
  if (security) operation.security = security
  operation.responses = responses(request)
  return { where, path, method: request.method.toLowerCase(), server, operation }
}

function collect(
  container: PortableContainer,
  folders: string[],
  inherited: { headers: KeyValue[]; auth: Auth },
  ctx: Ctx,
  out: { operations: Operation[]; skipped: string[] }
): void {
  for (const child of container.children) {
    if (child.kind === 'folder') {
      const names = new Set(child.headers.map((h) => h.key.toLowerCase()))
      collect(
        child,
        [...folders, child.name],
        {
          headers: [
            ...inherited.headers.filter((h) => !names.has(h.key.toLowerCase())),
            ...child.headers
          ],
          auth: child.auth.type === 'inherit' ? inherited.auth : child.auth
        },
        ctx,
        out
      )
    } else if (child.request.type === 'http') {
      const op = operationOf(child.request, folders, inherited, ctx)
      if (op) out.operations.push(op)
    } else {
      out.skipped.push(child.request.name)
    }
  }
}

/**
 * @param values variable values for server URLs and path examples (collection variables
 *   overridden by the chosen environment; secrets left out by the caller)
 */
export function buildOpenApi(
  collection: PortableCollection,
  values: Record<string, string> = {}
): OpenApiExport {
  const ctx: Ctx = { values, warnings: new TransferWarnings(), schemes: {}, tags: [] }
  const out = { operations: [] as Operation[], skipped: [] as string[] }
  collect(collection, [], { headers: collection.headers, auth: collection.auth }, ctx, out)

  // The most common server goes on the document; others on their operations.
  const counts = new Map<string, number>()
  for (const op of out.operations) {
    if (op.server !== '') counts.set(op.server, (counts.get(op.server) ?? 0) + 1)
  }
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  const paths: Record<string, Json> = {}
  for (const op of out.operations) {
    const item = (paths[op.path] ??= {})
    if (item[op.method]) {
      const first = (item[op.method] as Json).summary as string
      ctx.warnings.add(
        `與「${first}」的路徑和方法相同（${op.method.toUpperCase()} ${op.path}），未匯出`,
        op.where
      )
      continue
    }
    if (op.server !== '' && op.server !== main) op.operation.servers = [{ url: op.server }]
    item[op.method] = op.operation
  }

  const document: Json = {
    openapi: '3.0.3',
    info: { title: collection.name, version: '1.0.0' },
    ...(main ? { servers: [{ url: main }] } : {}),
    ...(ctx.tags.length > 0 ? { tags: ctx.tags.map((name) => ({ name })) } : {}),
    paths,
    ...(Object.keys(ctx.schemes).length > 0 ? { components: { securitySchemes: ctx.schemes } } : {})
  }
  return { document, skipped: out.skipped, warnings: ctx.warnings.list() }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/**
 * A single offline HTML file: the Redoc standalone bundle and the document inline.
 * `<!--` / `<script` / `</script` inside the bundle only occur in strings and regular
 * expressions, so `\x3C` keeps their meaning while the HTML parser ignores them.
 */
export function openApiHtml(document: Json, redoc: { bundle: string; licenses: string }): string {
  const title = String((document.info as Json | undefined)?.title ?? 'API')
  const bundle = redoc.bundle
    .replace(/^\/\*! For license information[^\n]*\*\/\n?/, '')
    .replace(/<(?=!--|\/?script)/gi, '\\x3C')
  const licenses = redoc.licenses.replace(/\*\//g, '* /')
  const spec = JSON.stringify(document).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Hachi">
<title>${escapeHtml(title)}</title>
<style>body { margin: 0; padding: 0; }</style>
</head>
<body>
<div id="redoc"></div>
<script>
/*
${licenses}
*/
${bundle}
</script>
<script>
Redoc.init(${spec}, { theme: { colors: { primary: { main: '#4c6e98' } } } }, document.getElementById('redoc'))
</script>
</body>
</html>
`
}
