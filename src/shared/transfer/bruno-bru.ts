/**
 * Bruno collections in `.bru` files (bruno.json, collection.bru, folder.bru, *.bru,
 * environments/*.bru) ↔ the shared Bruno model (bruno-model.ts).
 */
import { HTTP_METHODS, type HttpMethod } from '../schemas/collection'
import { parseBru, serializeBru, type BruBlock, type BruEntry } from './bru-lang'
import {
  emptyPart,
  type BrunoCollectionData,
  type BrunoEnvironment,
  type BrunoFile,
  type BrunoItem,
  type BrunoPair,
  type BrunoRequestPart
} from './bruno-model'

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

/** collection.bru: the collection's headers, auth, variables and scripts. */
export function readCollectionBru(text: string): BrunoRequestPart {
  return partFromBru(parseBru(text)).part
}

/** Any other .bru file of a collection folder (`path` relative to the collection). */
export function readBruFile(path: string, text: string): BrunoFile {
  const blocks = parseBru(text)
  const slash = path.lastIndexOf('/')
  const dir = slash < 0 ? '' : path.slice(0, slash)
  const file = path.slice(slash + 1)
  if (dir === 'environments') {
    const vars = blocks.find((b) => b.name === 'vars')
    const secret = blocks.find((b) => b.name === 'vars:secret')
    const environment: BrunoEnvironment = {
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
    }
    return { kind: 'environment', environment }
  }
  const { part, meta, type } = partFromBru(blocks)
  if (file === 'folder.bru') {
    const seq = Number(meta.seq)
    return {
      kind: 'folder',
      name: meta.name ?? '',
      seq: meta.seq !== undefined && !Number.isNaN(seq) ? seq : null,
      part
    }
  }
  return {
    kind: 'request',
    item: {
      type,
      name: meta.name || file.replace(/\.bru$/, ''),
      seq: Number(meta.seq) || Number.MAX_SAFE_INTEGER,
      request: part
    }
  }
}

// ---------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------

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

export function uniqueIn(taken: Set<string>, base: string, ext: string): string {
  let candidate = `${base}${ext}`
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}${ext}`
  taken.add(candidate.toLowerCase())
  return candidate
}

const dictBlock = (name: string, rows: readonly BrunoPair[]): BruBlock[] => {
  const entries = rows
    .filter((r) => r.name.trim() !== '')
    .map((r) => ({ key: r.name, value: r.value.replace(/\n/g, ' '), enabled: r.enabled }))
  return entries.length > 0 ? [{ kind: 'dict', name, entries }] : []
}

function authBlocks(auth: BrunoRequestPart['auth']): BruBlock[] {
  const dict = (name: string, entries: [string, string][]): BruBlock[] => [
    { kind: 'dict', name, entries: entries.map(([key, value]) => ({ key, value, enabled: true })) }
  ]
  switch (auth.mode) {
    case 'bearer':
      return dict('auth:bearer', [['token', auth.bearer?.token ?? '']])
    case 'basic':
      return dict('auth:basic', [
        ['username', auth.basic?.username ?? ''],
        ['password', auth.basic?.password ?? '']
      ])
    case 'apikey':
      return dict('auth:apikey', [
        ['key', auth.apikey?.key ?? ''],
        ['value', auth.apikey?.value ?? ''],
        ['placement', auth.apikey?.placement ?? 'header']
      ])
    default:
      return []
  }
}

/** Body, variables, assertions, scripts, tests and docs blocks shared by every file. */
function commonBlocks(part: BrunoRequestPart): BruBlock[] {
  const blocks: BruBlock[] = []
  const b = part.body
  if (b.mode === 'json') blocks.push({ kind: 'text', name: 'body:json', text: b.json ?? '' })
  if (b.mode === 'text') blocks.push({ kind: 'text', name: 'body:text', text: b.text ?? '' })
  if (b.mode === 'xml') blocks.push({ kind: 'text', name: 'body:xml', text: b.xml ?? '' })
  if (b.mode === 'formUrlEncoded')
    blocks.push(...dictBlock('body:form-urlencoded', b.formUrlEncoded ?? []))
  if (b.mode === 'multipartForm') {
    const entries = (b.multipartForm ?? [])
      .filter((f) => f.name.trim() !== '')
      .map((f) => ({
        key: f.name,
        value: f.type === 'file' ? `@file(${f.value})` : f.value,
        enabled: f.enabled
      }))
    if (entries.length > 0) blocks.push({ kind: 'dict', name: 'body:multipart-form', entries })
  }
  blocks.push(...dictBlock('vars:pre-request', part.vars.req))
  blocks.push(...dictBlock('vars:post-response', part.vars.res))
  blocks.push(...dictBlock('assert', part.assertions))
  if (part.script.req.trim() !== '')
    blocks.push({ kind: 'text', name: 'script:pre-request', text: part.script.req })
  if (part.script.res.trim() !== '')
    blocks.push({ kind: 'text', name: 'script:post-response', text: part.script.res })
  if (part.tests.trim() !== '') blocks.push({ kind: 'text', name: 'tests', text: part.tests })
  if (part.docs.trim() !== '') blocks.push({ kind: 'text', name: 'docs', text: part.docs })
  return blocks
}

function requestBru(item: BrunoItem & { request: BrunoRequestPart }): string {
  const part = item.request
  return serializeBru([
    {
      kind: 'dict',
      name: 'meta',
      entries: [
        { key: 'name', value: item.name, enabled: true },
        { key: 'type', value: item.type, enabled: true },
        { key: 'seq', value: String(item.seq), enabled: true }
      ]
    },
    {
      kind: 'dict',
      name: part.method.toLowerCase(),
      entries: [
        { key: 'url', value: part.url, enabled: true },
        { key: 'body', value: part.body.mode, enabled: true },
        { key: 'auth', value: part.auth.mode, enabled: true }
      ]
    },
    ...dictBlock(
      'params:query',
      part.params.filter((p) => p.type === 'query')
    ),
    ...dictBlock(
      'params:path',
      part.params.filter((p) => p.type === 'path')
    ),
    ...dictBlock('headers', part.headers),
    ...authBlocks(part.auth),
    ...commonBlocks(part)
  ])
}

/** collection.bru / folder.bru; null when there is nothing to write. */
function containerBru(part: BrunoRequestPart | null, meta: BruEntry[] | null): string | null {
  const blocks: BruBlock[] = meta ? [{ kind: 'dict', name: 'meta', entries: meta }] : []
  if (part) {
    blocks.push(...dictBlock('headers', part.headers))
    if (part.auth.mode !== 'inherit') {
      blocks.push(
        {
          kind: 'dict',
          name: 'auth',
          entries: [{ key: 'mode', value: part.auth.mode, enabled: true }]
        },
        ...authBlocks(part.auth)
      )
    }
    blocks.push(...commonBlocks(part))
  }
  return blocks.length > 0 ? serializeBru(blocks) : null
}

function environmentBru(env: BrunoEnvironment): string {
  const plain = env.variables.filter((v) => !v.secret && v.name.trim() !== '')
  const secret = env.variables.filter((v) => v.secret && v.name.trim() !== '')
  const blocks: BruBlock[] = [
    {
      kind: 'dict',
      name: 'vars',
      entries: plain.map((v) => ({ key: v.name, value: v.value, enabled: v.enabled }))
    }
  ]
  if (secret.length > 0) {
    blocks.push({
      kind: 'list',
      name: 'vars:secret',
      items: secret.map((v) => `${v.enabled ? '' : '~'}${v.name}`)
    })
  }
  return serializeBru(blocks)
}

/** The files of a `.bru` collection folder, by relative path. */
export function writeBruFiles(data: BrunoCollectionData): Record<string, string> {
  const files: Record<string, string> = {
    'bruno.json': `${JSON.stringify(
      { version: '1', name: data.name, type: 'collection', ignore: ['node_modules', '.git'] },
      null,
      2
    )}\n`
  }
  const root = containerBru(data.root, null)
  if (root) files['collection.bru'] = root

  const walk = (items: BrunoItem[], dir: string) => {
    const taken = new Set<string>(['folder.bru', 'collection.bru', 'bruno.json', 'environments'])
    for (const item of items) {
      if (item.type === 'folder' && 'items' in item) {
        const name = uniqueIn(taken, safeName(item.name), '')
        const path = dir === '' ? name : `${dir}/${name}`
        files[`${path}/folder.bru`] = containerBru(item.root, [
          { key: 'name', value: item.name, enabled: true },
          { key: 'seq', value: String(item.seq), enabled: true }
        ]) as string
        walk(item.items, path)
      } else if ('request' in item) {
        const file = uniqueIn(taken, safeName(item.name), '.bru')
        files[dir === '' ? file : `${dir}/${file}`] = requestBru(item)
      }
    }
  }
  walk(data.items, '')

  const envTaken = new Set<string>()
  for (const env of data.environments) {
    files[`environments/${uniqueIn(envTaken, safeName(env.name), '.bru')}`] = environmentBru(env)
  }
  return files
}
