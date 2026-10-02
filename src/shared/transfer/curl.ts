/**
 * Parses a cURL command line (as copied from a terminal, docs or a browser's
 * "Copy as cURL") into an HTTP request. Pure; no file is ever read (`@file` data
 * is reported as a warning). Supported options: docs/schema.md (「cURL 匯入」).
 */
import {
  HTTP_METHODS,
  ITEM_NAME_MAX,
  type Auth,
  type HttpMethod,
  type KeyValue
} from '../schemas/collection'
import {
  httpRequestSchema,
  type FormDataField,
  type HttpBody,
  type HttpRequest
} from '../schemas/http-request'

export class CurlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CurlParseError'
  }
}

export const MAX_CURL_TEXT = 5 * 1024 * 1024

// ---------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------

function ansiC(text: string, start: number): { value: string; end: number } {
  // $'...' quoting: backslash escapes like in C.
  let value = ''
  let i = start
  while (i < text.length) {
    const c = text[i] as string
    if (c === "'") return { value, end: i + 1 }
    if (c !== '\\') {
      value += c
      i++
      continue
    }
    const n = text[i + 1] ?? ''
    i += 2
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      a: '\x07',
      b: '\b',
      e: '\x1b',
      E: '\x1b',
      f: '\f',
      v: '\v',
      '\\': '\\',
      "'": "'",
      '"': '"',
      '?': '?'
    }
    if (n in simple) {
      value += simple[n]
    } else if (n === 'x') {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(text.slice(i))?.[0] ?? ''
      value += hex ? String.fromCharCode(parseInt(hex, 16)) : '\\x'
      i += hex.length
    } else if (n === 'u' || n === 'U') {
      const hex = new RegExp(`^[0-9a-fA-F]{1,${n === 'u' ? 4 : 8}}`).exec(text.slice(i))?.[0] ?? ''
      value += hex ? String.fromCodePoint(parseInt(hex, 16)) : `\\${n}`
      i += hex.length
    } else if (/[0-7]/.test(n)) {
      const oct = n + (/^[0-7]{0,2}/.exec(text.slice(i))?.[0] ?? '')
      value += String.fromCharCode(parseInt(oct, 8))
      i += oct.length - 1
    } else {
      value += `\\${n}`
    }
  }
  throw new CurlParseError("引號沒有結束（$'…'）")
}

/** Splits a POSIX shell command line into words (quotes, escapes, line continuations). */
export function tokenizePosix(text: string): string[] {
  const words: string[] = []
  let word = ''
  let inWord = false
  let i = 0
  const flush = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  while (i < text.length) {
    const c = text[i] as string
    if (c === '\\') {
      const n = text[i + 1]
      if (n === '\n') {
        i += 2 // line continuation
      } else if (n === '\r' && text[i + 2] === '\n') {
        i += 3
      } else {
        word += n ?? ''
        inWord = true
        i += 2
      }
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0) throw new CurlParseError("引號沒有結束（'）")
      word += text.slice(i + 1, end)
      inWord = true
      i = end + 1
    } else if (c === '$' && text[i + 1] === "'") {
      const { value, end } = ansiC(text, i + 2)
      word += value
      inWord = true
      i = end
    } else if (c === '"') {
      i++
      let closed = false
      while (i < text.length) {
        const d = text[i] as string
        if (d === '"') {
          closed = true
          i++
          break
        }
        if (d === '\\' && i + 1 < text.length) {
          const n = text[i + 1] as string
          if (n === '\n') {
            i += 2
            continue
          }
          if ('$`"\\'.includes(n)) {
            word += n
            i += 2
            continue
          }
        }
        word += d
        i++
      }
      if (!closed) throw new CurlParseError('引號沒有結束（"）')
      inWord = true
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      flush()
      i++
    } else if (c === '#' && !inWord) {
      // Comment until end of line.
      while (i < text.length && text[i] !== '\n') i++
    } else {
      word += c
      inWord = true
      i++
    }
  }
  flush()
  return words
}

/**
 * Windows cmd ("Copy as cURL (cmd)"): `^` escapes the next character and `^` + newline
 * continues the line; then arguments are split like the C runtime does (double quotes,
 * `\"` for a literal quote).
 */
export function tokenizeCmd(text: string): string[] {
  let unescaped = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (c !== '^') {
      unescaped += c
      continue
    }
    const n = text[i + 1]
    if (n === '\r' && text[i + 2] === '\n') i += 2
    else if (n === '\n') i += 1
    else if (n !== undefined) {
      unescaped += n
      i += 1
    }
  }
  const words: string[] = []
  let word = ''
  let inWord = false
  let quoted = false
  for (let i = 0; i < unescaped.length; i++) {
    const c = unescaped[i] as string
    if (c === '\\') {
      let slashes = 0
      while (unescaped[i] === '\\') {
        slashes++
        i++
      }
      if (unescaped[i] === '"') {
        word += '\\'.repeat(Math.floor(slashes / 2))
        if (slashes % 2 === 1) word += '"'
        else quoted = !quoted
      } else {
        word += '\\'.repeat(slashes)
        i--
      }
      inWord = true
    } else if (c === '"') {
      quoted = !quoted
      inWord = true
    } else if (!quoted && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
      if (inWord) words.push(word)
      word = ''
      inWord = false
    } else {
      word += c
      inWord = true
    }
  }
  if (quoted) throw new CurlParseError('引號沒有結束（"）')
  if (inWord) words.push(word)
  return words
}

const looksLikeCmd = (text: string) => /\^\r?\n/.test(text) || /\^"/.test(text)

// ---------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------

/** Long options (without "--") that take a value; everything else is a flag. */
const LONG_WITH_VALUE = new Set([
  'request',
  'header',
  'data',
  'data-raw',
  'data-binary',
  'data-ascii',
  'data-urlencode',
  'json',
  'form',
  'form-string',
  'user',
  'user-agent',
  'referer',
  'cookie',
  'cookie-jar',
  'max-time',
  'connect-timeout',
  'output',
  'proxy',
  'proxy-user',
  'url',
  'upload-file',
  'write-out',
  'cacert',
  'capath',
  'cert',
  'cert-type',
  'key',
  'key-type',
  'pass',
  'resolve',
  'connect-to',
  'max-redirs',
  'retry',
  'retry-delay',
  'retry-max-time',
  'limit-rate',
  'range',
  'interface',
  'dns-servers',
  'config',
  'aws-sigv4',
  'oauth2-bearer',
  'unix-socket',
  'abstract-unix-socket',
  'ciphers',
  'tls-max',
  'expect100-timeout',
  'keepalive-time',
  'local-port',
  'noproxy',
  'preproxy',
  'proxy-header',
  'request-target',
  'trace',
  'trace-ascii',
  'variable',
  'url-query',
  'dump-header',
  'stderr',
  'time-cond',
  'speed-limit',
  'speed-time'
])

const SHORT_WITH_VALUE = new Set('XHdFuAebmoxUTwEKrcDCyYzt'.split(''))

const SHORT_TO_LONG: Record<string, string> = {
  X: 'request',
  H: 'header',
  d: 'data',
  F: 'form',
  u: 'user',
  A: 'user-agent',
  e: 'referer',
  b: 'cookie',
  m: 'max-time',
  x: 'proxy',
  k: 'insecure',
  L: 'location',
  G: 'get',
  I: 'head',
  s: 'silent',
  S: 'show-error',
  v: 'verbose',
  i: 'include',
  o: 'output',
  O: 'remote-name',
  f: 'fail',
  g: 'globoff',
  T: 'upload-file',
  U: 'proxy-user',
  w: 'write-out',
  E: 'cert',
  K: 'config',
  r: 'range',
  c: 'cookie-jar',
  D: 'dump-header',
  C: 'continue-at',
  y: 'speed-time',
  Y: 'speed-limit',
  z: 'time-cond',
  t: 'telnet-option',
  N: 'no-buffer',
  n: 'netrc',
  j: 'junk-session-cookies',
  q: 'disable',
  '0': 'http1.0',
  '1': 'tlsv1',
  '2': 'sslv2',
  '3': 'sslv3',
  '4': 'ipv4',
  '6': 'ipv6',
  '#': 'progress-bar'
}

/** Options that do not change the request (output, logging, transport details). */
const IGNORED = new Set([
  'compressed',
  'silent',
  'show-error',
  'verbose',
  'include',
  'output',
  'remote-name',
  'fail',
  'fail-with-body',
  'globoff',
  'no-buffer',
  'progress-bar',
  'write-out',
  'dump-header',
  'stderr',
  'http1.0',
  'http1.1',
  'http2',
  'http2-prior-knowledge',
  'http3',
  'ipv4',
  'ipv6',
  'tlsv1',
  'tlsv1.2',
  'tlsv1.3',
  'no-keepalive',
  'keepalive-time',
  'path-as-is',
  'retry',
  'retry-delay',
  'retry-max-time',
  'connect-timeout',
  'max-redirs',
  'location-trusted',
  'location',
  'disable',
  'netrc',
  'junk-session-cookies',
  'tr-encoding',
  'raw',
  'ssl',
  'ssl-reqd',
  'basic'
])

interface DataPart {
  kind: 'data' | 'raw' | 'urlencode'
  value: string
}

interface Parsed {
  url: string | null
  method: string | null
  head: boolean
  get: boolean
  headers: [string, string][]
  data: DataPart[]
  form: { key: string; value: string; file: boolean }[]
  auth: Auth | null
  insecure: boolean
  timeoutMs: number | null
  cookies: string[]
  warnings: string[]
}

function warnOnce(p: Parsed, message: string) {
  if (!p.warnings.includes(message)) p.warnings.push(message)
}

function applyOption(p: Parsed, name: string, value: string | undefined): void {
  const v = value ?? ''
  switch (name) {
    case 'request':
      p.method = v.toUpperCase()
      return
    case 'header': {
      const at = v.indexOf(':')
      if (at < 0) {
        // "Name;" sends an empty header; anything else is not a header.
        if (v.endsWith(';')) p.headers.push([v.slice(0, -1).trim(), ''])
        else warnOnce(p, `無法解析的 Header：${v}`)
        return
      }
      const key = v.slice(0, at).trim()
      const val = v.slice(at + 1).trim()
      if (val === '') return // "Name:" removes a header in curl
      p.headers.push([key, val])
      return
    }
    case 'data':
    case 'data-ascii':
    case 'data-binary':
      if (v.startsWith('@')) {
        warnOnce(p, `不支援從檔案讀取 Body（${v}），請手動貼上內容`)
        return
      }
      p.data.push({ kind: 'data', value: v })
      return
    case 'data-raw':
      p.data.push({ kind: 'raw', value: v })
      return
    case 'data-urlencode':
      if (/^[^=]*@/.test(v) && !v.includes('=')) {
        warnOnce(p, `不支援從檔案讀取 Body（${v}），請手動貼上內容`)
        return
      }
      p.data.push({ kind: 'urlencode', value: v })
      return
    case 'json':
      if (v.startsWith('@')) {
        warnOnce(p, `不支援從檔案讀取 Body（${v}），請手動貼上內容`)
        return
      }
      p.data.push({ kind: 'raw', value: v })
      if (!p.headers.some(([k]) => k.toLowerCase() === 'content-type')) {
        p.headers.push(['Content-Type', 'application/json'])
      }
      if (!p.headers.some(([k]) => k.toLowerCase() === 'accept')) {
        p.headers.push(['Accept', 'application/json'])
      }
      return
    case 'form':
    case 'form-string': {
      const eq = v.indexOf('=')
      if (eq < 0) {
        warnOnce(p, `無法解析的 Form 欄位：${v}`)
        return
      }
      const key = v.slice(0, eq)
      let content = v.slice(eq + 1)
      if (name === 'form' && content.startsWith('@')) {
        // name=@path;type=…;filename=… — keep the path only.
        content = content.slice(1)
        const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(content)
        const filePath = quoted ? (quoted[1] ?? '').replace(/\\(.)/g, '$1') : content.split(';')[0]
        p.form.push({ key, value: filePath ?? '', file: true })
        return
      }
      if (name === 'form' && content.startsWith('<')) {
        warnOnce(p, `不支援從檔案讀取 Form 欄位內容（${key}）`)
        return
      }
      if (name === 'form') content = content.replace(/;type=[^;]*$/, '')
      p.form.push({ key, value: content, file: false })
      return
    }
    case 'user': {
      const colon = v.indexOf(':')
      p.auth = {
        type: 'basic',
        username: colon < 0 ? v : v.slice(0, colon),
        password: colon < 0 ? '' : v.slice(colon + 1)
      }
      return
    }
    case 'oauth2-bearer':
      p.auth = { type: 'bearer', token: v }
      return
    case 'user-agent':
      p.headers.push(['User-Agent', v])
      return
    case 'referer':
      p.headers.push(['Referer', v.replace(/;auto$/, '')])
      return
    case 'cookie':
      if (v.includes('=')) p.cookies.push(v)
      else warnOnce(p, `不支援從檔案讀取 Cookie（${v}）`)
      return
    case 'max-time': {
      const seconds = Number(v)
      if (Number.isFinite(seconds) && seconds >= 0) {
        p.timeoutMs = Math.min(Math.round(seconds * 1000), 3_600_000)
      }
      return
    }
    case 'url':
      if (p.url === null) p.url = v
      return
    case 'insecure':
      p.insecure = true
      return
    case 'get':
      p.get = true
      return
    case 'head':
      p.head = true
      return
    case 'proxy':
    case 'proxy-user':
    case 'noproxy':
    case 'preproxy':
    case 'proxy-header':
      warnOnce(p, 'cURL 的 Proxy 設定不會匯入（Hachi 使用 App 的 Proxy 設定）')
      return
    case 'digest':
    case 'ntlm':
    case 'negotiate':
    case 'anyauth':
      warnOnce(p, `不支援 --${name} 驗證，請在 Auth 分頁重新設定`)
      return
    case 'upload-file':
      warnOnce(p, `不支援上傳檔案（-T ${v}）`)
      return
    default:
      if (IGNORED.has(name)) return
      warnOnce(p, `忽略不支援的選項 ${name.startsWith('-') ? name : `--${name}`}`)
  }
}

const formDecode = (text: string): string => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    return text
  }
}

/** `name=content` pairs of the data parts, decoded; null if some part is not a pair. */
function dataPairs(parts: DataPart[]): [string, string][] | null {
  const pairs: [string, string][] = []
  for (const part of parts) {
    if (part.kind === 'urlencode') {
      // "content", "=content" or "name=content": the content is sent encoded.
      const eq = part.value.indexOf('=')
      if (eq <= 0) return null
      pairs.push([part.value.slice(0, eq), part.value.slice(eq + 1)])
      continue
    }
    for (const piece of part.value.split('&')) {
      if (piece === '') continue
      const eq = piece.indexOf('=')
      if (eq <= 0) return null
      pairs.push([formDecode(piece.slice(0, eq)), formDecode(piece.slice(eq + 1))])
    }
  }
  return pairs
}

const encodeForm = (text: string) => encodeURIComponent(text).replace(/%20/g, '+')

function dataText(parts: DataPart[]): string {
  return parts
    .map((part) => {
      if (part.kind !== 'urlencode') return part.value
      const eq = part.value.indexOf('=')
      if (eq < 0) return encodeForm(part.value)
      const name = part.value.slice(0, eq)
      const content = encodeForm(part.value.slice(eq + 1))
      return name === '' ? content : `${name}=${content}`
    })
    .join('&')
}

function looksLikeJson(text: string): boolean {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

/** "GET api.test/users": the URL as typed (no scheme / query), so `{{vars}}` keep their case. */
function requestName(method: string, url: string): string {
  const label = (url.replace(/^[a-z][a-z\d+.-]*:\/\//i, '').split(/[?#]/)[0] ?? '').replace(
    /\/$/,
    ''
  )
  return `${method} ${label}`.slice(0, ITEM_NAME_MAX).trim() || 'Imported Request'
}

export interface CurlImport {
  request: HttpRequest
  warnings: string[]
}

/** Parses a cURL command into a new (unsaved) HTTP request. */
export function parseCurl(
  text: string,
  newId: () => string = () => globalThis.crypto.randomUUID()
): CurlImport {
  if (text.length > MAX_CURL_TEXT) throw new CurlParseError('指令太長')
  const trimmed = text.trim().replace(/^\$\s+/, '')
  const words = looksLikeCmd(trimmed) ? tokenizeCmd(trimmed) : tokenizePosix(trimmed)
  const first = words[0] ?? ''
  if (!/(^|[\\/])curl(\.exe)?$/i.test(first)) {
    throw new CurlParseError('不是 cURL 指令（需要以 curl 開頭）')
  }

  const p: Parsed = {
    url: null,
    method: null,
    head: false,
    get: false,
    headers: [],
    data: [],
    form: [],
    auth: null,
    insecure: false,
    timeoutMs: null,
    cookies: [],
    warnings: []
  }
  let endOfOptions = false
  for (let i = 1; i < words.length; i++) {
    const word = words[i] as string
    if (!endOfOptions && word === '--') {
      endOfOptions = true
    } else if (!endOfOptions && word.startsWith('--') && word.length > 2) {
      const name = word.slice(2)
      if (LONG_WITH_VALUE.has(name)) {
        if (i + 1 >= words.length) throw new CurlParseError(`--${name} 缺少值`)
        applyOption(p, name, words[++i])
      } else {
        applyOption(p, name, undefined)
      }
    } else if (!endOfOptions && word.startsWith('-') && word.length > 1) {
      // Short options may be combined: -sSL, -XPOST, -sXPOST, -HAccept:x
      for (let j = 1; j < word.length; j++) {
        const letter = word[j] as string
        const name = SHORT_TO_LONG[letter] ?? `-${letter}`
        if (SHORT_WITH_VALUE.has(letter)) {
          let value = word.slice(j + 1)
          if (value === '') {
            if (i + 1 >= words.length) throw new CurlParseError(`-${letter} 缺少值`)
            value = words[++i] as string
          }
          applyOption(p, name, value)
          break
        }
        applyOption(p, name, undefined)
      }
    } else if (p.url === null) {
      p.url = word
    } else {
      warnOnce(p, `忽略多餘的網址：${word}`)
    }
  }
  if (p.url === null || p.url.trim() === '') throw new CurlParseError('找不到網址')

  const headers: KeyValue[] = p.headers.map(([key, value]) => ({
    id: newId(),
    key,
    value,
    enabled: true
  }))
  if (p.cookies.length > 0) {
    headers.push({ id: newId(), key: 'Cookie', value: p.cookies.join('; '), enabled: true })
  }
  const removeHeader = (name: string, value?: string) => {
    const at = headers.findIndex(
      (h) =>
        h.key.toLowerCase() === name &&
        (value === undefined || h.value.trim().toLowerCase() === value)
    )
    if (at >= 0) headers.splice(at, 1)
  }
  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''

  const params: KeyValue[] = []
  let body: Partial<HttpBody> = { mode: 'none' }
  if (p.get && p.data.length > 0) {
    // -G: the data goes to the query string.
    for (const [key, value] of dataPairs(p.data) ?? [[dataText(p.data), '']]) {
      params.push({ id: newId(), key, value, enabled: true })
    }
  } else if (p.form.length > 0) {
    if (p.data.length > 0) warnOnce(p, '同時有 -d 與 -F，只匯入 -F 的欄位')
    const formData: FormDataField[] = p.form.map((f) => ({
      id: newId(),
      key: f.key,
      enabled: true,
      type: f.file ? 'file' : 'text',
      value: f.file ? '' : f.value,
      filePath: f.file ? f.value : ''
    }))
    removeHeader('content-type')
    body = { mode: 'formData', formData }
  } else if (p.data.length > 0) {
    const text = dataText(p.data)
    const pairs = dataPairs(p.data)
    if (/json/i.test(contentType) || (contentType === '' && looksLikeJson(text))) {
      removeHeader('content-type', 'application/json')
      body = { mode: 'json', json: text }
    } else if (
      pairs !== null &&
      (contentType === '' || /application\/x-www-form-urlencoded/i.test(contentType))
    ) {
      removeHeader('content-type', 'application/x-www-form-urlencoded')
      body = {
        mode: 'urlencoded',
        urlencoded: pairs.map(([key, value]) => ({ id: newId(), key, value, enabled: true }))
      }
    } else {
      // curl's default type for -d data.
      removeHeader('content-type')
      body = {
        mode: 'raw',
        raw: text,
        rawContentType: contentType || 'application/x-www-form-urlencoded'
      }
    }
  }

  let method = p.method ?? (p.head ? 'HEAD' : body.mode !== 'none' ? 'POST' : 'GET')
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    warnOnce(p, `不支援的 HTTP 方法「${method}」，已改為 GET`)
    method = 'GET'
  }

  const request = httpRequestSchema.parse({
    version: 1,
    id: newId(),
    type: 'http',
    name: requestName(method, p.url),
    method: method as HttpMethod,
    url: p.url,
    params,
    headers,
    body,
    // No auth in the command: like a new request, use whatever the Collection sets.
    auth: p.auth ?? { type: 'inherit' },
    settings: {
      timeoutMs: p.timeoutMs,
      validateSSL: p.insecure ? false : null
    }
  })
  return { request, warnings: p.warnings }
}
