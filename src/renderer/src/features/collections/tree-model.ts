/**
 * Pure tree helpers for the sidebar: flattening for rendering and drag-and-drop
 * target resolution. No React / DOM here so it can be unit tested.
 */
import {
  findNode,
  isContainer,
  isSelfOrDescendant,
  type ContainerNode,
  type TreeNode,
  type WorkspaceTree
} from '@shared/tree'

export interface FlatRow {
  node: TreeNode
  depth: number
  parentId: string | null
}

/**
 * Visible rows in display order (children of collapsed containers are skipped). With
 * `visible` (a search), only those ids are shown.
 */
export function flattenTree(
  tree: WorkspaceTree,
  expanded: ReadonlySet<string>,
  visible?: ReadonlySet<string> | null
): FlatRow[] {
  const rows: FlatRow[] = []
  const visit = (node: TreeNode, depth: number, parentId: string | null): void => {
    if (visible && !visible.has(node.id)) return
    rows.push({ node, depth, parentId })
    if (isContainer(node) && expanded.has(node.id)) {
      for (const child of node.children) visit(child, depth + 1, node.id)
    }
  }
  for (const c of tree.collections) visit(c, 0, null)
  return rows
}

/** The visible row before / after `id` (↑ / ↓ in the tree, decision 96); null at the ends. */
export function neighborRow(
  tree: WorkspaceTree,
  expanded: ReadonlySet<string>,
  id: string,
  delta: 1 | -1,
  visible?: ReadonlySet<string> | null
): TreeNode | null {
  const rows = flattenTree(tree, expanded, visible)
  const index = rows.findIndex((r) => r.node.id === id)
  if (index < 0) return null
  return rows[index + delta]?.node ?? null
}

/** Ids of every collection and folder (全部展開). */
export function allContainerIds(tree: WorkspaceTree): string[] {
  const ids: string[] = []
  const visit = (node: TreeNode): void => {
    if (!isContainer(node)) return
    ids.push(node.id)
    node.children.forEach(visit)
  }
  tree.collections.forEach(visit)
  return ids
}

/** Name search (decision 108): case-insensitive, part of the name. */
export const nameMatches = (name: string, query: string): boolean =>
  name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())

export interface TreeSearch {
  /** Ids to show: matches, their ancestors, and everything inside a matching container. */
  visible: Set<string>
  /** Containers to open so every match can be seen. */
  expand: string[]
  matches: number
}

/** Filters the tree by name; null for an empty query. */
export function searchTree(tree: WorkspaceTree, query: string): TreeSearch | null {
  if (query.trim() === '') return null
  const visible = new Set<string>()
  const expand = new Set<string>()
  let matches = 0
  const addAll = (node: TreeNode): void => {
    visible.add(node.id)
    if (isContainer(node)) node.children.forEach(addAll)
  }
  /** True when the node or something inside it matches. */
  const visit = (node: TreeNode, ancestors: string[]): boolean => {
    let found = false
    if (nameMatches(node.name, query)) {
      matches++
      found = true
      addAll(node)
      ancestors.forEach((id) => expand.add(id))
    }
    if (isContainer(node)) {
      for (const child of node.children) {
        if (visit(child, [...ancestors, node.id])) found = true
      }
    }
    if (found) visible.add(node.id)
    return found
  }
  tree.collections.forEach((c) => visit(c, []))
  return { visible, expand: [...expand], matches }
}

/** Number of items below a container (for delete confirmations). */
export function countDescendants(node: TreeNode): number {
  return isContainer(node)
    ? node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
    : 0
}

/** Ids of every container on the way to `id` (to expand them), outermost first. */
export function ancestorIds(tree: WorkspaceTree, id: string): string[] {
  const path: string[] = []
  const visit = (node: TreeNode, trail: string[]): boolean => {
    if (node.id === id) {
      path.push(...trail)
      return true
    }
    return isContainer(node) && node.children.some((c) => visit(c, [...trail, node.id]))
  }
  tree.collections.some((c) => visit(c, []))
  return path
}

export type DropPosition = 'before' | 'after' | 'inside'

/**
 * Which drop zone the pointer is in, given its vertical position within the
 * target row (0 = top edge, 1 = bottom edge).
 */
export function dropPositionFor(dragged: TreeNode, target: TreeNode, ratio: number): DropPosition {
  // Collections are only reordered among themselves; requests cannot contain anything.
  if (dragged.kind === 'collection' || !isContainer(target)) return ratio < 0.5 ? 'before' : 'after'
  if (target.kind === 'collection') return 'inside'
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'inside'
}

export interface MoveTarget {
  parentId: string | null
  /** Index among the new parent's children, counted without the dragged item. */
  index: number
}

/** Resolves a drop into a move, or null if the drop is not allowed. */
export function resolveDrop(
  tree: WorkspaceTree,
  draggedId: string,
  targetId: string,
  position: DropPosition
): MoveTarget | null {
  if (draggedId === targetId) return null
  const dragged = findNode(tree, draggedId)
  const target = findNode(tree, targetId)
  if (!dragged || !target || dragged.node.error) return null

  if (dragged.node.kind === 'collection') {
    if (target.node.kind !== 'collection' || position === 'inside') return null
    const ids = tree.collections.map((c) => c.id).filter((id) => id !== draggedId)
    const at = ids.indexOf(targetId)
    return { parentId: null, index: position === 'before' ? at : at + 1 }
  }

  let parent: ContainerNode
  let index: number
  if (position === 'inside') {
    if (!isContainer(target.node)) return null
    parent = target.node
    index = parent.children.filter((c) => c.id !== draggedId).length
  } else {
    if (!target.parent) return null // folders / requests cannot sit between collections
    parent = target.parent
    const ids = parent.children.map((c) => c.id).filter((id) => id !== draggedId)
    const at = ids.indexOf(targetId)
    index = position === 'before' ? at : at + 1
  }
  if (parent.error || isSelfOrDescendant(dragged.node, parent.id)) return null
  return { parentId: parent.id, index }
}

/** True when the move would leave the item exactly where it is. */
export function isNoopMove(tree: WorkspaceTree, draggedId: string, move: MoveTarget): boolean {
  const found = findNode(tree, draggedId)
  if (!found) return true
  const siblings = found.parent ? found.parent.children : tree.collections
  const currentParent = found.parent?.id ?? null
  return (
    currentParent === move.parentId && siblings.findIndex((s) => s.id === draggedId) === move.index
  )
}
