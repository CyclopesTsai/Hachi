/**
 * Preload script (runs sandboxed, with contextIsolation).
 *
 * Exposes a fixed whitelist API as `window.hachi`. The raw `ipcRenderer` is
 * never exposed; the renderer can only call the functions below and subscribe
 * to the event channels listed in EVENT_CHANNELS.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EventPayloads, HachiApi, IpcResult, InvokeMap } from '@shared/ipc/api'
import { EVENT_CHANNELS, INVOKE, type EventChannel, type InvokeChannel } from '@shared/ipc/channels'

function invoke<C extends InvokeChannel>(
  channel: C,
  input?: InvokeMap[C]['input']
): Promise<IpcResult<InvokeMap[C]['output']>> {
  return ipcRenderer.invoke(channel, input) as Promise<IpcResult<InvokeMap[C]['output']>>
}

const api: HachiApi = {
  app: {
    getInfo: () => invoke(INVOKE.appGetInfo),
    getDefaultWorkspaceDir: () => invoke(INVOKE.appGetDefaultWorkspaceDir),
    setCloseGuard: (input) => invoke(INVOKE.appSetCloseGuard, input),
    confirmClose: () => invoke(INVOKE.appConfirmClose)
  },
  config: {
    get: () => invoke(INVOKE.configGet),
    update: (input) => invoke(INVOKE.configUpdate, input)
  },
  workspace: {
    getCurrent: () => invoke(INVOKE.workspaceGetCurrent),
    create: (input) => invoke(INVOKE.workspaceCreate, input),
    open: (input) => invoke(INVOKE.workspaceOpen, input),
    openWithDialog: () => invoke(INVOKE.workspaceOpenWithDialog),
    listRecent: () => invoke(INVOKE.workspaceListRecent),
    removeRecent: (input) => invoke(INVOKE.workspaceRemoveRecent, input),
    rename: (input) => invoke(INVOKE.workspaceRename, input),
    delete: (input) => invoke(INVOKE.workspaceDelete, input),
    getSettings: () => invoke(INVOKE.workspaceGetSettings),
    saveSettings: (input) => invoke(INVOKE.workspaceSaveSettings, input),
    setScriptTrust: (input) => invoke(INVOKE.workspaceSetScriptTrust, input)
  },
  runner: {
    start: (input) => invoke(INVOKE.runnerStart, input),
    cancel: (input) => invoke(INVOKE.runnerCancel, input),
    rows: (input) => invoke(INVOKE.runnerRows, input),
    row: (input) => invoke(INVOKE.runnerRow, input),
    export: (input) => invoke(INVOKE.runnerExport, input),
    discard: (input) => invoke(INVOKE.runnerDiscard, input),
    pickDataFile: () => invoke(INVOKE.runnerPickDataFile)
  },
  runtime: {
    list: () => invoke(INVOKE.runtimeList),
    delete: (input) => invoke(INVOKE.runtimeDelete, input),
    clear: () => invoke(INVOKE.runtimeClear)
  },
  tree: {
    get: () => invoke(INVOKE.treeGet),
    reload: (input) => invoke(INVOKE.treeReload, input)
  },
  request: {
    get: (input) => invoke(INVOKE.requestGet, input),
    save: (input) => invoke(INVOKE.requestSave, input),
    saveAs: (input) => invoke(INVOKE.requestSaveAs, input),
    getInherited: (input) => invoke(INVOKE.requestGetInherited, input)
  },
  container: {
    get: (input) => invoke(INVOKE.containerGet, input),
    save: (input) => invoke(INVOKE.containerSave, input)
  },
  http: {
    send: (input) => invoke(INVOKE.httpSend, input),
    cancel: (input) => invoke(INVOKE.httpCancel, input),
    getBody: (input) => invoke(INVOKE.httpGetBody, input),
    saveResponse: (input) => invoke(INVOKE.httpSaveResponse, input),
    resolve: (input) => invoke(INVOKE.httpResolve, input)
  },
  transfer: {
    importFile: () => invoke(INVOKE.transferImportFile),
    importText: (input) => invoke(INVOKE.transferImportText, input),
    exportPostman: (input) => invoke(INVOKE.transferExportPostman, input)
  },
  env: {
    list: () => invoke(INVOKE.envList),
    get: (input) => invoke(INVOKE.envGet, input),
    create: (input) => invoke(INVOKE.envCreate, input),
    save: (input) => invoke(INVOKE.envSave, input),
    duplicate: (input) => invoke(INVOKE.envDuplicate, input),
    delete: (input) => invoke(INVOKE.envDelete, input)
  },
  history: {
    list: () => invoke(INVOKE.historyList),
    delete: (input) => invoke(INVOKE.historyDelete, input),
    clear: () => invoke(INVOKE.historyClear),
    getUsage: () => invoke(INVOKE.historyGetUsage)
  },
  ws: {
    connect: (input) => invoke(INVOKE.wsConnect, input),
    send: (input) => invoke(INVOKE.wsSend, input),
    ping: (input) => invoke(INVOKE.wsPing, input),
    disconnect: (input) => invoke(INVOKE.wsDisconnect, input)
  },
  session: {
    get: () => invoke(INVOKE.sessionGet),
    save: (input) => invoke(INVOKE.sessionSave, input)
  },
  item: {
    create: (input) => invoke(INVOKE.itemCreate, input),
    rename: (input) => invoke(INVOKE.itemRename, input),
    duplicate: (input) => invoke(INVOKE.itemDuplicate, input),
    delete: (input) => invoke(INVOKE.itemDelete, input),
    move: (input) => invoke(INVOKE.itemMove, input)
  },
  dialog: {
    selectDirectory: (input) => invoke(INVOKE.dialogSelectDirectory, input),
    selectFile: (input) => invoke(INVOKE.dialogSelectFile, input),
    saveTextFile: (input) => invoke(INVOKE.dialogSaveTextFile, input)
  },
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void) {
    if (!EVENT_CHANNELS.includes(channel)) {
      throw new Error(`Unknown event channel: ${String(channel)}`)
    }
    const wrapped = (_event: IpcRendererEvent, payload: EventPayloads[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('hachi', api)
