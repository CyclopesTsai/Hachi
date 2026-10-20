/**
 * The `example { … }` block of Bruno's .bru files (response examples, decision 140). Its
 * content is a nested syntax of its own (Bruno's `example/jsonToBru.js`):
 *
 *   name: Created
 *   description: …
 *
 *   request: {
 *     url: https://api.test/users
 *     method: post
 *     mode: json
 *     headers: {
 *       content-type: application/json
 *     }
 *     body:json: {
 *       { "name": "a" }
 *     }
 *   }
 *
 *   response: {
 *     headers: {
 *       content-type: application/json
 *     }
 *     status: {
 *       code: 201
 *       text: Created
 *     }
 *     body: {
 *       type: json
 *       content: '''
 *         { "id": 1 }
 *       '''
 *     }
 *   }
 *
 * bru-lang.ts hands over the block as text; this module reads and writes that text.
 */
import type { BrunoExample, BrunoPair, BrunoRequestPart } from './bruno-model'

interface ExNode {
  key: string
  enabled: boolean
  value: string
  /** `key: { … }` blocks: nested entries, or raw text for body blocks. */
  children?: ExNode[]
  text?: string
}

/** Blocks whose content is free text (request bodies). */
const TEXT_BLOCKS = new Set([
  'body:json',
  'body:text',
  'body:xml',
  'body:sparql',
  'body:graphql',
  'body:graphql:vars'
])

const indentOf = (line: string) => line.length - line.trimStart().length

function dedentAll(lines: string[]): string {
  const used = lines.filter((l) => l.trim() !== '')
  const cut = used.length === 0 ? 0 : Math.min(...used.map(indentOf))
  const out = lines.map((l) => l.slice(Math.min(cut, indentOf(l))))
  while (out.length > 0 && (out[out.length - 1] as string).trim() === '') out.pop()
  while (out.length > 0 && (out[0] as string).trim() === '') out.shift()
  return out.join('\n')
}

function splitKey(line: string): { key: string; enabled: boolean; rest: string } | null {
  let enabled = true
  let text = line
  if (text.startsWith('~')) {
    enabled = false
    text = text.slice(1)
  }
  let key: string
  let rest: string
  if (text.startsWith('"')) {
    const end = text.indexOf('":', 1)
    if (end < 0) return null
    key = text.slice(1, end).replace(/\\"/g, '"')
    rest = text.slice(end + 2)
  } else {
    // Block keys may contain colons (`body:json: {`, `params:query: {`).
    const opener = /^(.+?):\s*\{$/.exec(text)
    if (opener) return { key: (opener[1] as string).trim(), enabled, rest: '{' }
    const colon = text.indexOf(':')
    if (colon < 0) return null
    key = text.slice(0, colon)
    rest = text.slice(colon + 1)
  }
  return { key: key.trim(), enabled, rest: rest.trim() }
}

function parseNodes(lines: string[]): ExNode[] {
  const nodes: ExNode[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string
    const line = raw.trim()
    if (line === '') continue
    const parsed = splitKey(line)
    if (!parsed) continue
    const { key, enabled, rest } = parsed
    if (rest === '{') {
      // The block ends at the `}` with the opening line's indentation.
      const own = indentOf(raw)
      let end = i + 1
      while (end < lines.length) {
        const l = lines[end] as string
        if (l.trim() === '}' && indentOf(l) <= own) break
        end++
      }
      const inner = lines.slice(i + 1, end)
      nodes.push(
        TEXT_BLOCKS.has(key)
          ? { key, enabled, value: '', text: dedentAll(inner) }
          : { key, enabled, value: '', children: parseNodes(inner) }
      )
      i = end
    } else if (rest === "'''") {
      const parts: string[] = []
      for (i++; i < lines.length && (lines[i] as string).trim() !== "'''"; i++) {
        parts.push(lines[i] as string)
      }
      nodes.push({ key, enabled, value: dedentAll(parts) })
    } else {
      nodes.push({ key, enabled, value: rest })
    }
  }
  return nodes
}

const find = (nodes: ExNode[] | undefined, key: string) => nodes?.find((n) => n.key === key)
const pairsOf = (node: ExNode | undefined): BrunoPair[] =>
  (node?.children ?? []).map((n) => ({ name: n.key, value: n.value, enabled: n.enabled }))

/** The content of an `example { … }` block. */
export function parseBruExample(text: string): BrunoExample {
  const nodes = parseNodes(text.split(/\r?\n/))
  const req = find(nodes, 'request')?.children ?? []
  const res = find(nodes, 'response')?.children ?? []
  const body: BrunoRequestPart['body'] = { mode: find(req, 'mode')?.value || 'none' }
  const bodyText = (key: string) => find(req, key)?.text
  if (bodyText('body:json') !== undefined) body.json = bodyText('body:json')
  if (bodyText('body:text') !== undefined) body.text = bodyText('body:text')
  if (bodyText('body:xml') !== undefined) body.xml = bodyText('body:xml')
  if (find(req, 'body:form-urlencoded')) {
    body.formUrlEncoded = pairsOf(find(req, 'body:form-urlencoded'))
  }
  if (find(req, 'body:multipart-form')) {
    body.multipartForm = pairsOf(find(req, 'body:multipart-form')).map((p) => {
      const file = /^@file\((.*)\)/.exec(p.value)
      return file
        ? { ...p, value: file[1] ?? '', type: 'file' as const }
        : { ...p, type: 'text' as const }
    })
  }
  if (bodyText('body:graphql') !== undefined || bodyText('body:graphql:vars') !== undefined) {
    body.graphql = {
      query: bodyText('body:graphql') ?? '',
      variables: bodyText('body:graphql:vars') ?? ''
    }
  }
  const status = find(res, 'status')?.children
  const resBody = find(res, 'body')?.children
  return {
    name: find(nodes, 'name')?.value ?? '',
    description: find(nodes, 'description')?.value ?? '',
    request: {
      url: find(req, 'url')?.value ?? '',
      method: (find(req, 'method')?.value || 'get').toUpperCase(),
      headers: pairsOf(find(req, 'headers')),
      params: [
        ...pairsOf(find(req, 'params:query')).map((p) => ({ ...p, type: 'query' as const })),
        ...pairsOf(find(req, 'params:path')).map((p) => ({ ...p, type: 'path' as const }))
      ],
      body
    },
    response: {
      status: Number(find(status, 'code')?.value) || 200,
      statusText: find(status, 'text')?.value ?? '',
      headers: pairsOf(find(res, 'headers')),
      body: resBody
        ? {
            type: find(resBody, 'type')?.value ?? 'text',
            content: find(resBody, 'content')?.value ?? ''
          }
        : null
    }
  }
}

function quoteKey(key: string): string {
  return [':', '"', '{', '}', ' '].some((c) => key.includes(c))
    ? `"${key.replaceAll('"', '\\"')}"`
    : key
}

const indent = (text: string, spaces: number) =>
  text
    .split(/\r?\n/)
    .map((l) => (l === '' ? '' : ' '.repeat(spaces) + l))
    .join('\n')

const dict = (name: string, rows: readonly BrunoPair[], spaces: number): string[] =>
  rows.length === 0
    ? []
    : [
        `${' '.repeat(spaces)}${name}: {`,
        ...rows.map(
          (r) =>
            `${' '.repeat(spaces + 2)}${r.enabled ? '' : '~'}${quoteKey(r.name)}: ${r.value.replace(/\n/g, ' ')}`
        ),
        `${' '.repeat(spaces)}}`
      ]

const textBlock = (name: string, text: string | undefined, spaces: number): string[] =>
  text === undefined || text === ''
    ? []
    : [`${' '.repeat(spaces)}${name}: {`, indent(text, spaces + 2), `${' '.repeat(spaces)}}`]

/** The content of an `example { … }` block (as Bruno writes it). */
export function bruExampleText(example: BrunoExample): string {
  const { request, response } = example
  const b = request.body
  const lines: string[] = [`name: ${example.name.replace(/\n/g, ' ')}`]
  if (example.description) lines.push(`description: ${example.description.replace(/\n/g, ' ')}`)
  lines.push(
    '',
    'request: {',
    `  url: ${request.url}`,
    `  method: ${request.method.toLowerCase()}`,
    `  mode: ${b.mode}`,
    ...dict(
      'params:query',
      request.params.filter((p) => p.type === 'query'),
      2
    ),
    ...dict(
      'params:path',
      request.params.filter((p) => p.type === 'path'),
      2
    ),
    ...dict('headers', request.headers, 2),
    ...(b.mode === 'json' ? textBlock('body:json', b.json, 2) : []),
    ...(b.mode === 'text' ? textBlock('body:text', b.text, 2) : []),
    ...(b.mode === 'xml' ? textBlock('body:xml', b.xml, 2) : []),
    ...(b.mode === 'formUrlEncoded' ? dict('body:form-urlencoded', b.formUrlEncoded ?? [], 2) : []),
    ...(b.mode === 'multipartForm'
      ? dict(
          'body:multipart-form',
          (b.multipartForm ?? []).map((f) => ({
            ...f,
            value: f.type === 'file' ? `@file(${f.value})` : f.value
          })),
          2
        )
      : []),
    '}',
    '',
    'response: {',
    ...dict('headers', response.headers, 2),
    '  status: {',
    `    code: ${response.status}`,
    ...(response.statusText ? [`    text: ${response.statusText}`] : []),
    '  }'
  )
  if (response.body) {
    lines.push(
      '  body: {',
      `    type: ${response.body.type}`,
      "    content: '''",
      indent(response.body.content, 6),
      "    '''",
      '  }'
    )
  }
  lines.push('}')
  return lines.join('\n')
}
