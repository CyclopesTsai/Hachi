/** Hachi names for the files git reports (decision 112): pure, unit tested. */
import { isContainer, type TreeNode, type WorkspaceTree } from '@shared/tree'

export interface FileLabel {
  /** "Shop / Users / Get user", or the file name for other files. */
  title: string
  /** The item to open, if the file is one. */
  itemId: string | null
}

/** Workspace-relative file path → its item (requests: the file; containers: their meta file). */
export function fileIndex(tree: WorkspaceTree): Map<string, FileLabel> {
  const index = new Map<string, FileLabel>()
  const visit = (node: TreeNode, trail: string[]) => {
    const names = [...trail, node.name]
    if (!isContainer(node)) {
      index.set(node.relPath, { title: names.join(' / '), itemId: node.id })
      return
    }
    const meta = node.kind === 'collection' ? 'collection.json' : 'folder.json'
    index.set(`${node.relPath}/${meta}`, { title: `${names.join(' / ')}（設定）`, itemId: node.id })
    node.children.forEach((child) => visit(child, names))
  }
  tree.collections.forEach((c) => visit(c, []))
  return index
}

export function labelFor(index: ReadonlyMap<string, FileLabel>, path: string): FileLabel {
  const known = index.get(path)
  if (known) return known
  if (path === 'workspace.json') return { title: 'Workspace 設定', itemId: null }
  const env = /^environments\/([^/]+)\.json$/.exec(path)
  if (env) return { title: `環境檔 ${env[1]}`, itemId: null }
  return { title: path.slice(path.lastIndexOf('/') + 1), itemId: null }
}
