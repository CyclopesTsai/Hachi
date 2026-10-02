import { describe, expect, it } from 'vitest'
import { httpRequestSchema } from '@shared/schemas/http-request'
import type { ChildNode, CollectionNode, WorkspaceTree } from '@shared/tree'
import {
  collectionIdOf,
  containerOptions,
  contextParentId,
  createDraftTab,
  createEnvironmentsTab,
  createItemTab,
  fromSession,
  insertTab,
  isDraftTab,
  isTabDirty,
  nextActiveKey,
  syncTabsWithTree,
  tabTitle,
  toSession,
  type RequestTab,
  type Tab
} from './tab-model'

const req = (id: string, extra: Partial<ChildNode> = {}): ChildNode =>
  ({
    kind: 'request',
    id,
    name: id,
    relPath: id,
    requestType: 'http',
    method: 'GET',
    ...extra
  }) as ChildNode
const folder = (id: string, children: ChildNode[]): ChildNode => ({
  kind: 'folder',
  id,
  name: id,
  relPath: id,
  children
})
const collection = (id: string, children: ChildNode[]): CollectionNode => ({
  kind: 'collection',
  id,
  name: id,
  relPath: id,
  children
})

// C1: [ F1: [ r1 ], r2, ws (websocket) ]   C2: [ r3 ]
const tree: WorkspaceTree = {
  workspaceId: 'w',
  collections: [
    collection('C1', [
      folder('F1', [req('r1')]),
      req('r2'),
      req('ws', { requestType: 'websocket' })
    ]),
    collection('C2', [req('r3')])
  ]
}

const node = (id: string) => {
  const find = (
    nodes: readonly (CollectionNode | ChildNode)[]
  ): CollectionNode | ChildNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n
      if ('children' in n) {
        const hit = find(n.children)
        if (hit) return hit
      }
    }
    return undefined
  }
  return find(tree.collections)!
}

const request = (name = 'R') =>
  httpRequestSchema.parse({ version: 1, id: 'x', type: 'http', name, url: 'http://a' })

/** A loaded request tab for item `id`. */
function loaded(id: string, preview = false): RequestTab {
  const tab = createItemTab(node(id), preview) as RequestTab
  return { ...tab, status: 'ready', saved: request(id), draft: request(id) }
}

describe('createItemTab', () => {
  it('picks the tab kind from the tree node', () => {
    expect(createItemTab(node('r1'), true)).toMatchObject({
      kind: 'request',
      key: 'item:r1',
      preview: true
    })
    expect(createItemTab(node('F1'), false)).toMatchObject({
      kind: 'container',
      containerKind: 'folder'
    })
    expect(createItemTab(node('C1'), false)).toMatchObject({ containerKind: 'collection' })
    expect(createItemTab(node('ws'), false)).toMatchObject({ kind: 'static', status: 'ready' })
    expect(createItemTab({ ...node('r2'), error: 'bad' } as ChildNode, false).kind).toBe('static')
  })
})

describe('dirty state', () => {
  it('compares the draft with the saved content once loaded', () => {
    const tab = loaded('r1')
    expect(isTabDirty(tab)).toBe(false)
    expect(isTabDirty({ ...tab, draft: { ...tab.draft!, url: 'http://b' } })).toBe(true)
    expect(isTabDirty({ ...tab, status: 'loading', draft: null })).toBe(false)
  })

  it('treats never-saved requests as dirty, and fresh drafts as clean', () => {
    const draft = createDraftTab(request('New'), { parentId: null })
    expect(isDraftTab(draft)).toBe(true)
    expect(isTabDirty(draft)).toBe(false)
    expect(isTabDirty({ ...draft, saved: null })).toBe(true)
    expect(isTabDirty({ ...draft, draft: { ...draft.draft!, url: 'x' } })).toBe(true)
  })
})

describe('insertTab', () => {
  it('opens after the active tab', () => {
    const tabs = [loaded('r1'), loaded('r2')]
    const out = insertTab(tabs, loaded('r3'), 'item:r1')
    expect(out.map((t) => t.key)).toEqual(['item:r1', 'item:r3', 'item:r2'])
    expect(
      insertTab(tabs, loaded('r3'), null)
        .map((t) => t.key)
        .at(-1)
    ).toBe('item:r3')
  })

  it('replaces the existing preview tab in place', () => {
    const tabs = [loaded('r1'), loaded('r2', true), loaded('r3')]
    const out = insertTab(tabs, loaded('r1', true), 'item:r3')
    expect(out.map((t) => t.key)).toEqual(['item:r1', 'item:r1', 'item:r3'])
    const pinned = insertTab(tabs, loaded('r3'), 'item:r3')
    expect(pinned).toHaveLength(4)
  })
})

describe('nextActiveKey', () => {
  const tabs = [loaded('r1'), loaded('r2'), loaded('r3')]
  it('moves to the right neighbour, else the left one', () => {
    expect(nextActiveKey(tabs, 'item:r2', 'item:r2')).toBe('item:r3')
    expect(nextActiveKey(tabs, 'item:r3', 'item:r3')).toBe('item:r2')
    expect(nextActiveKey(tabs, 'item:r1', 'item:r3')).toBe('item:r3')
    expect(nextActiveKey([loaded('r1')], 'item:r1', 'item:r1')).toBeNull()
  })
})

describe('syncTabsWithTree', () => {
  it('closes clean tabs of deleted items and keeps dirty ones as unsaved requests', () => {
    const clean = loaded('r1')
    const dirty = { ...loaded('r2'), draft: { ...request('r2'), url: 'changed' } }
    const without: WorkspaceTree = { ...tree, collections: [collection('C2', [req('r3')])] }
    const out = syncTabsWithTree([clean, dirty, createEnvironmentsTab()], without)
    expect(out.map((t) => t.kind)).toEqual(['request', 'environments'])
    const kept = out[0] as RequestTab
    expect(kept).toMatchObject({ itemId: null, saved: null, draftName: 'r2', key: 'item:r2' })
    expect(isTabDirty(kept)).toBe(true)
  })

  it('follows renames and replaces tabs whose kind changed', () => {
    const renamed: WorkspaceTree = {
      ...tree,
      collections: [collection('C1', [folder('F1', [req('r1', { name: 'Renamed' })])])]
    }
    const [tab] = syncTabsWithTree([loaded('r1')], renamed)
    expect((tab as RequestTab).draftName).toBe('Renamed')
    expect(tabTitle(tab!, renamed)).toBe('Renamed')

    const broken: WorkspaceTree = {
      ...tree,
      collections: [collection('C1', [folder('F1', [req('r1', { error: 'bad json' })])])]
    }
    expect(syncTabsWithTree([loaded('r1')], broken)[0]?.kind).toBe('static')
  })

  it('leaves drafts alone', () => {
    const draft = createDraftTab(request('New'), { parentId: 'gone' })
    expect(syncTabsWithTree([draft], { workspaceId: 'w', collections: [] })).toEqual([draft])
  })
})

describe('tree helpers', () => {
  it('finds the collection and the context parent of a tab', () => {
    expect(collectionIdOf(tree, 'r1')).toBe('C1')
    expect(collectionIdOf(tree, 'C2')).toBe('C2')
    expect(collectionIdOf(tree, 'nope')).toBeNull()
    expect(collectionIdOf(tree, null)).toBeNull()
    expect(contextParentId(loaded('r1'), tree)).toBe('F1')
    expect(contextParentId(createItemTab(node('F1'), false), tree)).toBe('C1')
    expect(contextParentId(createItemTab(node('C1'), false), tree)).toBeNull()
    expect(contextParentId(createDraftTab(request(), { parentId: 'F1' }), tree)).toBe('F1')
  })

  it('lists collections and folders as save locations', () => {
    expect(containerOptions(tree)).toEqual([
      { id: 'C1', label: 'C1' },
      { id: 'F1', label: 'C1 / F1' },
      { id: 'C2', label: 'C2' }
    ])
  })

  it('titles tabs from the tree, drafts by name', () => {
    expect(tabTitle(loaded('r3'), tree)).toBe('r3')
    expect(tabTitle(createDraftTab(request('Draft'), { parentId: null }), tree)).toBe('Draft')
    expect(tabTitle(createEnvironmentsTab(), tree)).toBe('環境')
  })
})

describe('session', () => {
  it('stores saved items and the environments tab, not drafts', () => {
    const tabs: Tab[] = [
      loaded('r1'),
      createDraftTab(request(), { parentId: null }),
      createEnvironmentsTab(),
      loaded('r3')
    ]
    expect(toSession(tabs, 'item:r3', 'env-1')).toEqual({
      tabs: [{ kind: 'item', id: 'r1' }, { kind: 'environments' }, { kind: 'item', id: 'r3' }],
      activeTab: 2,
      activeEnvironmentId: 'env-1'
    })
    expect(toSession(tabs, tabs[1]!.key, null).activeTab).toBeNull()
  })

  it('restores tabs of items that still exist', () => {
    const { tabs, activeKey } = fromSession(
      {
        tabs: [
          { kind: 'item', id: 'gone' },
          { kind: 'item', id: 'r2' },
          { kind: 'environments' },
          { kind: 'item', id: 'r2' }
        ],
        activeTab: 0,
        activeEnvironmentId: null
      },
      tree
    )
    expect(tabs.map((t) => t.key)).toEqual(['item:r2', 'environments'])
    expect(
      tabs.every((t) => !t.preview && (t.kind === 'environments' || t.status === 'idle'))
    ).toBe(true)
    expect(activeKey).toBe('item:r2') // the saved active tab is gone: first one
  })
})
