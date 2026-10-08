/**
 * A Collection as a plain tree, independent of files and ids. Importers produce it
 * (main then writes the files) and exporters consume it (main reads the files into it).
 * Types only — safe to import anywhere.
 */
import type { Auth, KeyValue, ScriptFlow, Variable } from '../schemas/collection'
import type { RequestScripts } from '../schemas/http-request'
import type { AnyRequest } from '../schemas/request'

export interface PortableContainer {
  name: string
  headers: KeyValue[]
  auth: Auth
  /** Kept as-is: collection / folder scripts are not run yet (decision 70). */
  scripts: RequestScripts | null
  children: PortableItem[]
}

export interface PortableCollection extends PortableContainer {
  /** Secret values are empty when exporting (they never leave .hachi-secrets.json). */
  variables: Variable[]
  /** Order of collection / folder / request scripts (decision 126); sequential if absent. */
  scriptFlow?: ScriptFlow
}

export interface PortableFolder extends PortableContainer {
  kind: 'folder'
}

export interface PortableRequest {
  kind: 'request'
  /** `id` is ignored when importing: every imported item gets a new id. */
  request: AnyRequest
}

export type PortableItem = PortableFolder | PortableRequest

export interface PortableEnvironment {
  name: string
  variables: Variable[]
}

export function countItems(container: PortableContainer): { folders: number; requests: number } {
  let folders = 0
  let requests = 0
  for (const child of container.children) {
    if (child.kind === 'request') {
      requests++
    } else {
      folders++
      const inner = countItems(child)
      folders += inner.folders
      requests += inner.requests
    }
  }
  return { folders, requests }
}
