import { describe, expect, it } from 'vitest'
import type { WorkspaceTree } from '@shared/tree'
import { fileIndex, labelFor } from './git-names'

const tree: WorkspaceTree = {
  workspaceId: 'w',
  collections: [
    {
      kind: 'collection',
      id: 'c',
      name: 'Shop',
      relPath: 'collections/shop',
      children: [
        {
          kind: 'folder',
          id: 'f',
          name: 'Users',
          relPath: 'collections/shop/users',
          children: [
            {
              kind: 'request',
              id: 'r',
              name: 'Get user',
              relPath: 'collections/shop/users/get-user.json',
              requestType: 'http',
              method: 'GET'
            }
          ]
        }
      ]
    }
  ]
}

describe('git file labels', () => {
  const index = fileIndex(tree)
  it('names requests and container settings after their Hachi items', () => {
    expect(labelFor(index, 'collections/shop/users/get-user.json')).toEqual({
      title: 'Shop / Users / Get user',
      itemId: 'r'
    })
    expect(labelFor(index, 'collections/shop/collection.json')).toEqual({
      title: 'Shop（設定）',
      itemId: 'c'
    })
    expect(labelFor(index, 'collections/shop/users/folder.json').itemId).toBe('f')
  })

  it('describes other files', () => {
    expect(labelFor(index, 'workspace.json').title).toBe('Workspace 設定')
    expect(labelFor(index, 'environments/dev.json').title).toBe('環境檔 dev')
    expect(labelFor(index, 'collections/old/gone.json')).toEqual({
      title: 'gone.json',
      itemId: null
    })
  })
})
