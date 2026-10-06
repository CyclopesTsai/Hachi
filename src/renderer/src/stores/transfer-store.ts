import { create } from 'zustand'
import type { ExportFormat, ImportReport } from '@shared/ipc/api'
import { MAX_CURL_TEXT, parseCurl } from '@shared/transfer/curl'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from './app-store'
import { useEnvStore } from './env-store'
import { useTabsStore } from './tabs-store'
import { useTreeStore } from './tree-store'

/** One block of the result dialog (one imported file, or the export). */
export interface TransferResultEntry {
  title: string
  lines: string[]
  warnings: string[]
  error?: string
}

/** Dropped files larger than this are rejected before being read. */
const MAX_DROP_BYTES = 50 * 1024 * 1024
const MAX_DROP_FILES = 20

/** Formats offered in the export dialog (decision 105). */
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  postman: 'Postman Collection v2.1',
  bruno: 'Bruno 資料夾',
  'openapi-html': 'OpenAPI 文件（HTML）',
  'openapi-json': 'OpenAPI 3.0（JSON）'
}

interface TransferState {
  curlOpen: boolean
  /** Collection whose export dialog is open. */
  exportId: string | null
  result: { title: string; entries: TransferResultEntry[] } | null
  busy: boolean

  setCurlOpen(open: boolean): void
  /** Parses a cURL command and opens it as a new unsaved tab. Throws on parse errors. */
  importCurl(text: string): void
  /** Native open dialog, then import. */
  importFile(): Promise<void>
  /** Files dropped on the window (decision 68). */
  importDropped(files: File[]): Promise<void>
  /** Folder dialog, then imports a Bruno collection folder. */
  importBrunoFolder(): Promise<void>
  setExportId(collectionId: string | null): void
  exportCollection(
    collectionId: string,
    format: ExportFormat,
    environmentId: string | null
  ): Promise<void>
  closeResult(): void
}

function reportEntry(report: ImportReport): TransferResultEntry {
  const lines =
    report.kind === 'collection'
      ? [
          `已建立 Collection「${report.name}」`,
          `${report.requests} 個請求、${report.folders} 個資料夾、${report.variables} 個變數`,
          ...(report.environments.length > 0
            ? [`已建立環境：${report.environments.map((n) => `「${n}」`).join('、')}`]
            : [])
        ]
      : [`已建立環境「${report.name}」`, `${report.variables} 個變數`]
  return { title: report.fileName, lines, warnings: report.warnings }
}

/** Shows what an import created: the new Collection in the tree, or the environment list. */
async function revealImported(report: ImportReport): Promise<void> {
  if (report.kind === 'collection') {
    useTreeStore.getState().reveal(report.id)
    useTreeStore.getState().expand(report.id)
  }
  if (report.kind === 'environment' || report.environments.length > 0) {
    await useEnvStore.getState().loadList()
  }
}

/** Runs a native-dialog import and shows its report (nothing when cancelled). */
async function importWith(run: typeof window.hachi.transfer.importFile): Promise<void> {
  const store = useTransferStore
  if (store.getState().busy) return
  store.setState({ busy: true })
  try {
    const report = await unwrap(run())
    if (!report) return
    await revealImported(report)
    store.setState({ result: { title: '匯入完成', entries: [reportEntry(report)] } })
  } catch (error) {
    useAppStore.getState().setNotice(errorMessage(error))
  } finally {
    store.setState({ busy: false })
  }
}

export const useTransferStore = create<TransferState>()((set, get) => ({
  curlOpen: false,
  exportId: null,
  result: null,
  busy: false,

  setCurlOpen(open) {
    set({ curlOpen: open })
  },

  importCurl(text) {
    const { request, warnings } = parseCurl(text)
    useTabsStore.getState().openDraft(request)
    set({ curlOpen: false })
    if (warnings.length > 0) {
      set({
        result: {
          title: '已匯入 cURL',
          entries: [{ title: request.name, lines: ['已開成未儲存的新分頁'], warnings }]
        }
      })
    }
  },

  async importFile() {
    await importWith(() => window.hachi.transfer.importFile())
  },

  async importBrunoFolder() {
    await importWith(() => window.hachi.transfer.importBrunoFolder())
  },

  setExportId(collectionId) {
    set({ exportId: collectionId })
  },

  async exportCollection(collectionId, format, environmentId) {
    try {
      const result = await unwrap(
        window.hachi.transfer.export({ id: collectionId, format, environmentId })
      )
      if (!result) return
      set({ exportId: null })
      const warnings = [...result.warnings]
      if (result.skipped.length > 0) {
        warnings.push(`這個格式不支援 WebSocket，以下項目未匯出：${result.skipped.join('、')}`)
      }
      if (result.unreadable.length > 0) {
        warnings.push(`以下項目的檔案無法讀取，未匯出：${result.unreadable.join('、')}`)
      }
      set({
        result: {
          title: '匯出完成',
          entries: [
            { title: EXPORT_FORMAT_LABELS[format], lines: [`已儲存到 ${result.path}`], warnings }
          ]
        }
      })
    } catch (error) {
      useAppStore.getState().setNotice(errorMessage(error))
    }
  },

  async importDropped(files) {
    if (get().busy || files.length === 0) return
    set({ busy: true })
    const entries: TransferResultEntry[] = []
    try {
      for (const file of files.slice(0, MAX_DROP_FILES)) {
        try {
          if (file.size > MAX_DROP_BYTES) throw new Error('檔案太大（上限 50 MB）')
          const text = await file.text()
          // A text file holding a cURL command opens as a new request.
          if (/^\s*(\$\s+)?curl(\.exe)?\s/i.test(text) && text.length <= MAX_CURL_TEXT) {
            const { request, warnings } = parseCurl(text)
            useTabsStore.getState().openDraft(request)
            entries.push({ title: file.name, lines: ['cURL 已開成未儲存的新分頁'], warnings })
            continue
          }
          const report = await unwrap(
            window.hachi.transfer.importText({ fileName: file.name, text })
          )
          await revealImported(report)
          entries.push(reportEntry(report))
        } catch (error) {
          entries.push({ title: file.name, lines: [], warnings: [], error: errorMessage(error) })
        }
      }
      if (files.length > MAX_DROP_FILES) {
        entries.push({
          title: `其餘 ${files.length - MAX_DROP_FILES} 個檔案`,
          lines: [],
          warnings: [],
          error: `一次最多匯入 ${MAX_DROP_FILES} 個檔案`
        })
      }
      set({ result: { title: '匯入結果', entries } })
    } finally {
      set({ busy: false })
    }
  },

  closeResult() {
    set({ result: null })
  }
}))
