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
import type { Auth, KeyValue, RequestType, Variable } from '../schemas/collection'
import type { HistoryEntry } from '../schemas/history'
import type { AnyRequest } from '../schemas/request'
import type { WsMessageFormat, WsRequest } from '../schemas/ws-request'
import type { HttpRequest } from '../schemas/http-request'
import type { WsEventPayload } from '../ws'
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
  'ws:event': WsEventPayload
  'app:closeRequested': CloseRequest
}

export interface HachiApi {
  app: {
    getInfo: InvokeFn<'app:getInfo'>
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
