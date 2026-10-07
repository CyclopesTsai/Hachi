import { describe, expect, it } from 'vitest'
import type { GitFileChange } from '@shared/git'
import type { WorkspaceTree } from '@shared/tree'
import { buildChangeTree, type ChangeNode } from './change-tree'

const tree: WorkspaceTree = {
  workspaceId: 'w',
  collections: [
    {
      kind: 'collection',
      id: 'c',
      name: 'Google API',
      relPath: 'collections/google-api',
      children: [
        {
          kind: 'folder',
          id: 'f',
          name: 'Maps',
          relPath: 'collections/google-api/maps',
          children: [
            {
              kind: 'request',
              id: 'r',
              name: 'Geocoding',
              relPath: 'collections/google-api/maps/geocoding.json',
              requestType: 'http',
              method: 'GET'
            }
          ]
        }
      ]
    }
  ]
}

const file = (path: string, kind: GitFileChange['kind'] = 'modified'): GitFileChange => ({
  path,
  kind
})

/** name (and paths for folders), nested. */
const shape = (nodes: ChangeNode[]): unknown[] =>
  nodes.map((n) => (n.kind === 'folder' ? [n.name, n.paths.length, shape(n.children)] : n.name))

describe('buildChangeTree', () => {
  it('nests files under their collections and folders, with Hachi names', () => {
    const nodes = buildChangeTree(
      [
        file('.gitignore'),
        file('collections/google-api/collection.json'),
        file('collections/google-api/maps/geocoding.json'),
        file('collections/google-api/maps/old.json', 'deleted'),
        file('environments/dev.json'),
        file('workspace.json')
      ],
      tree
    )
    expect(shape(nodes)).toEqual([
      ['environments', 1, ['dev.json']],
      ['Google API', 3, [['Maps', 2, ['Geocoding', 'old.json']], '（設定）']],
      '.gitignore',
      'workspace.json'
    ])
  })
})
