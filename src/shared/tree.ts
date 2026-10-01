/**
 * Tree of a Workspace's collections as sent to the renderer. Pure types + helpers,
 * safe to import anywhere.
 */
import type { RequestType } from './schemas/collection'

export type ItemKind = 'collection' | 'folder' | 'request'

interface BaseNode {
  /** Stable id from the item's JSON file (or `invalid:<path>` for unreadable files). */
  id: string
  name: string
  /** Path relative to the Workspace folder, always with "/" separators. For display only. */
  relPath: string
  /** Set when the item's JSON file is unreadable or invalid. Such items can only be deleted. */
  error?: string
}

export interface CollectionNode extends BaseNode {
  kind: 'collection'
  children: ChildNode[]
}

export interface FolderNode extends BaseNode {
  kind: 'folder'
  children: ChildNode[]
}

export interface RequestNode extends BaseNode {
  kind: 'request'
  requestType: RequestType
  /** HTTP method for http requests. */
  method?: string
}

export type ContainerNode = CollectionNode | FolderNode
export type ChildNode = FolderNode | RequestNode
export type TreeNode = CollectionNode | ChildNode

export interface WorkspaceTree {
  /** Id of the Workspace this tree belongs to (null when none is open). */
  workspaceId: string | null
  collections: CollectionNode[]
}

export const INVALID_ID_PREFIX = 'invalid:'

export function isContainer(node: TreeNode): node is ContainerNode {
  return node.kind === 'collection' || node.kind === 'folder'
}

/** Depth-first walk. Return `false` from the visitor to stop. */
export function walkTree(
  tree: WorkspaceTree,
  visit: (node: TreeNode, parent: ContainerNode | null) => boolean | void
): void {
  const walk = (node: TreeNode, parent: ContainerNode | null): boolean => {
    if (visit(node, parent) === false) return false
    if (isContainer(node)) {
      for (const child of node.children) if (!walk(child, node)) return false
    }
    return true
  }
  for (const c of tree.collections) if (!walk(c, null)) return
}

export function findNode(
  tree: WorkspaceTree,
  id: string
): { node: TreeNode; parent: ContainerNode | null } | null {
  let found: { node: TreeNode; parent: ContainerNode | null } | null = null
  walkTree(tree, (node, parent) => {
    if (node.id === id) {
      found = { node, parent }
      return false
    }
  })
  return found
}

/** True if `candidateId` is `ancestor` itself or anywhere below it. */
export function isSelfOrDescendant(ancestor: TreeNode, candidateId: string): boolean {
  if (ancestor.id === candidateId) return true
  return isContainer(ancestor) && ancestor.children.some((c) => isSelfOrDescendant(c, candidateId))
}
