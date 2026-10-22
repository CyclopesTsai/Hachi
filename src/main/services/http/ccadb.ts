/**
 * Root program inclusion from CCADB (issue #7): the TLS reports Apple, Chrome, Microsoft
 * and Mozilla publish through the Common CA Database list the roots each program
 * includes, with their limits. They are downloaded only when a certificate check needs
 * them (nothing about the checked site is sent), kept in `<userData>/ccadb/` and
 * refreshed after a week. Used for display only — never as a trust store.
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { CcadbProgram } from '@shared/http'
import { writeJsonAtomic } from '../fs/atomic-write'
import { msg } from '@shared/i18n'

const REPORT_BASE = 'https://ccadb.my.salesforce-sites.com/ccadb/Report?Name='

export const CCADB_PROGRAMS: { id: CcadbProgram; report: string }[] = [
  { id: 'apple', report: 'AppleTLSServerAuthenticationCSV' },
  { id: 'chrome', report: 'ChromeTLSServerAuthenticationCSV' },
  { id: 'microsoft', report: 'MicrosoftTLSServerAuthenticationCSV' },
  { id: 'mozilla', report: 'MozillaTLSServerAuthenticationCSV' }
]

export const reportUrl = (report: string) => `${REPORT_BASE}${report}`

/** A report is a few hundred KB today. */
export const CCADB_MAX_REPORT_BYTES = 4 * 1024 * 1024
const MAX_AGE_MS = 7 * 86_400_000
/** Fewer roots than this means the report is not what we expect. */
const MIN_ROOTS = 10

const rootSchema = z.object({
  /** Upper-case hex, no colons. */
  sha256: z.string(),
  name: z.string(),
  pem: z.string(),
  /** Mozilla: TLS certificates issued after this date are not trusted (ISO date). */
  distrustAfter: z.string().optional(),
  /** Chrome: certificates whose SCTs are all after this time are not trusted (ISO). */
  sctNotAfter: z.string().optional(),
  /** Microsoft: certificates issued from this date are not trusted for these EKUs. */
  notBefore: z.object({ date: z.string(), ekus: z.array(z.string()) }).optional(),
  /** Microsoft: the root is disabled from this date. */
  disabledAfter: z.string().optional(),
  /** Microsoft: EKUs the root may not be used for. */
  disallowedEkus: z.array(z.string()).optional(),
  /** Constraints shown as they are (Apple / Mozilla applied constraints, Microsoft TLDs). */
  constraints: z.string().optional()
})
export type CcadbRoot = z.infer<typeof rootSchema>

const cacheSchema = z.object({
  version: z.literal(1),
  fetchedAt: z.string(),
  programs: z.object({
    apple: z.array(rootSchema),
    chrome: z.array(rootSchema),
    microsoft: z.array(rootSchema),
    mozilla: z.array(rootSchema)
  })
})
export type CcadbCache = z.infer<typeof cacheSchema>

/** RFC 4180 CSV (quoted fields may hold commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** "4/15/2026" (CCADB's M/D/YYYY, GMT) → "2026-04-15"; null when it does not parse. */
export function ccadbDate(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!m) return null
  const date = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])))
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

const list = (value: string) =>
  value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

/** One program's report → its roots. Throws when the columns are not the expected ones. */
export function parseReport(program: CcadbProgram, csv: string): CcadbRoot[] {
  const [header, ...rows] = parseCsv(csv)
  const col = (name: string) => header?.indexOf(name) ?? -1
  const sha = col('SHA-256 Fingerprint')
  const name = col('Certificate Name')
  const pem = col('X.509 Certificate (PEM)')
  if (sha < 0 || name < 0 || pem < 0) throw new Error(msg().tlsCheck.programs.badColumns)
  const cell = (row: string[], column: string) => {
    const i = col(column)
    return i >= 0 ? (row[i] ?? '').trim() : ''
  }
  const roots: CcadbRoot[] = []
  for (const row of rows) {
    const fingerprint = (row[sha] ?? '').replace(/:/g, '').trim().toUpperCase()
    if (!/^[0-9A-F]{64}$/.test(fingerprint) || !row[pem]?.includes('BEGIN CERTIFICATE')) continue
    const root: CcadbRoot = { sha256: fingerprint, name: (row[name] ?? '').trim(), pem: row[pem] }
    if (program === 'mozilla') {
      const after = ccadbDate(cell(row, 'Distrust for TLS After Date'))
      if (after) root.distrustAfter = after
      const constraints = cell(row, 'Mozilla Applied Constraints')
      if (constraints) root.constraints = constraints
    } else if (program === 'chrome') {
      const seconds = Number(cell(row, 'sct_not_after_sec'))
      if (cell(row, 'sct_not_after_sec') && Number.isFinite(seconds)) {
        root.sctNotAfter = new Date(seconds * 1000).toISOString()
      }
    } else if (program === 'microsoft') {
      const notBefore = ccadbDate(cell(row, 'Microsoft Not Before Date'))
      if (notBefore) {
        root.notBefore = { date: notBefore, ekus: list(cell(row, 'Microsoft Not Before EKU List')) }
      }
      const disabled = ccadbDate(cell(row, 'Microsoft Disabled Date'))
      if (disabled) root.disabledAfter = disabled
      const disallowed = list(cell(row, 'Microsoft Disallow EKU List'))
      if (disallowed.length > 0) root.disallowedEkus = disallowed
      const tlds = cell(row, 'Microsoft TLD Restriction')
      if (tlds) root.constraints = tlds
    } else {
      // Mostly the uses it is allowed for; only worth showing when TLS is not one of them.
      const constraints = cell(row, 'Apple Applied Constraints')
      if (constraints && !/Server Authentication/.test(constraints)) root.constraints = constraints
    }
    roots.push(root)
  }
  if (roots.length < MIN_ROOTS) throw new Error(msg().tlsCheck.programs.badContent)
  return roots
}

export interface CcadbSnapshot {
  cache: CcadbCache | null
  /** Why the reports could not be downloaded (the older cache, if any, is used). */
  error: string | null
}

/** Downloads, parses and caches the four reports; one download at a time. */
export class CcadbStore {
  private memory: CcadbCache | null = null
  private loading: Promise<CcadbSnapshot> | null = null

  constructor(
    private readonly options: {
      dir: string
      /** GETs a report (through the App's proxy); rejects on failure. */
      fetchText(url: string): Promise<string>
      now?: () => number
    }
  ) {}

  private get file(): string {
    return path.join(this.options.dir, 'tls-roots.json')
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async read(): Promise<CcadbCache | null> {
    if (this.memory) return this.memory
    try {
      const parsed = cacheSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      this.memory = parsed.success ? parsed.data : null
    } catch {
      this.memory = null // missing or unreadable: download again
    }
    return this.memory
  }

  /** The reports, downloaded first when missing, older than a week or `refresh`. */
  get(refresh = false): Promise<CcadbSnapshot> {
    this.loading ??= this.load(refresh).finally(() => {
      this.loading = null
    })
    return this.loading
  }

  private async load(refresh: boolean): Promise<CcadbSnapshot> {
    const cached = await this.read()
    const fresh = cached && this.now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS
    if (cached && fresh && !refresh) return { cache: cached, error: null }
    try {
      const reports = await Promise.all(
        CCADB_PROGRAMS.map(
          async (p) =>
            [p.id, parseReport(p.id, await this.options.fetchText(reportUrl(p.report)))] as const
        )
      )
      const cache: CcadbCache = {
        version: 1,
        fetchedAt: new Date(this.now()).toISOString(),
        programs: Object.fromEntries(reports) as CcadbCache['programs']
      }
      await mkdir(this.options.dir, { recursive: true })
      await writeJsonAtomic(this.file, cache)
      this.memory = cache
      return { cache, error: null }
    } catch (error) {
      return { cache: cached, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
