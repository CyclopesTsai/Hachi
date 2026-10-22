/** Hachi names for the files git reports (decision 112): pure, unit tested. */
import { isContainer, type TreeNode, type WorkspaceTree } from '@shared/tree'
import { msg } from '@shared/i18n'

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
      for (const example of node.examples ?? []) {
        index.set(example.relPath, {
          title: msg().git.names.example(names.join(' / '), example.name),
          itemId: null
        })
      }
      return
    }
    const meta = node.kind === 'collection' ? 'collection.json' : 'folder.json'
    index.set(`${node.relPath}/${meta}`, {
      title: msg().git.names.settings(names.join(' / ')),
      itemId: node.id
    })
    node.children.forEach((child) => visit(child, names))
  }
  tree.collections.forEach((c) => visit(c, []))
  return index
}

export function labelFor(index: ReadonlyMap<string, FileLabel>, path: string): FileLabel {
  const known = index.get(path)
  if (known) return known
  if (path === 'workspace.json') return { title: msg().git.names.workspace, itemId: null }
  const env = /^environments\/([^/]+)\.json$/.exec(path)
  if (env) return { title: msg().git.names.environment(env[1] as string), itemId: null }
  return { title: path.slice(path.lastIndexOf('/') + 1), itemId: null }
}

/** How to install git on this platform (decision 111). */
export function gitInstallHint(platform: string | undefined): string {
  const m = msg().git.install
  if (platform === 'win32') return m.win32
  if (platform === 'darwin') return m.darwin
  return m.other
}
