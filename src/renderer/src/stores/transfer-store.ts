import { create } from 'zustand'
import type {
  BrunoCollectionChoice,
  ExportFormat,
  ImportOutcome,
  ImportReport
} from '@shared/ipc/api'
import { MAX_CURL_TEXT, parseCurl } from '@shared/transfer/curl'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useAppStore } from './app-store'
import { useEnvStore } from './env-store'
import { useTabsStore } from './tabs-store'
import { useTreeStore } from './tree-store'
import { msg } from '@shared/i18n'

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
export const EXPORT_FORMATS: ExportFormat[] = [
  'postman',
  'bruno-yaml',
  'bruno',
  'openapi-html',
  'openapi-json'
]
export const exportFormatLabel = (format: ExportFormat): string => msg().transfer.formats[format]

interface TransferState {
  curlOpen: boolean
  /** Collection whose export dialog is open. */
  exportId: string | null
  result: { title: string; entries: TransferResultEntry[] } | null
  /** A chosen folder holds several Bruno collections: which ones to import. */
  brunoChoice: { scanId: string; folder: string; collections: BrunoCollectionChoice[] } | null
  busy: boolean

  setCurlOpen(open: boolean): void
  /** Parses a cURL command and opens it as a new unsaved tab. Throws on parse errors. */
  importCurl(text: string): void
  /** Native open dialog, then import. */
  importFile(): Promise<void>
  /** Files dropped on the window (decision 68). */
  importDropped(files: File[]): Promise<void>
  /** Folder dialog, then imports a Bruno collection folder (or asks which collections). */
  importBrunoFolder(): Promise<void>
  /** Imports the collections picked from `brunoChoice`. */
  importBrunoChoice(paths: string[]): Promise<void>
  cancelBrunoChoice(): void
  setExportId(collectionId: string | null): void
  exportCollection(
    collectionId: string,
    format: ExportFormat,
    environmentId: string | null
  ): Promise<void>
  closeResult(): void
}

function reportEntry(report: ImportReport): TransferResultEntry {
  const r = msg().transfer.report
  const lines =
    report.kind === 'collection'
      ? [
          r.createdCollection(report.name),
          r.counts(report.requests, report.folders, report.variables),
          ...(report.environments.length > 0 ? [r.createdEnvironments(report.environments)] : [])
        ]
      : [r.createdEnvironment(report.name), r.variables(report.variables)]
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

function outcomeEntry(outcome: ImportOutcome): TransferResultEntry {
  return outcome.report
    ? reportEntry(outcome.report)
    : {
        title: outcome.fileName,
        lines: [],
        warnings: [],
        error: outcome.error ?? msg().transfer.report.failed
      }
}

/** Shows the results of importing several Bruno collections. */
async function showOutcomes(outcomes: ImportOutcome[]): Promise<void> {
  for (const outcome of outcomes) if (outcome.report) await revealImported(outcome.report)
  useTransferStore.setState({
    result: { title: msg().transfer.report.results, entries: outcomes.map(outcomeEntry) }
  })
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
    store.setState({
      result: { title: msg().transfer.report.done, entries: [reportEntry(report)] }
    })
  } catch (error) {
    useAppStore.getState().setNotice(errorMessage(error))
  } finally {
    store.setState({ busy: false })
  }
}

export const useTransferStore = create<TransferState>()((set, get) => ({
  curlOpen: false,
  exportId: null,
  brunoChoice: null,
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
          title: msg().transfer.report.curlImported,
          entries: [{ title: request.name, lines: [msg().transfer.report.openedAsDraft], warnings }]
        }
      })
    }
  },

  async importFile() {
    await importWith(() => window.hachi.transfer.importFile())
  },

  async importBrunoFolder() {
    if (get().busy) return
    set({ busy: true })
    try {
      const result = await unwrap(window.hachi.transfer.importBrunoFolder())
      if (!result) return
      if (result.kind === 'choose') {
        const { scanId, folder, collections } = result
        set({ brunoChoice: { scanId, folder, collections } })
        return
      }
      const [only] = result.results
      if (result.results.length === 1 && only?.report) {
        await revealImported(only.report)
        set({ result: { title: msg().transfer.report.done, entries: [reportEntry(only.report)] } })
      } else {
        await showOutcomes(result.results)
      }
    } catch (error) {
      useAppStore.getState().setNotice(errorMessage(error))
    } finally {
      set({ busy: false })
    }
  },

  async importBrunoChoice(paths) {
    const choice = get().brunoChoice
    if (!choice || get().busy || paths.length === 0) return
    set({ busy: true })
    try {
      const outcomes = await unwrap(
        window.hachi.transfer.importBrunoCollections({ scanId: choice.scanId, paths })
      )
      set({ brunoChoice: null })
      await showOutcomes(outcomes)
    } catch (error) {
      set({ brunoChoice: null })
      useAppStore.getState().setNotice(errorMessage(error))
    } finally {
      set({ busy: false })
    }
  },

  cancelBrunoChoice() {
    set({ brunoChoice: null })
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
        warnings.push(msg().transfer.report.noWebSocket(result.skipped))
      }
      if (result.unreadable.length > 0) {
        warnings.push(msg().transfer.report.unreadable(result.unreadable))
      }
      set({
        result: {
          title: msg().transfer.report.exported,
          entries: [
            {
              title: exportFormatLabel(format),
              lines: [msg().transfer.report.savedTo(result.path)],
              warnings
            }
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
          if (file.size > MAX_DROP_BYTES) throw new Error(msg().transfer.report.tooLarge)
          const text = await file.text()
          // A text file holding a cURL command opens as a new request.
          if (/^\s*(\$\s+)?curl(\.exe)?\s/i.test(text) && text.length <= MAX_CURL_TEXT) {
            const { request, warnings } = parseCurl(text)
            useTabsStore.getState().openDraft(request)
            entries.push({ title: file.name, lines: [msg().transfer.report.curlFile], warnings })
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
          title: msg().transfer.report.rest(files.length - MAX_DROP_FILES),
          lines: [],
          warnings: [],
          error: msg().transfer.report.tooMany(MAX_DROP_FILES)
        })
      }
      set({ result: { title: msg().transfer.report.results, entries } })
    } finally {
      set({ busy: false })
    }
  },

  closeResult() {
    set({ result: null })
  }
}))
