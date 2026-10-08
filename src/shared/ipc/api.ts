/**
 * Type of the whitelist API exposed by the preload script as `window.hachi`.
 * Types only — safe to import anywhere. Keep docs/ipc.md in sync.
 */
import type { SerializedError } from '../errors'
import type { ContainerSettingsData, HttpResult, InheritedSettings } from '../http'
import type {
  AppConfig,
  HistorySettings,
  WebsocketSettings,
  ProxySettings,
  Theme,
  UiSettings
} from '../schemas/app-config'
import type {
  Auth,
  KeyValue,
  RequestScripts,
  RequestType,
  ScriptFlow,
  Variable
} from '../schemas/collection'
import type { HistoryEntry } from '../schemas/history'
import type { AnyRequest } from '../schemas/request'
import type { WsMessageFormat, WsRequest } from '../schemas/ws-request'
import type { HttpRequest } from '../schemas/http-request'
import type { WsEventPayload } from '../ws'
import type {
  GitBranch,
  GitCommitDetail,
  GitFileDiff,
  GitLog,
  GitIdentity,
  GitPrompt,
  GitRemote,
  GitResolution,
  GitStatus
} from '../git'
import type { CodegenRequest } from '../codegen'
import type {
  RunnerConfig,
  RunnerEvent,
  RunnerItem,
  RunnerProgress,
  RunnerRow,
  RunnerRowDetail
} from '../runner'
import type { SessionData } from '../schemas/session'
import type { WorkspaceSettings } from '../schemas/workspace'
import type { ItemKind, WorkspaceTree } from '../tree'
import type { EventChannel, InvokeChannel, MenuCommand } from './channels'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedError }

export interface AppInfo {
  name: string
  version: string
  appId: string
  /** `process.platform` of the main process, e.g. "darwin" | "win32" | "linux". */
  platform: string
  isPackaged: boolean
}

export interface RevealInput {
  /** Collection / folder / request to show; null = the Workspace folder. */
  itemId: string | null
}

export interface WorkspaceInfo {
  id: string
  name: string
  /** Absolute path of the Workspace folder. */
  path: string
}

export interface RecentWorkspaceEntry {
  path: string
  name: string
  lastOpenedAt: string
  /** False when the folder (or its workspace.json) no longer exists. */
  exists: boolean
}

export interface ConfigUpdateInput {
  theme?: Theme
  proxy?: ProxySettings
  ui?: Partial<UiSettings>
  /** Lowering the limit removes the oldest entries (in all Workspaces) right away. */
  history?: HistorySettings
  websocket?: WebsocketSettings
}

export interface WorkspaceCreateInput {
  name: string
  /** Absolute path of the parent folder; the Workspace folder is created inside it. */
  parentDir: string
}

export interface WorkspacePathInput {
  path: string
}

export interface SelectDirectoryInput {
  title?: string
  defaultPath?: string
}

export interface WorkspaceRenameInput {
  name: string
}

export interface ItemCreateInput {
  /** Parent collection / folder id; null to create a Collection. */
  parentId: string | null
  kind: ItemKind
  name: string
  /** Required when kind is "request". */
  requestType?: RequestType
}

export interface ItemIdInput {
  id: string
}

export interface ItemRenameInput {
  id: string
  name: string
}

export interface ItemMoveInput {
  id: string
  /** New parent id; null = top level (Collections only). */
  parentId: string | null
  /** Position among the new parent's children, counted without the moved item. */
  index: number
}

export type TreeReloadInput = { scope: 'workspace' } | { scope: 'item'; id: string }

export interface SelectFileInput {
  title?: string
}

export interface RequestData {
  /** HTTP or WebSocket (by `type`). */
  request: AnyRequest
  inherited: InheritedSettings
}

export interface RequestSaveInput {
  id: string
  /** Must have the same `type` as the file. */
  request: AnyRequest
}

export interface RequestSaveResult {
  request: AnyRequest
  tree: WorkspaceTree
}

export interface RequestSaveAsInput {
  /** Collection / folder to create the request in. */
  parentId: string
  name: string
  request: AnyRequest
}

export interface RequestSaveAsResult {
  id: string
  request: AnyRequest
  tree: WorkspaceTree
}

export interface ParentIdInput {
  /** Collection / folder id; null = not inside any collection (nothing inherited). */
  parentId: string | null
}

export interface ContainerSaveInput {
  id: string
  headers: KeyValue[]
  auth: Auth
  /** Collection variables (ignored for folders). Secret values go to .hachi-secrets.json. */
  variables: Variable[]
  scripts: RequestScripts
  /** Collections only (ignored for folders). */
  scriptFlow: ScriptFlow
}

export interface HttpSendInput {
  /** Chosen by the renderer (UUID) so the request can be cancelled while it runs. */
  runId: string
  /** The saved request this tab edits (recorded in history); null for unsaved requests. */
  requestId: string | null
  /** Collection / folder providing inherited headers / auth and collection variables. */
  parentId: string | null
  /** Active environment; null = none. */
  environmentId: string | null
  /** Current editor content, saved or not, before variable substitution. */
  request: HttpRequest
  /** Send without running the request's scripts ("這次不執行腳本", decision 84). */
  skipScripts?: boolean
}

/** A runtime variable (set by scripts / extractions, in memory only — decision 71). */
export interface RuntimeVariable {
  name: string
  value: string
}

export interface VariablesChangedEvent {
  /** Runtime variables of the current Workspace (always included). */
  runtime: RuntimeVariable[]
  /** Environment / Collection whose stored variables a script or extraction changed. */
  environmentId: string | null
  collectionId: string | null
}

export interface RunnerStartInput {
  /** Chosen by the renderer (UUID). */
  runId: string
  config: RunnerConfig
}

export interface RunnerStartResult {
  totalRounds: number
  /** Requests that will run, in order. */
  items: RunnerItem[]
  /** Paths of checked items that cannot run (WebSocket, unreadable). */
  skipped: string[]
  /** First progress (so the tab can show the run right away). */
  progress: RunnerProgress
}

export interface RunnerRowsInput {
  runId: string
  offset: number
  limit: number
  failedOnly: boolean
}

export interface RunnerDataFile {
  fileName: string
  columns: string[]
  rows: Record<string, string>[]
}

export interface ScriptTrustInput {
  /** Trust (or stop trusting) the scripts of the current Workspace. */
  trusted: boolean
}

export interface EnvironmentSummary {
  id: string
  name: string
  /** Set when the file cannot be read; such entries can only be deleted. */
  error?: string
}

export interface EnvironmentData {
  id: string
  name: string
  /** Secret values are included (read from .hachi-secrets.json). */
  variables: Variable[]
}

export interface EnvironmentCreateInput {
  name: string
}

export interface EnvironmentSaveInput {
  id: string
  name: string
  variables: Variable[]
}

export interface EnvironmentMutationResult {
  id: string
  list: EnvironmentSummary[]
}

export interface HistoryUsage {
  /** Entries in all Workspaces together. */
  total: number
  /** Limit shared by all Workspaces (App setting). */
  max: number
  /** Entries in the current Workspace. */
  workspace: number
}

export interface HistoryListResult {
  /** Newest first. */
  entries: HistoryEntry[]
  usage: HistoryUsage
}

export interface WsConnectInput {
  /** Chosen by the renderer (UUID), new for every connection attempt. */
  connectionId: string
  /** The saved request this tab edits (recorded in history); null for unsaved ones. */
  requestId: string | null
  parentId: string | null
  environmentId: string | null
  /** As edited, before variable substitution. */
  request: WsRequest
}

export interface WsSendInput {
  connectionId: string
  /** Used to resolve `{{variables}}` at send time. */
  parentId: string | null
  environmentId: string | null
  format: WsMessageFormat
  content: string
}

export interface WsDisconnectInput {
  connectionId: string
  /** 1000 or 3000–4999; default 1000. */
  code?: number
  reason?: string
}

export interface HttpResolveInput {
  parentId: string | null
  environmentId: string | null
  /** Current editor content, before variable substitution. */
  request: HttpRequest
  /** False: secret variables stay as `{{name}}` in the generated code (decision 69). */
  revealSecrets: boolean
}

export interface HttpResolveResult {
  request: CodegenRequest
  /** Set when the URL is invalid; `request.url` is then the URL field as typed. */
  urlError: string | null
  unresolvedVariables: string[]
}

export interface ImportTextInput {
  /** For the report only. */
  fileName: string
  /** File content (JSON), e.g. of a file dropped on the window. */
  text: string
}

export interface ImportReport {
  kind: 'collection' | 'environment'
  /** Id of the created Collection / environment. */
  id: string
  /** Final name (" copy" added when the name was taken). */
  name: string
  fileName: string
  folders: number
  requests: number
  variables: number
  /** Environments created along with a Collection (Bruno). */
  environments: string[]
  /** What could not be imported exactly (unsupported auth, body types, …). */
  warnings: string[]
}

export type ExportFormat = 'postman' | 'bruno' | 'bruno-yaml' | 'openapi-html' | 'openapi-json'

/** One import of several (Bruno collections picked from a folder). */
export interface ImportOutcome {
  /** Folder name, for the report. */
  fileName: string
  report: ImportReport | null
  error: string | null
}

/** A Bruno collection found inside a chosen folder. */
export interface BrunoCollectionChoice {
  /** Relative to the chosen folder, forward slashes ('' = the folder itself). */
  path: string
  name: string
  format: 'bru' | 'yaml'
}

export type BrunoFolderResult =
  | { kind: 'imported'; results: ImportOutcome[] }
  /** Several collections: ask which ones, then `transfer:importBrunoCollections`. */
  | { kind: 'choose'; scanId: string; folder: string; collections: BrunoCollectionChoice[] }

export interface ImportBrunoCollectionsInput {
  scanId: string
  paths: string[]
}

export interface ExportInput {
  /** Collection id. */
  id: string
  format: ExportFormat
  /** OpenAPI only: environment whose values fill server URLs and path examples. */
  environmentId: string | null
}

export interface ExportResult {
  /** Where the file (or the Bruno folder) was written. */
  path: string
  /** WebSocket requests left out (Postman v2.1 / Bruno / OpenAPI have no WebSocket items). */
  skipped: string[]
  /** Items whose files could not be read. */
  unreadable: string[]
  warnings: string[]
}

export interface UnresolvedResult {
  /** `{{names}}` that had no value and were sent as-is. */
  unresolvedVariables: string[]
}

export interface SaveTextFileInput {
  title?: string
  /** Suggested file name (saved under Downloads by default). */
  defaultName: string
  content: string
}

export interface CloseGuardInput {
  /** True while any tab has unsaved changes: closing the window then asks the renderer. */
  dirty: boolean
}

export interface CloseRequest {
  reason: 'close' | 'quit'
}

export interface RunIdInput {
  runId: string
}

export interface ItemMutationResult {
  /** Id of the created / duplicated item. */
  id: string
  tree: WorkspaceTree
}

/** Input / output of every invoke channel. `void` input = no argument. */
export interface InvokeMap {
  'app:getInfo': { input: void; output: AppInfo }
  'app:reveal': { input: RevealInput; output: void }
  'app:getDefaultWorkspaceDir': { input: void; output: string }
  'app:setCloseGuard': { input: CloseGuardInput; output: void }
  'app:confirmClose': { input: void; output: void }
  'config:get': { input: void; output: AppConfig }
  'config:update': { input: ConfigUpdateInput; output: AppConfig }
  'workspace:getCurrent': { input: void; output: WorkspaceInfo | null }
  'workspace:create': { input: WorkspaceCreateInput; output: WorkspaceInfo }
  'workspace:open': { input: WorkspacePathInput; output: WorkspaceInfo }
  'workspace:openWithDialog': { input: void; output: WorkspaceInfo | null }
  'workspace:listRecent': { input: void; output: RecentWorkspaceEntry[] }
  'workspace:removeRecent': { input: WorkspacePathInput; output: RecentWorkspaceEntry[] }
  'workspace:rename': { input: WorkspaceRenameInput; output: WorkspaceInfo }
  'workspace:delete': { input: WorkspacePathInput; output: RecentWorkspaceEntry[] }
  'workspace:getSettings': { input: void; output: WorkspaceSettings }
  'workspace:saveSettings': { input: WorkspaceSettings; output: WorkspaceSettings }
  'workspace:setScriptTrust': { input: ScriptTrustInput; output: AppConfig }
  'runtime:list': { input: void; output: RuntimeVariable[] }
  'runtime:delete': { input: { name: string }; output: RuntimeVariable[] }
  'runtime:clear': { input: void; output: RuntimeVariable[] }
  'runner:start': { input: RunnerStartInput; output: RunnerStartResult }
  'runner:cancel': { input: { runId: string }; output: boolean }
  'runner:rows': { input: RunnerRowsInput; output: { total: number; rows: RunnerRow[] } }
  'runner:row': { input: { runId: string; index: number }; output: RunnerRowDetail | null }
  'runner:export': { input: { runId: string }; output: string | null }
  'runner:discard': { input: { runId: string }; output: void }
  'runner:pickDataFile': { input: void; output: RunnerDataFile | null }
  'dialog:selectDirectory': { input: SelectDirectoryInput; output: string | null }
  'dialog:selectFile': { input: SelectFileInput; output: string | null }
  'tree:get': { input: void; output: WorkspaceTree }
  'tree:reload': { input: TreeReloadInput; output: WorkspaceTree }
  'item:create': { input: ItemCreateInput; output: ItemMutationResult }
  'item:rename': { input: ItemRenameInput; output: WorkspaceTree }
  'item:duplicate': { input: ItemIdInput; output: ItemMutationResult }
  'item:delete': { input: ItemIdInput; output: WorkspaceTree }
  'item:move': { input: ItemMoveInput; output: WorkspaceTree }
  'request:get': { input: ItemIdInput; output: RequestData }
  'request:save': { input: RequestSaveInput; output: RequestSaveResult }
  'request:saveAs': { input: RequestSaveAsInput; output: RequestSaveAsResult }
  'request:getInherited': { input: ParentIdInput; output: InheritedSettings }
  'container:get': { input: ItemIdInput; output: ContainerSettingsData }
  'container:save': { input: ContainerSaveInput; output: ContainerSettingsData }
  'http:send': { input: HttpSendInput; output: HttpResult }
  'http:cancel': { input: RunIdInput; output: boolean }
  'http:getBody': { input: RunIdInput; output: string }
  'http:saveResponse': { input: RunIdInput; output: string | null }
  'http:resolve': { input: HttpResolveInput; output: HttpResolveResult }
  'transfer:importFile': { input: void; output: ImportReport | null }
  'transfer:importText': { input: ImportTextInput; output: ImportReport }
  'transfer:importBrunoFolder': { input: void; output: BrunoFolderResult | null }
  'git:status': { input: void; output: GitStatus }
  'git:init': { input: void; output: GitStatus }
  'git:identity': { input: void; output: GitIdentity | null }
  'git:setIdentity': { input: GitIdentity & { global: boolean }; output: void }
  'git:commit': { input: { paths: string[]; message: string }; output: GitStatus }
  'git:discard': { input: { path: string }; output: GitStatus }
  'git:diff': { input: { path: string }; output: GitFileDiff }
  'git:branches': { input: void; output: GitBranch[] }
  'git:switch': { input: { name: string; remote: boolean }; output: GitStatus }
  'git:createBranch': { input: { name: string }; output: GitStatus }
  'git:remote': { input: void; output: GitRemote | null }
  'git:setRemote': { input: { url: string }; output: GitStatus }
  'git:fetch': { input: void; output: GitStatus }
  'git:pull': { input: void; output: GitStatus }
  'git:push': { input: void; output: GitStatus }
  'git:resolve': { input: { path: string; how: GitResolution }; output: GitStatus }
  'git:abortMerge': { input: void; output: GitStatus }
  'git:finishMerge': { input: void; output: GitStatus }
  'git:openFile': { input: { path: string }; output: void }
  'git:answerPrompt': { input: { id: string; value: string | null }; output: void }
  'git:log': { input: { skip: number }; output: GitLog }
  'git:commitDetail': { input: { hash: string }; output: GitCommitDetail }
  'git:commitDiff': { input: { hash: string; path: string }; output: GitFileDiff }
  'transfer:importBrunoCollections': {
    input: ImportBrunoCollectionsInput
    output: ImportOutcome[]
  }
  'transfer:export': { input: ExportInput; output: ExportResult | null }
  'env:list': { input: void; output: EnvironmentSummary[] }
  'env:get': { input: ItemIdInput; output: EnvironmentData }
  'env:create': { input: EnvironmentCreateInput; output: EnvironmentMutationResult }
  'env:save': { input: EnvironmentSaveInput; output: EnvironmentData }
  'env:duplicate': { input: ItemIdInput; output: EnvironmentMutationResult }
  'env:delete': { input: ItemIdInput; output: EnvironmentSummary[] }
  'history:list': { input: void; output: HistoryListResult }
  'history:delete': { input: ItemIdInput; output: HistoryUsage }
  'history:clear': { input: void; output: HistoryUsage }
  'history:getUsage': { input: void; output: HistoryUsage }
  'session:get': { input: void; output: SessionData }
  'session:save': { input: SessionData; output: void }
  'ws:connect': { input: WsConnectInput; output: UnresolvedResult }
  'ws:send': { input: WsSendInput; output: UnresolvedResult }
  'ws:ping': { input: { connectionId: string }; output: void }
  'ws:disconnect': { input: WsDisconnectInput; output: boolean }
  'dialog:saveTextFile': { input: SaveTextFileInput; output: string | null }
}

// Compile-time guarantee that InvokeMap and the channel constants list the same channels.
type AssertSameKeys<A, B> = [Exclude<keyof A, B>, Exclude<B, keyof A>] extends [never, never]
  ? true
  : never
export const invokeMapIsComplete: AssertSameKeys<InvokeMap, InvokeChannel> = true

export type InvokeFn<C extends InvokeChannel> = InvokeMap[C]['input'] extends void
  ? () => Promise<IpcResult<InvokeMap[C]['output']>>
  : (input: InvokeMap[C]['input']) => Promise<IpcResult<InvokeMap[C]['output']>>

export interface MenuCommandPayload {
  command: MenuCommand
  /** Workspace folder, for "workspace.openRecent". */
  path?: string
}

export interface EventPayloads {
  'menu:command': MenuCommandPayload
  'workspace:changed': WorkspaceInfo | null
  'config:changed': AppConfig
  'tree:changed': WorkspaceTree
  'history:changed': HistoryUsage
  'variables:changed': VariablesChangedEvent
  'runner:event': RunnerEvent
  'ws:event': WsEventPayload
  'app:closeRequested': CloseRequest
  'git:prompt': GitPrompt
}

export interface HachiApi {
  app: {
    getInfo: InvokeFn<'app:getInfo'>
    /** Shows the Workspace folder or an item in Finder / Explorer (在 Finder 中顯示). */
    reveal: InvokeFn<'app:reveal'>
    getDefaultWorkspaceDir: InvokeFn<'app:getDefaultWorkspaceDir'>
    /** Tells main whether closing the window must ask about unsaved tabs first. */
    setCloseGuard: InvokeFn<'app:setCloseGuard'>
    /** Closes the window (or quits) after the renderer resolved `app:closeRequested`. */
    confirmClose: InvokeFn<'app:confirmClose'>
  }
  config: {
    get: InvokeFn<'config:get'>
    update: InvokeFn<'config:update'>
  }
  workspace: {
    getCurrent: InvokeFn<'workspace:getCurrent'>
    create: InvokeFn<'workspace:create'>
    open: InvokeFn<'workspace:open'>
    /** Shows a native folder picker and opens the chosen Workspace. `null` if cancelled. */
    openWithDialog: InvokeFn<'workspace:openWithDialog'>
    listRecent: InvokeFn<'workspace:listRecent'>
    removeRecent: InvokeFn<'workspace:removeRecent'>
    /** Renames the current Workspace (display name only). */
    rename: InvokeFn<'workspace:rename'>
    /** Moves a known Workspace folder to the system trash and removes it from the recent list. */
    delete: InvokeFn<'workspace:delete'>
    getSettings: InvokeFn<'workspace:getSettings'>
    saveSettings: InvokeFn<'workspace:saveSettings'>
    /** Trust the current Workspace's scripts on this computer (stored in app-config.json). */
    setScriptTrust: InvokeFn<'workspace:setScriptTrust'>
  }
  runner: {
    /** Starts a Collection Runner run; progress arrives as `runner:event`. */
    start: InvokeFn<'runner:start'>
    cancel: InvokeFn<'runner:cancel'>
    /** A page of result rows (all, or failed only). */
    rows: InvokeFn<'runner:rows'>
    /** One row with headers / body / script report, or null if its details were not kept. */
    row: InvokeFn<'runner:row'>
    /** Save dialog, then writes the results as JSON. Null if cancelled. */
    export: InvokeFn<'runner:export'>
    /** Forgets a run's results (tab closed / run again). */
    discard: InvokeFn<'runner:discard'>
    /** Open dialog for a CSV / JSON data file (decision 89). Null if cancelled. */
    pickDataFile: InvokeFn<'runner:pickDataFile'>
  }
  runtime: {
    /** Runtime variables of the current Workspace. */
    list: InvokeFn<'runtime:list'>
    delete: InvokeFn<'runtime:delete'>
    clear: InvokeFn<'runtime:clear'>
  }
  tree: {
    get: InvokeFn<'tree:get'>
    /** Re-reads files changed outside Hachi: the whole Workspace or one item. */
    reload: InvokeFn<'tree:reload'>
  }
  request: {
    get: InvokeFn<'request:get'>
    save: InvokeFn<'request:save'>
    /** Creates a request from an unsaved tab. */
    saveAs: InvokeFn<'request:saveAs'>
    /** What an item inside `parentId` inherits (for unsaved tabs and moved items). */
    getInherited: InvokeFn<'request:getInherited'>
  }
  container: {
    get: InvokeFn<'container:get'>
    save: InvokeFn<'container:save'>
  }
  http: {
    send: InvokeFn<'http:send'>
    /** Returns false if the request had already finished. */
    cancel: InvokeFn<'http:cancel'>
    /** Full text of a response body that was too large to send inline. */
    getBody: InvokeFn<'http:getBody'>
    /** Shows a save dialog and writes the response body. Returns the path, or null if cancelled. */
    saveResponse: InvokeFn<'http:saveResponse'>
    /** The request as it would be sent, for code generation (nothing is sent). */
    resolve: InvokeFn<'http:resolve'>
  }
  /** Git of the current Workspace (decisions 111–115); uses the git installed here. */
  git: {
    status: InvokeFn<'git:status'>
    init: InvokeFn<'git:init'>
    /** user.name / user.email git would use, or null when one is missing. */
    identity: InvokeFn<'git:identity'>
    setIdentity: InvokeFn<'git:setIdentity'>
    /** Commits exactly these files (Workspace-relative paths from the status). */
    commit: InvokeFn<'git:commit'>
    /** Restores one file from the last commit; new files go to the trash. */
    discard: InvokeFn<'git:discard'>
    /** A changed file in the last commit and now. */
    diff: InvokeFn<'git:diff'>
    branches: InvokeFn<'git:branches'>
    switch: InvokeFn<'git:switch'>
    createBranch: InvokeFn<'git:createBranch'>
    /** origin (or the only remote), or null. */
    remote: InvokeFn<'git:remote'>
    /** Sets origin's URL (added when missing). */
    setRemote: InvokeFn<'git:setRemote'>
    fetch: InvokeFn<'git:fetch'>
    /** Merge pull; conflicts come back in the status (`merging`), not as an error. */
    pull: InvokeFn<'git:pull'>
    /** The first push of a branch sets its upstream. */
    push: InvokeFn<'git:push'>
    /** Settles a conflicted file: ours / theirs, or resolved after editing it. */
    resolve: InvokeFn<'git:resolve'>
    abortMerge: InvokeFn<'git:abortMerge'>
    finishMerge: InvokeFn<'git:finishMerge'>
    /** Opens a changed file in its default app (to fix a conflict by hand). */
    openFile: InvokeFn<'git:openFile'>
    /** Answer to a `git:prompt` event (null = cancelled). */
    answerPrompt: InvokeFn<'git:answerPrompt'>
    /** Commits of every branch, newest first, 300 per page (decision 116). */
    log: InvokeFn<'git:log'>
    commitDetail: InvokeFn<'git:commitDetail'>
    /** A file of a commit against its first parent (`path`: repository path). */
    commitDiff: InvokeFn<'git:commitDiff'>
  }
  transfer: {
    /** Open dialog, then imports a Postman / Bruno JSON file. Null if cancelled. */
    importFile: InvokeFn<'transfer:importFile'>
    importText: InvokeFn<'transfer:importText'>
    /**
     * Folder dialog, then imports a Bruno collection folder (.bru or .yml). A folder with
     * several collections returns them to choose from. Null if cancelled.
     */
    importBrunoFolder: InvokeFn<'transfer:importBrunoFolder'>
    importBrunoCollections: InvokeFn<'transfer:importBrunoCollections'>
    /**
     * Save dialog (a folder dialog for Bruno), then writes the Collection in the chosen
     * format. Null if cancelled.
     */
    export: InvokeFn<'transfer:export'>
  }
  env: {
    list: InvokeFn<'env:list'>
    get: InvokeFn<'env:get'>
    create: InvokeFn<'env:create'>
    save: InvokeFn<'env:save'>
    duplicate: InvokeFn<'env:duplicate'>
    /** Moves the environment file to the system trash. */
    delete: InvokeFn<'env:delete'>
  }
  history: {
    list: InvokeFn<'history:list'>
    delete: InvokeFn<'history:delete'>
    clear: InvokeFn<'history:clear'>
    getUsage: InvokeFn<'history:getUsage'>
  }
  ws: {
    /** Starts connecting; state and messages arrive as `ws:event`. */
    connect: InvokeFn<'ws:connect'>
    send: InvokeFn<'ws:send'>
    ping: InvokeFn<'ws:ping'>
    /** Closes (or aborts while connecting). False if there is no such connection. */
    disconnect: InvokeFn<'ws:disconnect'>
  }
  session: {
    /** Open tabs and active environment of the current Workspace (this computer only). */
    get: InvokeFn<'session:get'>
    save: InvokeFn<'session:save'>
  }
  item: {
    create: InvokeFn<'item:create'>
    rename: InvokeFn<'item:rename'>
    duplicate: InvokeFn<'item:duplicate'>
    /** Moves the item to the system trash. */
    delete: InvokeFn<'item:delete'>
    move: InvokeFn<'item:move'>
  }
  dialog: {
    /** Returns the chosen absolute path, or `null` if cancelled. */
    selectDirectory: InvokeFn<'dialog:selectDirectory'>
    /** Returns the chosen absolute file path, or `null` if cancelled. */
    selectFile: InvokeFn<'dialog:selectFile'>
    /** Save dialog, then writes `content` (UTF-8). Returns the path, or null if cancelled. */
    saveTextFile: InvokeFn<'dialog:saveTextFile'>
  }
  /** Subscribes to a main → renderer event. Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void): () => void
}
