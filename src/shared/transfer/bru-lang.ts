/**
 * The Bru file format of Bruno collections (`*.bru`), parsed into blocks and written back.
 * Pure: no knowledge of what the blocks mean (see bruno.ts).
 *
 *   meta {                    dictionary block: `key: value` lines,
 *     name: Get users         a leading `~` marks a disabled entry,
 *     ~seq: 1                 values may span lines between ''' … '''
 *   }
 *   body:json {               text block (body, script, tests, docs): the content,
 *     { "a": 1 }              indented by two spaces
 *   }
 *   vars:secret [             list block
 *     token, apiKey
 *   ]
 */

export interface BruEntry {
  key: string
  value: string
  enabled: boolean
}

export type BruBlock =
  | { kind: 'dict'; name: string; entries: BruEntry[] }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'list'; name: string; items: string[] }

export class BruParseError extends Error {}

/** Blocks whose content is free text rather than `key: value` lines. */
export function isTextBlock(name: string): boolean {
  return (
    (name.startsWith('body:') && !['body:form-urlencoded', 'body:multipart-form'].includes(name)) ||
    /^(script:|tests$|docs$)/.test(name)
  )
}

function dedent(lines: string[]): string {
  return lines.map((l) => (l.startsWith('  ') ? l.slice(2) : l.replace(/^\s+/, ''))).join('\n')
}

export function parseBru(source: string): BruBlock[] {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  const blocks: BruBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = (lines[i] as string).trim()
    i++
    if (line === '') continue
    const open = /^([A-Za-z][\w:-]*)\s*([{[])$/.exec(line)
    if (!open) throw new BruParseError(`無法解析的內容（第 ${i} 行）：${line}`)
    const name = open[1] as string
    const close = open[2] === '{' ? '}' : ']'
    const body: string[] = []
    let closed = false
    while (i < lines.length) {
      const raw = lines[i] as string
      i++
      if (raw === close || (raw.trim() === close && !raw.startsWith('  '))) {
        closed = true
        break
      }
      body.push(raw)
    }
    if (!closed) throw new BruParseError(`區塊「${name}」沒有結束`)
    if (close === ']') {
      blocks.push({
        kind: 'list',
        name,
        items: body
          .join('\n')
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter((s) => s !== '')
      })
    } else if (isTextBlock(name)) {
      // Trailing blank lines inside the block are formatting, not content.
      while (body.length > 0 && (body[body.length - 1] as string).trim() === '') body.pop()
      blocks.push({ kind: 'text', name, text: dedent(body) })
    } else {
      blocks.push({ kind: 'dict', name, entries: parseEntries(body, name) })
    }
  }
  return blocks
}

function parseEntries(body: string[], block: string): BruEntry[] {
  const entries: BruEntry[] = []
  for (let j = 0; j < body.length; j++) {
    const line = (body[j] as string).trim()
    if (line === '') continue
    const colon = line.indexOf(':')
    if (colon < 0) throw new BruParseError(`區塊「${block}」中無法解析：${line}`)
    let key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    let enabled = true
    if (key.startsWith('~')) {
      enabled = false
      key = key.slice(1)
    }
    if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1)
    if (value === "'''") {
      // Multi-line value until a line holding only '''.
      const parts: string[] = []
      for (j++; j < body.length && (body[j] as string).trim() !== "'''"; j++) {
        parts.push(body[j] as string)
      }
      value = dedent(parts.map((p) => p.replace(/^ {2}/, '')))
    }
    entries.push({ key, value, enabled })
  }
  return entries
}

const indent = (text: string) =>
  text
    .split('\n')
    .map((l) => (l === '' ? '' : `  ${l}`))
    .join('\n')

function formatKey(key: string): string {
  return /[:\s{}~]/.test(key) || key === '' ? JSON.stringify(key) : key
}

export function serializeBru(blocks: readonly BruBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'list') {
        return `${block.name} [\n${block.items.map((item) => `  ${item}`).join(',\n')}\n]`
      }
      if (block.kind === 'text') return `${block.name} {\n${indent(block.text)}\n}`
      const lines = block.entries.map((e) => {
        const key = `${e.enabled ? '' : '~'}${formatKey(e.key)}`
        return e.value.includes('\n')
          ? `  ${key}: '''\n${indent(indent(e.value))}\n  '''`
          : `  ${key}: ${e.value}`
      })
      return `${block.name} {\n${lines.join('\n')}\n}`
    })
    .join('\n\n')
    .concat('\n')
}
