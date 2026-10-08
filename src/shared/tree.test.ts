import { describe, expect, it } from 'vitest'
import { findRequestByPath, type WorkspaceTree } from './tree'

const tree: WorkspaceTree = {
  workspaceId: 'w',
  collections: [
    {
      id: 'c1',
      kind: 'collection',
      name: 'Shop',
      relPath: 'Shop',
      children: [
        {
          id: 'f1',
          kind: 'folder',
          name: 'Auth',
          relPath: 'Shop/Auth',
          children: [
            { id: 'r1', kind: 'request', name: 'Login', relPath: 'x', requestType: 'http' }
          ]
        },
        { id: 'r2', kind: 'request', name: 'List', relPath: 'y', requestType: 'http' }
      ]
    },
    {
      id: 'c2',
      kind: 'collection',
      name: 'Other',
      relPath: 'Other',
      children: [{ id: 'r3', kind: 'request', name: 'List', relPath: 'z', requestType: 'http' }]
    }
  ]
}

describe('findRequestByPath', () => {
  it('finds by name path inside the same collection', () => {
    expect(findRequestByPath(tree, 'f1', 'Auth/Login')?.node.id).toBe('r1')
    expect(findRequestByPath(tree, 'r1', 'List')?.node.id).toBe('r2')
    expect(findRequestByPath(tree, 'c2', 'List')?.node.id).toBe('r3')
    expect(findRequestByPath(tree, 'c1', ' Auth / Login ')?.parent.id).toBe('f1')
  })

  it('finds by id anywhere', () => {
    expect(findRequestByPath(tree, 'c1', 'r3')?.parent.id).toBe('c2')
  })

  it('returns null when nothing matches', () => {
    expect(findRequestByPath(tree, 'c1', 'Login')).toBeNull()
    expect(findRequestByPath(tree, 'c1', 'Auth')).toBeNull()
    expect(findRequestByPath(tree, null, 'List')).toBeNull()
    expect(findRequestByPath(tree, 'c1', '')).toBeNull()
  })
})
