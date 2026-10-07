import { describe, expect, it } from 'vitest'
import type { ChildNode, CollectionNode, WorkspaceTree } from '@shared/tree'
import {
  allContainerIds,
  ancestorIds,
  countDescendants,
  dropPositionFor,
  flattenTree,
  isNoopMove,
  neighborRow,
  resolveDrop,
  searchTree
} from './tree-model'

const req = (id: string): ChildNode => ({
  kind: 'request',
  id,
  name: id,
  relPath: id,
  requestType: 'http',
  method: 'GET'
})
const folder = (id: string, children: ChildNode[], error?: string): ChildNode => ({
  kind: 'folder',
  id,
  name: id,
  relPath: id,
  children,
  ...(error ? { error } : {})
})
const collection = (id: string, children: ChildNode[]): CollectionNode => ({
  kind: 'collection',
  id,
  name: id,
  relPath: id,
  children
})

// C1: [ F1: [ r1, F2: [ r2 ] ], r3, Bad: [] (invalid) ]   C2: [ r4 ]
const tree: WorkspaceTree = {
  workspaceId: 'w',
  collections: [
    collection('C1', [
      folder('F1', [req('r1'), folder('F2', [req('r2')])]),
      req('r3'),
      folder('Bad', [], 'broken')
    ]),
    collection('C2', [req('r4')])
  ]
}

describe('neighborRow (↑ / ↓)', () => {
  it('moves through visible rows only and stops at the ends', () => {
    const expanded = new Set(['C1', 'F1'])
    expect(neighborRow(tree, expanded, 'r1', 1)?.id).toBe('F2')
    expect(neighborRow(tree, expanded, 'F2', 1)?.id).toBe('r3')
    expect(neighborRow(tree, expanded, 'F1', -1)?.id).toBe('C1')
    expect(neighborRow(tree, expanded, 'C1', -1)).toBeNull()
    expect(neighborRow(tree, expanded, 'C2', 1)).toBeNull()
    expect(neighborRow(tree, expanded, 'missing', 1)).toBeNull()
  })
})

describe('flattenTree', () => {
  it('only descends into expanded containers', () => {
    const rows = flattenTree(tree, new Set(['C1', 'F1']))
    expect(rows.map((r) => `${'.'.repeat(r.depth)}${r.node.id}`)).toEqual([
      'C1',
      '.F1',
      '..r1',
      '..F2',
      '.r3',
      '.Bad',
      'C2'
    ])
    expect(rows[2]?.parentId).toBe('F1')
  })
})

describe('helpers', () => {
  it('counts descendants and finds ancestors', () => {
    expect(countDescendants(tree.collections[0]!)).toBe(6)
    expect(ancestorIds(tree, 'r2')).toEqual(['C1', 'F1', 'F2'])
    expect(ancestorIds(tree, 'C2')).toEqual([])
  })
})

describe('dropPositionFor', () => {
  const r = req('x')
  const f = folder('f', [])
  const c = collection('c', [])
  it('uses before/after halves for requests and when dragging collections', () => {
    expect(dropPositionFor(r, r, 0.3)).toBe('before')
    expect(dropPositionFor(r, r, 0.6)).toBe('after')
    expect(dropPositionFor(c, c, 0.2)).toBe('before')
  })
  it('uses before / inside / after thirds for folders', () => {
    expect(dropPositionFor(r, f, 0.1)).toBe('before')
    expect(dropPositionFor(r, f, 0.5)).toBe('inside')
    expect(dropPositionFor(r, f, 0.9)).toBe('after')
  })
  it('always drops inside a collection when dragging a folder / request', () => {
    expect(dropPositionFor(r, c, 0.05)).toBe('inside')
  })
})

describe('resolveDrop', () => {
  it('reorders siblings', () => {
    expect(resolveDrop(tree, 'r3', 'F1', 'before')).toEqual({ parentId: 'C1', index: 0 })
    expect(resolveDrop(tree, 'F1', 'r3', 'after')).toEqual({ parentId: 'C1', index: 1 })
  })

  it('moves into containers, appending at the end', () => {
    expect(resolveDrop(tree, 'r4', 'F2', 'inside')).toEqual({ parentId: 'F2', index: 1 })
    expect(resolveDrop(tree, 'r1', 'C2', 'inside')).toEqual({ parentId: 'C2', index: 1 })
  })

  it('reorders collections only among themselves', () => {
    expect(resolveDrop(tree, 'C2', 'C1', 'before')).toEqual({ parentId: null, index: 0 })
    expect(resolveDrop(tree, 'C1', 'C2', 'inside')).toBeNull()
    expect(resolveDrop(tree, 'C1', 'r4', 'before')).toBeNull()
  })

  it('rejects invalid drops', () => {
    expect(resolveDrop(tree, 'F1', 'F2', 'inside')).toBeNull() // into own descendant
    expect(resolveDrop(tree, 'F1', 'r2', 'before')).toBeNull() // next to own descendant
    expect(resolveDrop(tree, 'r1', 'r1', 'after')).toBeNull()
    expect(resolveDrop(tree, 'r1', 'C1', 'before')).toBeNull() // between collections
    expect(resolveDrop(tree, 'r1', 'Bad', 'inside')).toBeNull() // unreadable folder
    expect(resolveDrop(tree, 'r3', 'r1', 'inside')).toBeNull() // requests hold nothing
    expect(resolveDrop(tree, 'nope', 'r1', 'before')).toBeNull()
  })
})

describe('isNoopMove', () => {
  it('detects drops that keep the item in place', () => {
    expect(isNoopMove(tree, 'r3', { parentId: 'C1', index: 1 })).toBe(true)
    expect(isNoopMove(tree, 'r3', { parentId: 'C1', index: 0 })).toBe(false)
    expect(isNoopMove(tree, 'C1', { parentId: null, index: 0 })).toBe(true)
  })
})

describe('search and expand all (decisions 108 / 109)', () => {
  const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id)

  it('lists every collection and folder for 全部展開', () => {
    expect(allContainerIds(tree)).toEqual(['C1', 'F1', 'F2', 'Bad', 'C2'])
    expect(ids(flattenTree(tree, new Set(allContainerIds(tree))))).toEqual([
      'C1',
      'F1',
      'r1',
      'F2',
      'r2',
      'r3',
      'Bad',
      'C2',
      'r4'
    ])
  })

  it('shows matches with their ancestors, case-insensitively', () => {
    const found = searchTree(tree, ' R2 ')
    expect(found?.matches).toBe(1)
    expect(found?.expand).toEqual(['C1', 'F1', 'F2'])
    expect(ids(flattenTree(tree, new Set(found?.expand), found?.visible))).toEqual([
      'C1',
      'F1',
      'F2',
      'r2'
    ])
  })

  it('keeps everything inside a matching folder or collection', () => {
    const found = searchTree(tree, 'f1')
    expect(found?.expand).toEqual(['C1'])
    // F1 itself stays as it was (collapsed here); its contents are still searchable rows.
    expect(ids(flattenTree(tree, new Set(['C1', 'F1', 'F2']), found?.visible))).toEqual([
      'C1',
      'F1',
      'r1',
      'F2',
      'r2'
    ])
    expect(searchTree(tree, 'C2')?.visible).toEqual(new Set(['C2', 'r4']))
  })

  it('returns null for an empty query and nothing for no match', () => {
    expect(searchTree(tree, '  ')).toBeNull()
    expect(searchTree(tree, 'zzz')).toMatchObject({ matches: 0, expand: [] })
    expect(flattenTree(tree, new Set(), searchTree(tree, 'zzz')?.visible)).toEqual([])
  })

  it('moves ↑ / ↓ among the search results only', () => {
    const found = searchTree(tree, 'r')
    expect(neighborRow(tree, new Set(found?.expand), 'r3', 1, found?.visible)?.id).toBe('C2')
  })
})
