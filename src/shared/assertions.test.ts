import { describe, expect, it } from 'vitest'
import {
  equalsExpected,
  evaluateAssertions,
  getJsonPath,
  parseJsonPath,
  runExtractions,
  type ResponseFacts
} from './assertions'
import { assertionSchema, extractionSchema, type Assertion } from './schemas/http-request'

const facts: ResponseFacts = {
  status: 201,
  timeMs: 123.4,
  headers: [
    ['content-type', 'application/json'],
    ['set-cookie', 'a=1'],
    ['set-cookie', 'b=2']
  ],
  body: JSON.stringify({
    data: { id: 42, name: 'Hachi', tags: ['a', 'b'], 'a b': true, nothing: null },
    items: [{ id: 1 }, { id: 2 }],
    token: 'abc'
  })
}

let n = 0
const a = (row: Partial<Assertion>) => assertionSchema.parse({ id: `a${++n}`, ...row })
const run = (rows: Assertion[], f = facts) =>
  evaluateAssertions(rows, f, (t) => t.replace('{{expectedId}}', '42'))

describe('JSON paths', () => {
  it('parses dots, indexes and quoted keys', () => {
    expect(parseJsonPath('$.data.items[0]["a b"][\'c\'].d')).toEqual([
      'data',
      'items',
      0,
      'a b',
      'c',
      'd'
    ])
    expect(parseJsonPath('')).toEqual([])
    expect(parseJsonPath('[1].x')).toEqual([1, 'x'])
    expect(() => parseJsonPath('a[x]')).toThrow(/無效的 JSON 路徑/)
  })

  it('reads values and tells missing from null', () => {
    const body = JSON.parse(facts.body as string) as unknown
    expect(getJsonPath(body, 'data.id')).toEqual({ found: true, value: 42 })
    expect(getJsonPath(body, 'items[1].id')).toEqual({ found: true, value: 2 })
    expect(getJsonPath(body, 'data.nothing')).toEqual({ found: true, value: null })
    expect(getJsonPath(body, 'data.missing').found).toBe(false)
    expect(getJsonPath(body, 'items[5]').found).toBe(false)
    expect(getJsonPath(body, 'data.name.length').found).toBe(false)
  })
})

describe('equalsExpected', () => {
  it('compares by the type of the actual value', () => {
    expect(equalsExpected('42', '42')).toBe(true)
    expect(equalsExpected(42, '42.0')).toBe(true)
    expect(equalsExpected(42, '')).toBe(false)
    expect(equalsExpected(true, 'true')).toBe(true)
    expect(equalsExpected(null, 'null')).toBe(true)
    expect(equalsExpected(['a', 'b'], '["a","b"]')).toBe(true)
    expect(equalsExpected({ a: 1 }, '{"a":1}')).toBe(true)
    expect(equalsExpected({ a: 1 }, 'nope')).toBe(false)
  })
})

describe('evaluateAssertions', () => {
  it('checks status, time, headers, JSON and body', () => {
    const results = run([
      a({ target: 'status', operator: 'eq', expected: '201' }),
      a({ target: 'responseTime', operator: 'lt', expected: '500' }),
      a({ target: 'header', path: 'Content-Type', operator: 'contains', expected: 'json' }),
      a({ target: 'header', path: 'set-cookie', operator: 'eq', expected: 'a=1, b=2' }),
      a({ target: 'jsonBody', path: 'data.id', operator: 'eq', expected: '{{expectedId}}' }),
      a({ target: 'jsonBody', path: 'data.tags', operator: 'contains', expected: 'b' }),
      a({ target: 'jsonBody', path: 'data', operator: 'contains', expected: 'a b' }),
      a({ target: 'jsonBody', path: 'data.nothing', operator: 'exists' }),
      a({ target: 'jsonBody', path: 'data.missing', operator: 'notExists' }),
      a({ target: 'jsonBody', path: 'items', operator: 'isType', expected: 'array' }),
      a({ target: 'jsonBody', path: 'token', operator: 'matches', expected: '^[a-c]+$' }),
      a({ target: 'body', operator: 'notContains', expected: 'error' }),
      a({ target: 'status', operator: 'neq', expected: '500' }),
      a({ target: 'status', operator: 'gte', expected: '200' })
    ])
    expect(results.filter((r) => !r.passed)).toEqual([])
    expect(results[4]).toMatchObject({ label: 'JSON 欄位 data.id 等於 42', actual: '42' })
  })

  it('reports failures with the actual value or the reason', () => {
    const [status, missing, notNumber, badRegex, notJson] = [
      ...run([
        a({ target: 'status', operator: 'eq', expected: '200' }),
        a({ target: 'jsonBody', path: 'data.missing', operator: 'eq', expected: 'x' }),
        a({ target: 'jsonBody', path: 'data.name', operator: 'gt', expected: '1' }),
        a({ target: 'body', operator: 'matches', expected: '(' })
      ]),
      ...run([a({ target: 'jsonBody', path: 'x', operator: 'exists' })], {
        ...facts,
        body: 'plain'
      })
    ]
    expect(status).toMatchObject({ passed: false, actual: '201', label: '狀態碼 等於 200' })
    expect(missing).toMatchObject({ passed: false, actual: '（不存在）' })
    expect(notNumber).toMatchObject({ passed: false, error: '實際值不是數字' })
    expect(badRegex).toMatchObject({ passed: false, error: '無效的 Regex：(' })
    expect(notJson).toMatchObject({ passed: false, error: '回應不是有效的 JSON' })
  })

  it('skips disabled rows', () => {
    expect(run([a({ enabled: false, expected: 'x' })])).toEqual([])
  })
})

describe('runExtractions', () => {
  const e = (row: object) => extractionSchema.parse({ id: `e${++n}`, ...row })
  it('extracts from JSON, headers, status and body (regex group)', () => {
    const results = runExtractions(
      [
        e({ source: 'jsonBody', path: 'token', variable: 'token' }),
        e({ source: 'jsonBody', path: 'data.tags', variable: 'tags', scope: 'environment' }),
        e({ source: 'header', path: 'Content-Type', variable: 'ct' }),
        e({ source: 'status', variable: 'code' }),
        e({ source: 'body', path: '"name":"(\\w+)"', variable: 'name' }),
        e({ source: 'jsonBody', path: 'nope', variable: 'nope' }),
        e({ source: 'jsonBody', path: 'token', variable: '  ' }),
        e({ source: 'jsonBody', path: 'token', variable: 'off', enabled: false })
      ],
      facts
    )
    expect(results.map((r) => [r.variable, r.scope, r.value, r.error])).toEqual([
      ['token', 'runtime', 'abc', undefined],
      ['tags', 'environment', '["a","b"]', undefined],
      ['ct', 'runtime', 'application/json', undefined],
      ['code', 'runtime', '201', undefined],
      ['name', 'runtime', 'Hachi', undefined],
      ['nope', 'runtime', null, '找不到 JSON 欄位：nope']
    ])
  })
})
