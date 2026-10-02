/**
 * Assertion and extraction tables (decision 73): evaluated in main after a response,
 * pure so they can be unit tested. JSON paths use the simple `data.items[0].id` form.
 */
import type {
  Assertion,
  AssertionOperator,
  AssertionTarget,
  Extraction,
  ExtractionSource
} from './schemas/http-request'
import type { AssertionResult, ExtractionResult } from './scripts'

export const ASSERTION_TARGET_LABELS: Record<AssertionTarget, string> = {
  status: '狀態碼',
  responseTime: '耗時（ms）',
  header: 'Header',
  jsonBody: 'JSON 欄位',
  body: 'Body 文字'
}

export const ASSERTION_OPERATOR_LABELS: Record<AssertionOperator, string> = {
  eq: '等於',
  neq: '不等於',
  contains: '包含',
  notContains: '不包含',
  exists: '存在',
  notExists: '不存在',
  gt: '大於',
  gte: '大於或等於',
  lt: '小於',
  lte: '小於或等於',
  matches: '符合 Regex',
  isType: '型別是'
}

/** Operators that take no expected value. */
export const UNARY_OPERATORS: readonly AssertionOperator[] = ['exists', 'notExists']

export const VALUE_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'] as const

export const EXTRACTION_SOURCE_LABELS: Record<ExtractionSource, string> = {
  jsonBody: 'JSON 欄位',
  header: 'Header',
  status: '狀態碼',
  body: 'Body（Regex）'
}

// ---------------------------------------------------------------------------------
// JSON paths
// ---------------------------------------------------------------------------------

export class JsonPathError extends Error {}

/** `data.items[0].id`, `$.data["a b"]`, `[0].name` → keys / indexes. Empty or `$` = root. */
export function parseJsonPath(path: string): (string | number)[] {
  let rest = path.trim()
  if (rest.startsWith('$')) rest = rest.slice(1)
  const parts: (string | number)[] = []
  while (rest !== '') {
    if (rest.startsWith('.')) {
      rest = rest.slice(1)
      continue
    }
    if (rest.startsWith('[')) {
      const index = /^\[\s*(\d+)\s*\]/.exec(rest)
      if (index) {
        parts.push(Number(index[1]))
        rest = rest.slice(index[0].length)
        continue
      }
      const quoted = /^\[\s*(["'])((?:\\.|(?!\1).)*)\1\s*\]/.exec(rest)
      if (quoted) {
        parts.push((quoted[2] ?? '').replace(/\\(.)/g, '$1'))
        rest = rest.slice(quoted[0].length)
        continue
      }
      throw new JsonPathError(`無效的 JSON 路徑：${path}`)
    }
    const key = /^[^.[]+/.exec(rest)?.[0] ?? ''
    parts.push(key)
    rest = rest.slice(key.length)
  }
  return parts
}

export function getJsonPath(value: unknown, path: string): { found: boolean; value: unknown } {
  let current: unknown = value
  for (const part of parseJsonPath(path)) {
    if (typeof part === 'number') {
      if (!Array.isArray(current) || part >= current.length)
        return { found: false, value: undefined }
      current = current[part]
    } else {
      if (typeof current !== 'object' || current === null || !Object.hasOwn(current, part)) {
        return { found: false, value: undefined }
      }
      current = (current as Record<string, unknown>)[part]
    }
  }
  return { found: true, value: current }
}

// ---------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------

export interface ResponseFacts {
  status: number
  timeMs: number
  headers: [string, string][]
  /** null when the body is not text (binary / too large). */
  body: string | null
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.hasOwn(b, k) &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    )
  )
}

/** Compares an actual value with the expected text, by the actual value's type. */
export function equalsExpected(actual: unknown, expected: string): boolean {
  switch (typeOf(actual)) {
    case 'string':
      return actual === expected
    case 'number':
      return expected.trim() !== '' && Number(expected) === actual
    case 'boolean':
    case 'null':
      return expected.trim() === String(actual)
    case 'object':
    case 'array':
      try {
        return deepEqual(actual, JSON.parse(expected))
      } catch {
        return false
      }
    default:
      return false
  }
}

export function formatValue(value: unknown, max = 200): string {
  if (value === undefined) return '（不存在）'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function headerValue(headers: [string, string][], name: string): string | undefined {
  const lower = name.trim().toLowerCase()
  const values = headers.filter(([k]) => k.toLowerCase() === lower).map(([, v]) => v)
  return values.length === 0 ? undefined : values.join(', ')
}

class BodyCache {
  private parsed: { ok: true; value: unknown } | { ok: false; error: string } | null = null
  constructor(private readonly body: string | null) {}
  json(): unknown {
    if (!this.parsed) {
      if (this.body === null) this.parsed = { ok: false, error: '回應不是文字，無法讀取 JSON' }
      else {
        try {
          this.parsed = { ok: true, value: JSON.parse(this.body) as unknown }
        } catch {
          this.parsed = { ok: false, error: '回應不是有效的 JSON' }
        }
      }
    }
    if (!this.parsed.ok) throw new Error(this.parsed.error)
    return this.parsed.value
  }
}

function compareNumbers(actual: unknown, expected: string, op: AssertionOperator): boolean {
  const a = typeof actual === 'number' ? actual : Number(actual)
  const e = Number(expected)
  if (expected.trim() === '' || Number.isNaN(e)) throw new Error(`預期值不是數字：${expected}`)
  if (Number.isNaN(a)) throw new Error('實際值不是數字')
  switch (op) {
    case 'gt':
      return a > e
    case 'gte':
      return a >= e
    case 'lt':
      return a < e
    default:
      return a <= e
  }
}

function contains(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual.includes(expected)
  if (Array.isArray(actual)) return actual.some((item) => equalsExpected(item, expected))
  if (typeof actual === 'object' && actual !== null) return Object.hasOwn(actual, expected)
  if (actual === undefined) return false
  return String(actual).includes(expected)
}

export function assertionLabel(row: Assertion, expected = row.expected): string {
  const target = ASSERTION_TARGET_LABELS[row.target]
  const path = row.target === 'header' || row.target === 'jsonBody' ? ` ${row.path}` : ''
  const op = ASSERTION_OPERATOR_LABELS[row.operator]
  return `${target}${path} ${op}${UNARY_OPERATORS.includes(row.operator) ? '' : ` ${expected}`}`
}

/** Evaluates the enabled rows. `resolve` substitutes `{{variables}}` in expected values. */
export function evaluateAssertions(
  rows: readonly Assertion[],
  facts: ResponseFacts,
  resolve: (text: string) => string
): AssertionResult[] {
  const body = new BodyCache(facts.body)
  const results: AssertionResult[] = []
  for (const row of rows) {
    if (!row.enabled) continue
    const expected = resolve(row.expected)
    const label = assertionLabel(row, expected)
    let actual: unknown
    try {
      switch (row.target) {
        case 'status':
          actual = facts.status
          break
        case 'responseTime':
          actual = Math.round(facts.timeMs)
          break
        case 'header':
          actual = headerValue(facts.headers, row.path)
          break
        case 'jsonBody': {
          const found = getJsonPath(body.json(), row.path)
          actual = found.found ? found.value : undefined
          break
        }
        case 'body':
          if (facts.body === null) throw new Error('回應不是文字')
          actual = facts.body
          break
      }
      let passed: boolean
      switch (row.operator) {
        case 'exists':
          passed = actual !== undefined
          break
        case 'notExists':
          passed = actual === undefined
          break
        case 'eq':
          passed = actual !== undefined && equalsExpected(actual, expected)
          break
        case 'neq':
          passed = actual === undefined || !equalsExpected(actual, expected)
          break
        case 'contains':
          passed = contains(actual, expected)
          break
        case 'notContains':
          passed = !contains(actual, expected)
          break
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
          passed = actual !== undefined && compareNumbers(actual, expected, row.operator)
          break
        case 'matches': {
          let re: RegExp
          try {
            re = new RegExp(expected)
          } catch {
            throw new Error(`無效的 Regex：${expected}`)
          }
          passed =
            actual !== undefined &&
            re.test(typeof actual === 'string' ? actual : JSON.stringify(actual))
          break
        }
        case 'isType':
          passed = actual !== undefined && typeOf(actual) === expected.trim().toLowerCase()
          break
      }
      results.push({ id: row.id, label, passed, actual: formatValue(actual) })
    } catch (error) {
      results.push({
        id: row.id,
        label,
        passed: false,
        actual: formatValue(actual),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return results
}

/** Runs the enabled extraction rows that name a variable. */
export function runExtractions(
  rows: readonly Extraction[],
  facts: ResponseFacts
): ExtractionResult[] {
  const body = new BodyCache(facts.body)
  const results: ExtractionResult[] = []
  for (const row of rows) {
    const variable = row.variable.trim()
    if (!row.enabled || variable === '') continue
    const base = { id: row.id, variable, scope: row.scope }
    try {
      let value: string | null = null
      switch (row.source) {
        case 'status':
          value = String(facts.status)
          break
        case 'header':
          value = headerValue(facts.headers, row.path) ?? null
          if (value === null) throw new Error(`找不到 Header：${row.path}`)
          break
        case 'jsonBody': {
          const found = getJsonPath(body.json(), row.path)
          if (!found.found) throw new Error(`找不到 JSON 欄位：${row.path || '$'}`)
          value =
            typeof found.value === 'string' ? found.value : (JSON.stringify(found.value) ?? 'null')
          break
        }
        case 'body': {
          if (facts.body === null) throw new Error('回應不是文字')
          if (row.path.trim() === '') {
            value = facts.body
            break
          }
          let re: RegExp
          try {
            re = new RegExp(row.path)
          } catch {
            throw new Error(`無效的 Regex：${row.path}`)
          }
          const match = re.exec(facts.body)
          if (!match) throw new Error('Regex 沒有符合的內容')
          value = match[1] ?? match[0]
          break
        }
      }
      results.push({ ...base, value })
    } catch (error) {
      results.push({
        ...base,
        value: null,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return results
}
