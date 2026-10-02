import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { HachiError } from '@shared/errors'
import type { ExportResult, ImportReport } from '@shared/ipc/api'
import { VARIABLES_MAX, type Variable } from '@shared/schemas/collection'
import { slugify } from '@shared/file-names'
import { countItems } from '@shared/transfer/portable'
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

/** Import (Postman Collection / Environment) and export (Postman Collection v2.1). */
export class TransferService {
  constructor(
    private readonly collections: CollectionService,
    private readonly environments: EnvironmentService
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
          warnings
        }
      }
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
          warnings
        }
      }
    } catch (error) {
      if (error instanceof TransferError) throw new HachiError('INVALID_FILE', error.message)
      throw error
    }
    throw new HachiError('INVALID_FILE', unsupportedReason(json))
  }

  /** Postman Collection v2.1 JSON of a Collection, plus what could not be exported. */
  async exportPostman(collectionId: string): Promise<{
    fileName: string
    content: string
    result: Omit<ExportResult, 'path'>
  }> {
    const { collection, unreadable } = await this.collections.exportCollection(collectionId)
    const exported = exportPostmanCollection(collection, randomUUID())
    return {
      fileName: `${slugify(collection.name)}.postman_collection.json`,
      content: `${JSON.stringify(exported.json, null, 2)}\n`,
      result: { skipped: exported.skipped, unreadable, warnings: exported.warnings }
    }
  }
}
