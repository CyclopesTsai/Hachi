import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CCADB_PROGRAMS,
  CcadbStore,
  ccadbDate,
  parseCsv,
  parseReport,
  reportUrl,
  type CcadbCache
} from './ccadb'

const fixture = (program: string) =>
  readFileSync(path.join(import.meta.dirname, '__fixtures__', 'ccadb', `${program}.csv`), 'utf8')
const byName = <T extends { name: string }>(roots: T[], name: string) =>
  roots.filter((r) => r.name === name)

describe('CCADB reports (issue #7)', () => {
  it('parses CSV with quoted commas, quotes and newlines', () => {
    expect(parseCsv('a,"b,c","d ""e""\nf"\r\n1,2,3\r\n')).toEqual([
      ['a', 'b,c', 'd "e"\nf'],
      ['1', '2', '3']
    ])
    expect(ccadbDate('4/15/2026')).toBe('2026-04-15')
    expect(ccadbDate('12/31/2030')).toBe('2030-12-31')
    expect(ccadbDate('')).toBeNull()
  })

  it('reads the roots and the limits of each program', () => {
    const apple = parseReport('apple', fixture('apple'))
    const chrome = parseReport('chrome', fixture('chrome'))
    const microsoft = parseReport('microsoft', fixture('microsoft'))
    const mozilla = parseReport('mozilla', fixture('mozilla'))
    // The issue #4 case: TWCA CYBER Root CA is everywhere but Apple.
    expect(byName(apple, 'TWCA CYBER Root CA')).toEqual([])
    for (const list of [chrome, microsoft, mozilla]) {
      expect(byName(list, 'TWCA CYBER Root CA')[0]?.sha256).toBe(
        '3F63BB2814BE174EC8B6439CF08D6D56F0B7C405883A5648A334424D6B3EC558'
      )
    }
    expect(byName(chrome, 'TWCA Global Root CA')[0]?.sctNotAfter).toBe('2026-09-14T23:59:59.000Z')
    expect(byName(mozilla, 'Izenpe.com')[0]?.distrustAfter).toBe('2026-04-15')
    expect(byName(mozilla, 'TUBITAK Kamu SM SSL Kok Sertifikasi - Surum 1')[0]?.constraints).toBe(
      '*.tr'
    )
    expect(byName(microsoft, 'TWCA Global Root CA')[0]?.notBefore).toEqual({
      date: '2019-04-01',
      ekus: ['Code Signing']
    })
    // Apple's "allowed for TLS and …" lists are not shown.
    expect(apple.every((r) => r.constraints === undefined)).toBe(true)
    expect(apple[0]?.pem).toContain('BEGIN CERTIFICATE')
  })

  it('refuses reports that do not look right', () => {
    expect(() => parseReport('apple', 'a,b,c\n1,2,3\n')).toThrow('欄位不符預期')
    const header = fixture('apple').split('\r\n')[0] as string
    expect(() => parseReport('apple', `${header}\r\n`)).toThrow('內容不符預期')
  })
})

describe('CcadbStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'hachi-ccadb-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const reports = Object.fromEntries(
    CCADB_PROGRAMS.map((p) => [reportUrl(p.report), fixture(p.id)])
  ) as Record<string, string>
  const DAY = 86_400_000
  const start = Date.UTC(2026, 9, 22)

  function store(now: { t: number }, fail = false) {
    const fetchText = vi.fn(async (url: string) => {
      if (fail) throw new Error('offline')
      const text = reports[url]
      if (!text) throw new Error(`unexpected ${url}`)
      return text
    })
    return { fetchText, store: new CcadbStore({ dir, fetchText, now: () => now.t }) }
  }

  it('downloads once, keeps it a week, then refreshes', async () => {
    const now = { t: start }
    const a = store(now)
    const first = await a.store.get()
    expect(first.error).toBeNull()
    expect(first.cache?.fetchedAt).toBe(new Date(start).toISOString())
    expect(first.cache?.programs.mozilla).toHaveLength(12)
    expect(a.fetchText).toHaveBeenCalledTimes(4)
    const saved = JSON.parse(await readFile(path.join(dir, 'tls-roots.json'), 'utf8')) as CcadbCache
    expect(saved.version).toBe(1)

    // A new store (next launch) reads the file; within a week nothing is downloaded.
    now.t = start + 6 * DAY
    const b = store(now)
    expect((await b.store.get()).cache?.fetchedAt).toBe(first.cache?.fetchedAt)
    expect(b.fetchText).not.toHaveBeenCalled()
    // 「更新」 downloads anyway.
    await b.store.get(true)
    expect(b.fetchText).toHaveBeenCalledTimes(4)

    now.t = start + 14 * DAY
    const c = store(now)
    expect((await c.store.get()).cache?.fetchedAt).toBe(new Date(now.t).toISOString())
    expect(c.fetchText).toHaveBeenCalledTimes(4)
  })

  it('keeps the older copy when the download fails', async () => {
    const now = { t: start }
    await store(now).store.get()
    now.t = start + 10 * DAY
    const offline = await store(now, true).store.get()
    expect(offline.error).toBe('offline')
    expect(offline.cache?.fetchedAt).toBe(new Date(start).toISOString())
  })

  it('says so when there is nothing and no network, and recovers from a broken file', async () => {
    const now = { t: start }
    expect(await store(now, true).store.get()).toEqual({ cache: null, error: 'offline' })
    await writeFile(path.join(dir, 'tls-roots.json'), '{ broken')
    const s = store(now)
    expect((await s.store.get()).cache).not.toBeNull()
    expect(s.fetchText).toHaveBeenCalledTimes(4)
  })

  it('downloads only once for checks running at the same time', async () => {
    const s = store({ t: start })
    await Promise.all([s.store.get(), s.store.get(), s.store.get()])
    expect(s.fetchText).toHaveBeenCalledTimes(4)
  })
})
