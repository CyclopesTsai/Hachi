import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { HachiError } from '@shared/errors'
import type { ExportFormat, ExportResult, ImportReport } from '@shared/ipc/api'
import { VARIABLES_MAX, type Variable } from '@shared/schemas/collection'
import { slugify } from '@shared/file-names'
import {
  exportBrunoCollection,
  importBrunoFolder,
  importBrunoJson,
  isBrunoJson,
  safeName,
  type BrunoImport
} from '@shared/transfer/bruno'
import { buildOpenApi, openApiHtml } from '@shared/transfer/openapi'
import { countItems, type PortableEnvironment } from '@shared/transfer/portable'
import {
  TransferError,
  detectImportFormat,
  exportPostmanCollection,
  importPostmanCollection,
  importPostmanEnvironment,
  unsupportedReason
} from '@shared/transfer/postman'
import type { CollectionService } from './collection-service'
import type { EnvironmentService } from './environment-service'

/** Files larger than this are not imported. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024
/** A Bruno collection folder: at most this many .bru files, MAX_IMPORT_BYTES in total. */
export const MAX_BRUNO_FILES = 5000

/** What an export produces: one file, or a folder of files (Bruno). */
export type ExportOutput =
  | { kind: 'file'; fileName: string; content: string; result: Omit<ExportResult, 'path'> }
  | {
      kind: 'folder'
      folderName: string
      files: Record<string, string>
      result: Omit<ExportResult, 'path'>
    }

/** Loads the Redoc standalone bundle (MIT) and its license notices, only when needed. */
export type RedocLoader = () => Promise<{ bundle: string; licenses: string }>

/** Reads the .bru files (and bruno.json) of a Bruno collection folder, by relative path. */
export async function readBrunoFolder(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  let count = 0
  let bytes = 0
  async function walk(abs: string, rel: string[]): Promise<void> {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const child = path.join(abs, entry.name)
      if (entry.isDirectory()) {
        await walk(child, [...rel, entry.name])
        continue
      }
      const relPath = [...rel, entry.name].join('/')
      if (!entry.isFile() || !(entry.name.endsWith('.bru') || relPath === 'bruno.json')) continue
      if (++count > MAX_BRUNO_FILES) {
        throw new HachiError('INVALID_FILE', `檔案太多（上限 ${MAX_BRUNO_FILES} 個 .bru 檔）`)
      }
      const text = await readFile(child, 'utf8')
      bytes += Buffer.byteLength(text)
      if (bytes > MAX_IMPORT_BYTES) throw new HachiError('INVALID_FILE', '資料夾太大（上限 50 MB）')
      files[relPath] = text
    }
  }
  try {
    await walk(dir, [])
  } catch (error) {
    if (error instanceof HachiError) throw error
    throw new HachiError('NOT_FOUND', '無法讀取資料夾')
  }
  return files
}

function limitVariables(variables: Variable[], warnings: string[]): Variable[] {
  if (variables.length <= VARIABLES_MAX) return variables
  warnings.push(`變數超過 ${VARIABLES_MAX} 個，只匯入前 ${VARIABLES_MAX} 個`)
  return variables.slice(0, VARIABLES_MAX)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw new HachiError('INVALID_FILE', '不是有效的 JSON 檔案')
  }
}

/**
 * Import (Postman Collection / Environment, Bruno JSON / folder) and export (Postman
 * Collection v2.1, Bruno folder, OpenAPI JSON / HTML).
 */
export class TransferService {
  constructor(
    private readonly collections: CollectionService,
    private readonly environments: EnvironmentService,
    private readonly loadRedoc: RedocLoader
  ) {}

  async importFile(absPath: string): Promise<ImportReport> {
    let size: number
    try {
      size = (await stat(absPath)).size
    } catch {
      throw new HachiError('NOT_FOUND', '找不到檔案')
    }
    if (size > MAX_IMPORT_BYTES) {
      throw new HachiError('INVALID_FILE', '檔案太大（上限 50 MB）')
    }
    return this.importText(path.basename(absPath), await readFile(absPath, 'utf8'))
  }

  /** Imports file content (e.g. a file dropped on the window). */
  async importText(fileName: string, text: string): Promise<ImportReport> {
    const json = parseJson(text)
    const format = detectImportFormat(json)
    try {
      if (format === 'postman-collection') {
        const { collection, warnings } = importPostmanCollection(json)
        collection.variables = limitVariables(collection.variables, warnings)
        const { id } = await this.collections.importCollection(collection)
        const tree = await this.collections.getTree()
        const counts = countItems(collection)
        return {
          kind: 'collection',
          id,
          name: tree.collections.find((c) => c.id === id)?.name ?? collection.name,
          fileName,
          folders: counts.folders,
          requests: counts.requests,
          variables: collection.variables.length,
          environments: [],
          warnings
        }
      }
      if (isBrunoJson(json)) return await this.saveBruno(fileName, importBrunoJson(json))
      if (format === 'postman-environment') {
        const env = importPostmanEnvironment(json)
        const warnings: string[] = []
        env.variables = limitVariables(env.variables, warnings)
        const { id, list } = await this.environments.importEnvironment(env)
        return {
          kind: 'environment',
          id,
          name: list.find((e) => e.id === id)?.name ?? env.name,
          fileName,
          folders: 0,
          requests: 0,
          variables: env.variables.length,
          environments: [],
          warnings
        }
      }
    } catch (error) {
      if (error instanceof TransferError) throw new HachiError('INVALID_FILE', error.message)
      throw error
    }
    throw new HachiError('INVALID_FILE', unsupportedReason(json))
  }

  /** Imports a Bruno collection folder (bruno.json + .bru files). */
  async importBrunoFolder(dir: string): Promise<ImportReport> {
    const files = await readBrunoFolder(dir)
    try {
      return await this.saveBruno(path.basename(dir), importBrunoFolder(files))
    } catch (error) {
      if (error instanceof TransferError) throw new HachiError('INVALID_FILE', error.message)
      throw error
    }
  }

  /** Writes an imported Bruno collection and its environments. */
  private async saveBruno(fileName: string, imported: BrunoImport): Promise<ImportReport> {
    const { collection } = imported
    const warnings = [...imported.warnings]
    collection.variables = limitVariables(collection.variables, warnings)
    const { id } = await this.collections.importCollection(collection)
    const environments: string[] = []
    for (const env of imported.environments) {
      env.variables = limitVariables(env.variables, warnings)
      const created = await this.environments.importEnvironment(env)
      environments.push(created.list.find((e) => e.id === created.id)?.name ?? env.name)
    }
    const tree = await this.collections.getTree()
    const counts = countItems(collection)
    return {
      kind: 'collection',
      id,
      name: tree.collections.find((c) => c.id === id)?.name ?? collection.name,
      fileName,
      folders: counts.folders,
      requests: counts.requests,
      variables: collection.variables.length,
      environments,
      warnings
    }
  }

  /** A Collection in the given format, plus what could not be exported. */
  async export(
    collectionId: string,
    format: ExportFormat,
    environmentId: string | null
  ): Promise<ExportOutput> {
    const { collection, unreadable } = await this.collections.exportCollection(collectionId)
    const slug = slugify(collection.name)
    switch (format) {
      case 'postman': {
        const exported = exportPostmanCollection(collection, randomUUID())
        return {
          kind: 'file',
          fileName: `${slug}.postman_collection.json`,
          content: `${JSON.stringify(exported.json, null, 2)}\n`,
          result: { skipped: exported.skipped, unreadable, warnings: exported.warnings }
        }
      }
      case 'bruno': {
        const environments: PortableEnvironment[] = []
        for (const summary of await this.environments.list()) {
          const env = await this.environments.get(summary.id)
          environments.push({ name: env.name, variables: env.variables })
        }
        const exported = exportBrunoCollection(collection, environments)
        return {
          kind: 'folder',
          folderName: safeName(collection.name),
          files: exported.files,
          result: { skipped: exported.skipped, unreadable, warnings: exported.warnings }
        }
      }
      case 'openapi-json':
      case 'openapi-html': {
        // Collection variables, overridden by the chosen environment. Secrets stay out of
        // a document meant to be shared.
        const values: Record<string, string> = {}
        const add = (variables: Variable[]) => {
          for (const v of variables)
            if (v.enabled && !v.secret && v.key !== '') values[v.key] = v.value
        }
        add(collection.variables)
        if (environmentId) add((await this.environments.get(environmentId)).variables)
        const { document, skipped, warnings } = buildOpenApi(collection, values)
        const result = { skipped, unreadable, warnings }
        if (format === 'openapi-json') {
          return {
            kind: 'file',
            fileName: `${slug}.openapi.json`,
            content: `${JSON.stringify(document, null, 2)}\n`,
            result
          }
        }
        return {
          kind: 'file',
          fileName: `${slug}.html`,
          content: openApiHtml(document, await this.loadRedoc()),
          result
        }
      }
    }
  }
}
