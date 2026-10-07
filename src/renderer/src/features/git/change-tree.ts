/**
 * Changed files as a tree (decision 122): folders named after their Hachi collection /
 * folder, the top "collections" folder left out. Pure, unit tested.
 */
import type { GitFileChange } from '@shared/git'
import { isContainer, type TreeNode, type WorkspaceTree } from '@shared/tree'

export interface ChangeFolder {
  kind: 'folder'
  /** Directory path (Workspace-relative). */
  key: string
  name: string
  children: ChangeNode[]
  /** Paths of every changed file below. */
  paths: string[]
}

export interface ChangeLeaf {
  kind: 'file'
  key: string
  /** Name inside its folder: the request's name, （設定）, or the file name. */
  name: string
  file: GitFileChange
}

export type ChangeNode = ChangeFolder | ChangeLeaf

const META_FILES = new Set(['collection.json', 'folder.json'])

export function buildChangeTree(
  files: readonly GitFileChange[],
  tree: WorkspaceTree
): ChangeNode[] {
  // Hachi names of directories (collections / folders) and of request files.
  const dirNames = new Map<string, string>()
  const fileNames = new Map<string, string>()
  const visit = (node: TreeNode) => {
    if (isContainer(node)) {
      dirNames.set(node.relPath, node.name)
      node.children.forEach(visit)
    } else fileNames.set(node.relPath, node.name)
  }
  tree.collections.forEach(visit)

  const root: ChangeFolder = { kind: 'folder', key: '', name: '', children: [], paths: [] }
  const folders = new Map<string, ChangeFolder>([['', root]])
  const folderOf = (dir: string): ChangeFolder => {
    const existing = folders.get(dir)
    if (existing) return existing
    const slash = dir.lastIndexOf('/')
    const parentDir = slash < 0 ? '' : dir.slice(0, slash)
    // The "collections" folder itself is not shown: collections sit at the top.
    const parent = parentDir === 'collections' ? root : folderOf(parentDir)
    const folder: ChangeFolder = {
      kind: 'folder',
      key: dir,
      name: dirNames.get(dir) ?? dir.slice(slash + 1),
      children: [],
      paths: []
    }
    parent.children.push(folder)
    folders.set(dir, folder)
    return folder
  }

  for (const file of files) {
    const slash = file.path.lastIndexOf('/')
    const dir = slash < 0 ? '' : file.path.slice(0, slash)
    const base = file.path.slice(slash + 1)
    const folder = dir === 'collections' ? root : folderOf(dir)
    folder.children.push({
      kind: 'file',
      key: file.path,
      name: META_FILES.has(base) && dir !== '' ? '（設定）' : (fileNames.get(file.path) ?? base),
      file
    })
    for (let d: string | null = dir; d !== null;) {
      const target = d === '' || d === 'collections' ? root : folders.get(d)
      target?.paths.push(file.path)
      if (d === '') break
      const s = d.lastIndexOf('/')
      d = s < 0 ? '' : d.slice(0, s)
      if (d === 'collections') d = ''
    }
  }

  const sort = (nodes: ChangeNode[]) => {
    nodes.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)
    )
    for (const n of nodes) if (n.kind === 'folder') sort(n.children)
  }
  sort(root.children)
  return root.children
}
