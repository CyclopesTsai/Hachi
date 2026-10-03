import { describe, expect, it } from 'vitest'
import {
  DataFileError,
  RunnerStatsCollector,
  latencyStats,
  parseCsv,
  parseDataFile,
  parseJsonData,
  percentile,
  type RunnerRow
} from './runner'

describe('percentile / latencyStats', () => {
  it('uses nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(sorted, 50)).toBe(50)
    expect(percentile(sorted, 95)).toBe(95)
    expect(percentile(sorted, 99)).toBe(99)
    expect(percentile([7], 99)).toBe(7)
    expect(percentile([], 50)).toBe(0)
  })

  it('computes avg / min / max / stdDev', () => {
    expect(latencyStats([2, 4, 4, 4, 5, 5, 7, 9])).toMatchObject({
      count: 8,
      avg: 5,
      min: 2,
      max: 9,
      p50: 4,
      stdDev: 2
    })
    expect(latencyStats([])).toBeNull()
  })
})

describe('RunnerStatsCollector', () => {
  const row = (over: Partial<RunnerRow>): RunnerRow => ({
    index: 0,
    round: 0,
    worker: 0,
    itemId: 'a',
    name: 'A',
    method: 'GET',
    url: 'x',
    status: 200,
    statusText: 'OK',
    errorCode: null,
    errorMessage: null,
    timeMs: 10,
    sizeBytes: 1,
    testsPassed: 1,
    testsTotal: 1,
    failed: false,
    startedAt: 0,
    ...over
  })

  it('aggregates per request, totals, distributions and a per-second timeline', () => {
    const c = new RunnerStatsCollector([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' }
    ])
    c.add(row({ timeMs: 10, startedAt: 100 }))
    c.add(
      row({
        timeMs: 30,
        startedAt: 500,
        status: 500,
        statusText: 'ERR',
        failed: true,
        testsPassed: 0
      })
    )
    c.add(
      row({
        itemId: 'b',
        name: 'B',
        status: null,
        errorCode: 'TIMEOUT',
        timeMs: 2000,
        startedAt: 900,
        failed: true,
        testsTotal: 0,
        testsPassed: 0
      })
    )
    const s = c.snapshot()
    expect(
      s.items.map((i) => [i.name, i.count, i.failed, i.errorRate, i.testsPassed, i.testsFailed])
    ).toEqual([
      ['A', 2, 1, 0.5, 1, 1],
      ['B', 1, 1, 1, 0, 0]
    ])
    expect(s.items[0]?.latency).toMatchObject({ count: 2, avg: 20, min: 10, max: 30 })
    expect(s.items[1]?.latency).toBeNull()
    expect(s.total).toMatchObject({ name: '總計', count: 3, succeeded: 1, failed: 2 })
    expect(s.statusCodes).toEqual({ '200': 1, '500': 1 })
    expect(s.errorCodes).toEqual({ TIMEOUT: 1 })
    expect(s.timeline).toEqual([
      { second: 0, requests: 2, p50: 10, p95: 30 },
      { second: 1, requests: 0, p50: null, p95: null },
      { second: 2, requests: 1, p50: null, p95: null }
    ])
  })
})

describe('data files', () => {
  it('parses CSV with quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    expect(
      parseCsv('\uFEFFuser,note\r\nalice,"hi, there"\r\n\r\nbob,"say ""yo"""\ncarol\n')
    ).toEqual([
      { user: 'alice', note: 'hi, there' },
      { user: 'bob', note: 'say "yo"' },
      { user: 'carol', note: '' }
    ])
    expect(parseCsv('a,b\n"multi\nline",2')).toEqual([{ a: 'multi\nline', b: '2' }])
    expect(() => parseCsv('a\n"open')).toThrow(DataFileError)
    expect(() => parseCsv('')).toThrow(/沒有欄位名稱/)
  })

  it('parses JSON arrays of objects', () => {
    expect(parseJsonData('[{"id":1,"tags":["a"],"name":"x","none":null}]')).toEqual([
      { id: '1', tags: '["a"]', name: 'x', none: '' }
    ])
    expect(() => parseJsonData('{"a":1}')).toThrow(/物件陣列/)
    expect(() => parseJsonData('[1]')).toThrow(/第 1 筆/)
  })

  it('picks the parser by extension and rejects empty files', () => {
    expect(parseDataFile('users.JSON', '[{"a":"1"}]')).toEqual([{ a: '1' }])
    expect(parseDataFile('users.csv', 'a\n1')).toEqual([{ a: '1' }])
    expect(() => parseDataFile('x.csv', 'a\n')).toThrow(/沒有任何資料列/)
  })
})
