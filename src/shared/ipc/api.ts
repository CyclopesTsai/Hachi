/**
 * Type of the whitelist API exposed by the preload script as `window.hachi`.
 * Types only — safe to import anywhere. Keep docs/ipc.md in sync.
 */
import type { SerializedError } from '../errors'
import type { AppConfig, Theme } from '../schemas/app-config'
import type { RequestType } from '../schemas/collection'
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

export interface ItemMutationResult {
  /** Id of the created / duplicated item. */
  id: string
  tree: WorkspaceTree
}

/** Input / output of every invoke channel. `void` input = no argument. */
export interface InvokeMap {
  'app:getInfo': { input: void; output: AppInfo }
  'app:getDefaultWorkspaceDir': { input: void; output: string }
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
  'dialog:selectDirectory': { input: SelectDirectoryInput; output: string | null }
  'tree:get': { input: void; output: WorkspaceTree }
  'item:create': { input: ItemCreateInput; output: ItemMutationResult }
  'item:rename': { input: ItemRenameInput; output: WorkspaceTree }
  'item:duplicate': { input: ItemIdInput; output: ItemMutationResult }
  'item:delete': { input: ItemIdInput; output: WorkspaceTree }
  'item:move': { input: ItemMoveInput; output: WorkspaceTree }
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
}

export interface EventPayloads {
  'menu:command': MenuCommandPayload
  'workspace:changed': WorkspaceInfo | null
  'config:changed': AppConfig
  'tree:changed': WorkspaceTree
}

export interface HachiApi {
  app: {
    getInfo: InvokeFn<'app:getInfo'>
    getDefaultWorkspaceDir: InvokeFn<'app:getDefaultWorkspaceDir'>
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
  }
  tree: {
    get: InvokeFn<'tree:get'>
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
  }
  /** Subscribes to a main → renderer event. Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void): () => void
}
