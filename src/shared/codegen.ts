/**
 * Code generation for an HTTP request (decision 69). Pure: main resolves the request
 * (variables, inherited headers / auth) into a CodegenRequest via `http:resolve`, the
 * renderer turns it into code for the chosen language.
 */

export const CODEGEN_LANGUAGES = [
  { id: 'curl', label: 'cURL', editorLanguage: 'text' },
  { id: 'fetch', label: 'JavaScript – fetch', editorLanguage: 'javascript' },
  { id: 'axios', label: 'JavaScript – axios', editorLanguage: 'javascript' },
  { id: 'python', label: 'Python – requests', editorLanguage: 'python' }
] as const
export type CodegenLanguage = (typeof CODEGEN_LANGUAGES)[number]['id']

export type CodegenFormField =
  { type: 'text'; key: string; value: string } | { type: 'file'; key: string; path: string }

export type CodegenBody =
  | { kind: 'none' }
  /** JSON or Raw text; the Content-Type header is already in `headers`. */
  | { kind: 'text'; text: string; json: boolean }
  | { kind: 'urlencoded'; fields: [string, string][] }
  /** The client sets the multipart Content-Type (with boundary) itself. */
  | { kind: 'formData'; fields: CodegenFormField[] }

export interface CodegenRequest {
  method: string
  /** Full URL: URL field + Params + API-key query, variables resolved. */
  url: string
  /** Request + inherited headers, auth headers (except Basic) and Content-Type. */
  headers: [string, string][]
  /** Basic auth is passed separately so each language can use its own helper. */
  basicAuth: { username: string; password: string } | null
  body: CodegenBody
  options: {
    validateSSL: boolean
    followRedirects: boolean
    maxRedirects: number
    /** 0 = no timeout. */
    timeoutMs: number
  }
}

/** Repeated header names are joined (`Cookie` with "; ", others with ", "). */
function headerObject(headers: [string, string][]): [string, string][] {
  const merged = new Map<string, [string, string]>()
  for (const [key, value] of headers) {
    const lower = key.toLowerCase()
    const existing = merged.get(lower)
    if (existing) existing[1] += (lower === 'cookie' ? '; ' : ', ') + value
    else merged.set(lower, [key, value])
  }
  return [...merged.values()]
}

const hasDuplicates = (keys: string[]) => new Set(keys).size !== keys.length

/** JSON text → value, or undefined when it is not JSON or would lose precision. */
function parseJsonSafely(text: string): unknown {
  // Integers beyond 2^53 change when parsed; keep such bodies as text.
  if (/\d{16,}/.test(text)) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p

// ---------------------------------------------------------------------------------
// cURL (POSIX shell quoting)
// ---------------------------------------------------------------------------------

export function shellQuote(text: string): string {
  if (/^[\w@%+=:,./-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function curl(r: CodegenRequest): string {
  const lines: string[] = []
  const hasBody = r.body.kind !== 'none'
  if (r.method === 'HEAD') lines.push(`curl --head ${shellQuote(r.url)}`)
  else if (r.method === 'GET' && !hasBody) lines.push(`curl ${shellQuote(r.url)}`)
  else lines.push(`curl -X ${r.method} ${shellQuote(r.url)}`)
  for (const [key, value] of r.headers) lines.push(`-H ${shellQuote(`${key}: ${value}`)}`)
  if (r.basicAuth) {
    lines.push(`-u ${shellQuote(`${r.basicAuth.username}:${r.basicAuth.password}`)}`)
  }
  switch (r.body.kind) {
    case 'text':
      lines.push(`--data-raw ${shellQuote(r.body.text)}`)
      break
    case 'urlencoded':
      for (const [key, value] of r.body.fields) {
        lines.push(`--data-urlencode ${shellQuote(`${key}=${value}`)}`)
      }
      break
    case 'formData':
      for (const f of r.body.fields) {
        if (f.type === 'text') lines.push(`--form-string ${shellQuote(`${f.key}=${f.value}`)}`)
        else {
          const quoted = f.path.replace(/(["\\])/g, '\\$1')
          lines.push(`-F ${shellQuote(`${f.key}=@"${quoted}"`)}`)
        }
      }
      break
  }
  if (!r.options.validateSSL) lines.push('--insecure')
  if (r.options.followRedirects) lines.push(`-L --max-redirs ${r.options.maxRedirects}`)
  if (r.options.timeoutMs > 0) lines.push(`--max-time ${r.options.timeoutMs / 1000}`)
  return lines.join(' \\\n  ')
}

// ---------------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------------

export function jsString(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(
      // eslint-disable-next-line no-control-regex -- escaping control characters on purpose
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
    )
  return `'${escaped}'`
}

const indent = (text: string, spaces: number) => text.replace(/\n/g, `\n${' '.repeat(spaces)}`)

const jsKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : jsString(key))

function jsObject(entries: [string, string][], spaces: number): string {
  if (entries.length === 0) return '{}'
  const pad = ' '.repeat(spaces + 2)
  return `{\n${entries.map(([k, v]) => `${pad}${jsString(k)}: ${v}`).join(',\n')}\n${' '.repeat(spaces)}}`
}

function jsHeaders(r: CodegenRequest, spaces: number, extra: [string, string][] = []): string {
  return jsObject(
    [...headerObject(r.headers).map(([k, v]): [string, string] => [k, jsString(v)]), ...extra],
    spaces
  )
}

function jsUrlEncoded(fields: [string, string][], spaces: number): string {
  if (hasDuplicates(fields.map(([k]) => k))) {
    const pad = ' '.repeat(spaces + 2)
    const rows = fields.map(([k, v]) => `${pad}[${jsString(k)}, ${jsString(v)}]`).join(',\n')
    return `new URLSearchParams([\n${rows}\n${' '.repeat(spaces)}])`
  }
  return `new URLSearchParams(${jsObject(
    fields.map(([k, v]): [string, string] => [k, jsString(v)]),
    spaces
  )})`
}

/** Statements building `form` (Node.js 20+: FormData + fs.openAsBlob). */
function jsFormData(fields: CodegenFormField[]): { imports: string[]; setup: string[] } {
  const setup = ['const form = new FormData();']
  let files = false
  for (const f of fields) {
    if (f.type === 'text') setup.push(`form.append(${jsString(f.key)}, ${jsString(f.value)});`)
    else {
      files = true
      setup.push(
        `form.append(${jsString(f.key)}, await openAsBlob(${jsString(f.path)}), ${jsString(basename(f.path))});`
      )
    }
  }
  return { imports: files ? ["import { openAsBlob } from 'node:fs';"] : [], setup }
}

function jsJsonValue(text: string): string | undefined {
  const value = parseJsonSafely(text)
  return value === undefined ? undefined : JSON.stringify(value, null, 2)
}

function fetchCode(r: CodegenRequest): string {
  const imports: string[] = []
  const setup: string[] = []
  const comments: string[] = []
  const options: [string, string][] = [['method', jsString(r.method)]]
  const extraHeaders: [string, string][] = []
  if (r.basicAuth) {
    extraHeaders.push([
      'Authorization',
      `'Basic ' + btoa(${jsString(`${r.basicAuth.username}:${r.basicAuth.password}`)})`
    ])
  }
  if (r.headers.length > 0 || extraHeaders.length > 0) {
    options.push(['headers', jsHeaders(r, 2, extraHeaders)])
  }
  switch (r.body.kind) {
    case 'text': {
      const json = r.body.json ? jsJsonValue(r.body.text) : undefined
      options.push(['body', json ? `JSON.stringify(${indent(json, 2)})` : jsString(r.body.text)])
      break
    }
    case 'urlencoded':
      options.push(['body', jsUrlEncoded(r.body.fields, 2)])
      break
    case 'formData': {
      const form = jsFormData(r.body.fields)
      imports.push(...form.imports)
      setup.push(...form.setup)
      options.push(['body', 'form'])
      break
    }
  }
  if (!r.options.followRedirects) options.push(['redirect', "'manual'"])
  if (r.options.timeoutMs > 0) {
    options.push(['signal', `AbortSignal.timeout(${r.options.timeoutMs})`])
  }
  if (!r.options.validateSSL) {
    comments.push(
      '// SSL verification is off in Hachi; fetch cannot turn it off per request',
      '// (Node.js: NODE_TLS_REJECT_UNAUTHORIZED=0 turns it off for the whole process).'
    )
  }
  const body = options.map(([k, v]) => `  ${k}: ${v}`).join(',\n')
  return [
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    ...comments,
    ...setup,
    ...(setup.length > 0 ? [''] : []),
    `const response = await fetch(${jsString(r.url)}, {\n${body}\n});`,
    '',
    'console.log(response.status);',
    'console.log(await response.text());'
  ].join('\n')
}

function axiosCode(r: CodegenRequest): string {
  const imports = ["import axios from 'axios';"]
  const setup: string[] = []
  const options: [string, string][] = [
    ['method', jsString(r.method.toLowerCase())],
    ['url', jsString(r.url)]
  ]
  if (r.headers.length > 0) options.push(['headers', jsHeaders(r, 2)])
  if (r.basicAuth) {
    options.push([
      'auth',
      `{ username: ${jsString(r.basicAuth.username)}, password: ${jsString(r.basicAuth.password)} }`
    ])
  }
  switch (r.body.kind) {
    case 'text': {
      const json = r.body.json ? jsJsonValue(r.body.text) : undefined
      options.push(['data', json ? indent(json, 2) : jsString(r.body.text)])
      break
    }
    case 'urlencoded':
      options.push(['data', jsUrlEncoded(r.body.fields, 2)])
      break
    case 'formData': {
      const form = jsFormData(r.body.fields)
      imports.push(...form.imports)
      setup.push(...form.setup)
      options.push(['data', 'form'])
      break
    }
  }
  if (!r.options.followRedirects) options.push(['maxRedirects', '0'])
  else options.push(['maxRedirects', String(r.options.maxRedirects)])
  if (r.options.timeoutMs > 0) options.push(['timeout', String(r.options.timeoutMs)])
  if (!r.options.validateSSL) {
    imports.push("import https from 'node:https';")
    options.push(['httpsAgent', 'new https.Agent({ rejectUnauthorized: false })'])
  }
  // Like Hachi: any status is a response, not an exception.
  options.push(['validateStatus', '() => true'])
  const body = options.map(([k, v]) => `  ${jsKey(k)}: ${v}`).join(',\n')
  return [
    ...imports,
    '',
    ...setup,
    ...(setup.length > 0 ? [''] : []),
    `const response = await axios({\n${body}\n});`,
    '',
    'console.log(response.status);',
    'console.log(response.data);'
  ].join('\n')
}

// ---------------------------------------------------------------------------------
// Python (requests)
// ---------------------------------------------------------------------------------

/** JSON string literals are valid Python string literals. */
export const pyString = (text: string) => JSON.stringify(text)

function pyValue(value: unknown, spaces: number): string {
  const pad = ' '.repeat(spaces + 4)
  const end = ' '.repeat(spaces)
  if (value === null) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return pyString(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => `${pad}${pyValue(v, spaces + 4)}`).join(',\n')}\n${end}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([k, v]) => `${pad}${pyString(k)}: ${pyValue(v, spaces + 4)}`).join(',\n')}\n${end}}`
}

function pyPairs(pairs: [string, string][], valueOf: (v: string) => string = pyString): string {
  if (pairs.length === 0) return '{}'
  if (hasDuplicates(pairs.map(([k]) => k))) {
    return `[\n${pairs.map(([k, v]) => `    (${pyString(k)}, ${valueOf(v)})`).join(',\n')}\n]`
  }
  return `{\n${pairs.map(([k, v]) => `    ${pyString(k)}: ${valueOf(v)}`).join(',\n')}\n}`
}

function pythonCode(r: CodegenRequest): string {
  const lines = ['import requests', '', `url = ${pyString(r.url)}`]
  const args = [pyString(r.method), 'url']
  if (r.headers.length > 0) {
    lines.push(`headers = ${pyPairs(headerObject(r.headers))}`)
    args.push('headers=headers')
  }
  switch (r.body.kind) {
    case 'text': {
      const value = r.body.json ? parseJsonSafely(r.body.text) : undefined
      if (value !== undefined) {
        lines.push(`payload = ${pyValue(value, 0)}`)
        args.push('json=payload')
      } else {
        lines.push(`payload = ${pyString(r.body.text)}`)
        args.push('data=payload.encode("utf-8")')
      }
      break
    }
    case 'urlencoded':
      lines.push(`payload = ${pyPairs(r.body.fields)}`)
      args.push('data=payload')
      break
    case 'formData': {
      const text = r.body.fields.filter((f) => f.type === 'text')
      const files = r.body.fields.filter((f) => f.type === 'file')
      if (text.length > 0) {
        lines.push(`payload = ${pyPairs(text.map((f): [string, string] => [f.key, f.value]))}`)
        args.push('data=payload')
      }
      if (files.length > 0) {
        lines.push(
          `files = ${pyPairs(
            files.map((f): [string, string] => [f.key, f.path]),
            (p) => `open(${pyString(p)}, "rb")`
          )}`
        )
        args.push('files=files')
      }
      break
    }
  }
  if (r.basicAuth) {
    args.push(`auth=(${pyString(r.basicAuth.username)}, ${pyString(r.basicAuth.password)})`)
  }
  if (!r.options.validateSSL) args.push('verify=False')
  if (!r.options.followRedirects) args.push('allow_redirects=False')
  if (r.options.timeoutMs > 0) args.push(`timeout=${r.options.timeoutMs / 1000}`)
  lines.push(
    '',
    `response = requests.request(\n    ${args.join(',\n    ')},\n)`,
    '',
    'print(response.status_code)',
    'print(response.text)'
  )
  return lines.join('\n')
}

export function generateCode(language: CodegenLanguage, request: CodegenRequest): string {
  switch (language) {
    case 'curl':
      return curl(request)
    case 'fetch':
      return fetchCode(request)
    case 'axios':
      return axiosCode(request)
    case 'python':
      return pythonCode(request)
  }
}
