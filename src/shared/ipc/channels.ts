/**
 * IPC channel names. Pure constants only — this module is bundled into the
 * sandboxed preload script, so it must not import zod, node or electron.
 *
 * Naming: `<domain>:<action>`. Keep docs/ipc.md in sync when changing this file.
 */

/** Renderer → Main request/response channels (ipcRenderer.invoke / ipcMain.handle). */
export const INVOKE = {
  appGetInfo: 'app:getInfo',
  appReveal: 'app:reveal',
  appGetDefaultWorkspaceDir: 'app:getDefaultWorkspaceDir',
  appSetCloseGuard: 'app:setCloseGuard',
  appConfirmClose: 'app:confirmClose',
  configGet: 'config:get',
  configUpdate: 'config:update',
  workspaceGetCurrent: 'workspace:getCurrent',
  workspaceCreate: 'workspace:create',
  workspaceOpen: 'workspace:open',
  workspaceOpenWithDialog: 'workspace:openWithDialog',
  workspaceListRecent: 'workspace:listRecent',
  workspaceRemoveRecent: 'workspace:removeRecent',
  workspaceRename: 'workspace:rename',
  workspaceDelete: 'workspace:delete',
  workspaceGetSettings: 'workspace:getSettings',
  workspaceSaveSettings: 'workspace:saveSettings',
  workspaceSetScriptTrust: 'workspace:setScriptTrust',
  dialogSelectDirectory: 'dialog:selectDirectory',
  dialogSelectFile: 'dialog:selectFile',
  dialogSaveTextFile: 'dialog:saveTextFile',
  treeGet: 'tree:get',
  treeReload: 'tree:reload',
  itemCreate: 'item:create',
  itemRename: 'item:rename',
  itemDuplicate: 'item:duplicate',
  itemDelete: 'item:delete',
  itemMove: 'item:move',
  requestGet: 'request:get',
  requestSave: 'request:save',
  requestSaveAs: 'request:saveAs',
  requestGetInherited: 'request:getInherited',
  containerGet: 'container:get',
  containerSave: 'container:save',
  httpSend: 'http:send',
  httpCancel: 'http:cancel',
  httpGetBody: 'http:getBody',
  httpSaveResponse: 'http:saveResponse',
  httpResolve: 'http:resolve',
  authOAuth2Status: 'auth:oauth2Status',
  authOAuth2Obtain: 'auth:oauth2Obtain',
  authOAuth2Cancel: 'auth:oauth2Cancel',
  authOAuth2Clear: 'auth:oauth2Clear',
  transferImportFile: 'transfer:importFile',
  transferImportText: 'transfer:importText',
  transferImportBrunoFolder: 'transfer:importBrunoFolder',
  gitStatus: 'git:status',
  gitInit: 'git:init',
  gitIdentity: 'git:identity',
  gitSetIdentity: 'git:setIdentity',
  gitCommit: 'git:commit',
  gitDiscard: 'git:discard',
  gitDiff: 'git:diff',
  gitBranches: 'git:branches',
  gitSwitch: 'git:switch',
  gitCreateBranch: 'git:createBranch',
  gitRemote: 'git:remote',
  gitSetRemote: 'git:setRemote',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitResolve: 'git:resolve',
  gitAbortMerge: 'git:abortMerge',
  gitFinishMerge: 'git:finishMerge',
  gitOpenFile: 'git:openFile',
  gitAnswerPrompt: 'git:answerPrompt',
  gitLog: 'git:log',
  gitCommitDetail: 'git:commitDetail',
  gitCommitDiff: 'git:commitDiff',
  transferImportBrunoCollections: 'transfer:importBrunoCollections',
  transferExport: 'transfer:export',
  envList: 'env:list',
  envGet: 'env:get',
  envCreate: 'env:create',
  envSave: 'env:save',
  envDuplicate: 'env:duplicate',
  envDelete: 'env:delete',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',
  historyGetUsage: 'history:getUsage',
  runtimeList: 'runtime:list',
  runtimeDelete: 'runtime:delete',
  runtimeClear: 'runtime:clear',
  runnerStart: 'runner:start',
  runnerCancel: 'runner:cancel',
  runnerRows: 'runner:rows',
  runnerRow: 'runner:row',
  runnerExport: 'runner:export',
  runnerDiscard: 'runner:discard',
  runnerPickDataFile: 'runner:pickDataFile',
  sessionGet: 'session:get',
  sessionSave: 'session:save',
  wsConnect: 'ws:connect',
  wsSend: 'ws:send',
  wsPing: 'ws:ping',
  wsDisconnect: 'ws:disconnect'
} as const

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE]

/** Main → Renderer push events (webContents.send / ipcRenderer.on). */
export const EVENTS = {
  menuCommand: 'menu:command',
  workspaceChanged: 'workspace:changed',
  configChanged: 'config:changed',
  treeChanged: 'tree:changed',
  historyChanged: 'history:changed',
  variablesChanged: 'variables:changed',
  runnerEvent: 'runner:event',
  wsEvent: 'ws:event',
  appCloseRequested: 'app:closeRequested',
  gitPrompt: 'git:prompt'
} as const

export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS]

export const EVENT_CHANNELS: readonly EventChannel[] = Object.values(EVENTS)

/** Commands sent from the native menu to the renderer through `menu:command`. */
export const MENU_COMMANDS = [
  'workspace.new',
  'workspace.switch',
  'workspace.open',
  'workspace.openRecent',
  'request.save',
  'tab.close',
  'app.settings',
  'import.file',
  'import.curl',
  'import.bruno',
  'help.shortcuts'
] as const
export type MenuCommand = (typeof MENU_COMMANDS)[number]
