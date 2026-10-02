import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { HachiError, isHachiError } from '@shared/errors'
import { copyName, slugify } from '@shared/file-names'
import {
  COLLECTION_FILE,
  FOLDER_FILE,
  RESERVED_FILE_NAMES,
  collectionFormat,
  folderFormat,
  newCollectionFile,
  newFolderFile,
  ITEM_VERSION,
  newRequestFile,
  requestFormat,
  type Auth,
  type KeyValue,
  type RequestType
} from '@shared/schemas/collection'
import { httpRequestSchema, type HttpRequest } from '@shared/schemas/http-request'
import { parseVersioned, type VersionedFormat } from '@shared/schemas/versioned'
import { WORKSPACE_FILE, WORKSPACE_LAYOUT, workspaceFormat } from '@shared/schemas/workspace'
import type { ContainerSettingsData, InheritedSettings } from '@shared/http'
import {
  INVALID_ID_PREFIX,
  findNode,
  isSelfOrDescendant,
  type ChildNode,
  type CollectionNode,
  type ContainerNode,
  type ItemKind,
  type RequestNode,
  type TreeNode,
  type WorkspaceTree
} from '@shared/tree'
import { isTempFileName, updateJsonAtomic, writeJsonAtomic } from './fs/atomic-write'
import { readJsonFile, readVersionedJson } from './fs/json-file'
import { resolveInherited, type ContainerLevel } from './http/build-request'

const httpRequestFormat: VersionedFormat<typeof httpRequestSchema> = {
  name: 'request file',
  currentVersion: ITEM_VERSION,
  schema: httpRequestSchema
}

/** Moves a file or folder to the system trash. Injected so tests don't touch the real trash. */
export type TrashFn = (absPath: string) => Promise<void>

interface IndexEntry {
  kind: ItemKind
  /** Folder for collections / folders, JSON file for requests. */
  absPath: string
  parentId: string | null
  /** collection.json / folder.json for containers, null for requests. */
  metaFile: string | null
  invalid: boolean
}

interface ScanContext {
  root: string
  index: Map<string, IndexEntry>
  seenIds: Set<string>
}

export interface CreateItemInput {
  parentId: string | null
  kind: ItemKind
  name: string
  requestType?: RequestType
}

const EMPTY_TREE: WorkspaceTree = { workspaceId: null, collections: [] }

function isHidden(name: string): boolean {
  return name.startsWith('.') || isTempFileName(name)
}

function toRelPath(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join('/')
}

function errorText(error: unknown): string {
  return isHachiError(error) ? error.message : String(error)
}

async function readRawObject(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readJsonFile(filePath)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HachiError('INVALID_FILE', `${filePath}: expected a JSON object`)
  }
  return raw as Record<string, unknown>
}

function subtreeIds(node: TreeNode): string[] {
  return 'children' in node ? [node.id, ...node.children.flatMap(subtreeIds)] : [node.id]
}

/** Returns a copy of the tree with node `id` replaced by `replacement` (or removed when null). */
export function replaceNode(
  tree: WorkspaceTree,
  id: string,
  replacement: TreeNode | null
): WorkspaceTree {
  const swap = <T extends TreeNode>(nodes: T[]): T[] =>
    nodes.flatMap((node): T[] => {
      if (node.id === id) return replacement ? [replacement as T] : []
      return 'children' in node ? [{ ...node, children: swap(node.children) }] : [node]
    })
  return { ...tree, collections: swap(tree.collections) }
}

/** Sorts by the ids in `order`; items not listed go last, by name. */
export function applyOrder<T extends TreeNode>(nodes: T[], order: readonly string[]): T[] {
  const position = new Map(order.map((id, i) => [id, i]))
  return [...nodes].sort((a, b) => {
    const pa = position.get(a.id)
    const pb = position.get(b.id)
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return a.name.localeCompare(b.name) || a.relPath.localeCompare(b.relPath)
  })
}

/**
 * Owns the Collection tree of the current Workspace.
 *
 * - The renderer only ever passes item ids; paths are looked up in an index built
 *   from the last scan, so renderer input can never point outside the Workspace.
 * - All operations (and scans) run one at a time.
 * - Every write is atomic; ordering lives in the parent's `order` array (ids).
 */
export class CollectionService {
  private root: string | null = null
  private workspaceId: string | null = null
  private tree: WorkspaceTree = EMPTY_TREE
  private treeJson = JSON.stringify(EMPTY_TREE)
  private index = new Map<string, IndexEntry>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<(tree: WorkspaceTree) => void>()

  constructor(
    private readonly trash: TrashFn,
    private readonly log: (message: string) => void = console.warn,
    private readonly newId: () => string = randomUUID
  ) {}

  onChange(listener: (tree: WorkspaceTree) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Switches to a Workspace (or none). The in-memory tree is cleared immediately. */
  open(root: string | null, workspaceId: string | null = null): Promise<WorkspaceTree> {
    this.setTree({ workspaceId: root ? workspaceId : null, collections: [] })
    // Switch inside the queue so an operation still running finishes against its own Workspace.
    return this.run(() => {
      this.root = root ? path.resolve(root) : null
      this.workspaceId = root ? workspaceId : null
      this.index = new Map()
      return this.rescan()
    })
  }

  /** Current tree, after any queued operation has finished. */
  getTree(): Promise<WorkspaceTree> {
    return this.run(async () => this.tree)
  }

  /** Re-reads the disk (e.g. after an external change). Listeners fire only if the tree changed. */
  refresh(): Promise<WorkspaceTree> {
    return this.run(() => this.rescan())
  }

  /**
   * Re-reads a single item from disk — a request, a folder or a whole collection
   * with everything inside it. The rest of the tree is left as it was.
   * An item whose file / folder no longer exists is removed from the tree.
   */
  refreshItem(id: string): Promise<WorkspaceTree> {
    return this.run(() => this.rescanItem(id))
  }

  /** Collections / folders above an item, outermost first, read fresh from disk. */
  getContainerChain(id: string): Promise<ContainerLevel[]> {
    return this.run(() => this.readChain(this.requireEntry(id).parentId))
  }

  /** Full content of an HTTP request plus what it inherits. */
  getRequest(id: string): Promise<{ request: HttpRequest; inherited: InheritedSettings }> {
    return this.run(async () => {
      const entry = this.requireValid(id)
      if (entry.kind !== 'request') throw new HachiError('INVALID_OPERATION', 'Not a request')
      const request = await this.readHttpRequest(entry.absPath)
      return { request, inherited: resolveInherited(await this.readChain(entry.parentId)) }
    })
  }

  /**
   * Saves editor content to the request file. The name, id and type on disk are kept
   * (renaming goes through `rename`); unknown fields already in the file are preserved.
   */
  saveRequest(
    id: string,
    request: HttpRequest
  ): Promise<{ request: HttpRequest; tree: WorkspaceTree }> {
    return this.run(async () => {
      const entry = this.requireValid(id)
      if (entry.kind !== 'request') throw new HachiError('INVALID_OPERATION', 'Not a request')
      await this.readHttpRequest(entry.absPath) // must still be a valid HTTP request
      await updateJsonAtomic(
        entry.absPath,
        () => readRawObject(entry.absPath),
        (raw) => ({
          ...raw,
          ...request,
          version: ITEM_VERSION,
          id: raw.id,
          type: 'http',
          name: raw.name
        })
      )
      const tree = await this.rescanItem(id)
      return { request: await this.readHttpRequest(entry.absPath), tree }
    })
  }

  /** Shared headers / auth of a collection or folder, plus what a folder inherits. */
  getContainer(id: string): Promise<ContainerSettingsData> {
    return this.run(async () => {
      const entry = this.requireContainer(id)
      const [own] = await this.readChainLevels([id])
      const inherited = resolveInherited(await this.readChain(entry.parentId))
      return {
        kind: entry.kind as 'collection' | 'folder',
        headers: own!.headers,
        auth: own!.auth,
        inherited
      }
    })
  }

  saveContainer(
    id: string,
    data: { headers: KeyValue[]; auth: Auth }
  ): Promise<ContainerSettingsData> {
    return this.run(async () => {
      const entry = this.requireContainer(id)
      const meta = entry.metaFile as string
      // A collection has nothing above it to inherit from.
      const auth =
        entry.kind === 'collection' && data.auth.type === 'inherit'
          ? { type: 'none' as const }
          : data.auth
      await updateJsonAtomic(
        meta,
        () => readRawObject(meta),
        (raw) => ({ ...raw, headers: data.headers, auth })
      )
      const [own] = await this.readChainLevels([id])
      const inherited = resolveInherited(await this.readChain(entry.parentId))
      return {
        kind: entry.kind as 'collection' | 'folder',
        headers: own!.headers,
        auth: own!.auth,
        inherited
      }
    })
  }

  create(input: CreateItemInput): Promise<{ id: string; tree: WorkspaceTree }> {
    return this.run(async () => {
      const root = this.requireRoot()
      const name = input.name.trim()
      const id = this.newId()

      if (input.kind === 'collection') {
        if (input.parentId !== null) {
          throw new HachiError(
            'INVALID_OPERATION',
            'Collections can only be created at the top level'
          )
        }
        const collectionsDir = path.join(root, WORKSPACE_LAYOUT.collectionsDir)
        const dir = path.join(
          collectionsDir,
          await this.uniqueName(collectionsDir, slugify(name), '')
        )
        await mkdir(dir, { recursive: true })
        await writeJsonAtomic(path.join(dir, COLLECTION_FILE), newCollectionFile(id, name))
        await this.writeOrder(null, [...this.childIds(null), id])
      } else {
        if (input.parentId === null) {
          throw new HachiError(
            'INVALID_OPERATION',
            'Folders and requests must be inside a Collection'
          )
        }
        const parent = this.requireContainer(input.parentId)
        if (input.kind === 'folder') {
          const dir = path.join(
            parent.absPath,
            await this.uniqueName(parent.absPath, slugify(name), '')
          )
          await mkdir(dir, { recursive: true })
          await writeJsonAtomic(path.join(dir, FOLDER_FILE), newFolderFile(id, name))
        } else {
          const file = path.join(
            parent.absPath,
            await this.uniqueName(parent.absPath, slugify(name), '.json')
          )
          await writeJsonAtomic(file, newRequestFile(id, name, input.requestType ?? 'http'))
        }
        await this.writeOrder(input.parentId, [...this.childIds(input.parentId), id])
      }
      return { id, tree: await this.rescan() }
    })
  }

  rename(id: string, nameInput: string): Promise<WorkspaceTree> {
    return this.run(async () => {
      const entry = this.requireValid(id)
      const name = nameInput.trim()
      const metaOrFile = entry.metaFile ?? entry.absPath
      await updateJsonAtomic(
        metaOrFile,
        () => readRawObject(metaOrFile),
        (raw) => ({ ...raw, name })
      )

      const dir = path.dirname(entry.absPath)
      const ext = entry.kind === 'request' ? '.json' : ''
      const current = path.basename(entry.absPath)
      const target = await this.uniqueName(dir, slugify(name), ext, current)
      if (target !== current) await rename(entry.absPath, path.join(dir, target))
      return this.rescan()
    })
  }

  duplicate(id: string): Promise<{ id: string; tree: WorkspaceTree }> {
    return this.run(async () => {
      const entry = this.requireValid(id)
      const found = findNode(this.tree, id)
      if (!found) throw new HachiError('NOT_FOUND', 'Item not found')
      const siblings = found.parent ? found.parent.children : this.tree.collections
      const name = copyName(
        found.node.name,
        siblings.map((s) => s.name)
      )
      const dir = path.dirname(entry.absPath)
      let newId: string

      if (entry.kind === 'request') {
        newId = this.newId()
        const raw = await readRawObject(entry.absPath)
        const file = path.join(dir, await this.uniqueName(dir, slugify(name), '.json'))
        await writeJsonAtomic(file, { ...raw, id: newId, name })
      } else {
        const target = path.join(dir, await this.uniqueName(dir, slugify(name), ''))
        newId = await this.copyContainer(entry.absPath, target, entry.kind, name)
      }

      const ids = this.childIds(entry.parentId)
      ids.splice(ids.indexOf(id) + 1, 0, newId)
      await this.writeOrder(entry.parentId, ids)
      return { id: newId, tree: await this.rescan() }
    })
  }

  /** Moves the item to the system trash. Works for unreadable (invalid) items too. */
  delete(id: string): Promise<WorkspaceTree> {
    return this.run(async () => {
      const root = this.requireRoot()
      const entry = this.requireEntry(id)
      const collectionsDir = path.join(root, WORKSPACE_LAYOUT.collectionsDir)
      if (!entry.absPath.startsWith(collectionsDir + path.sep)) {
        throw new HachiError('FORBIDDEN', 'Refusing to delete outside the collections folder')
      }
      await this.trash(entry.absPath)
      if (entry.parentId === null || !this.index.get(entry.parentId)?.invalid) {
        await this.writeOrder(
          entry.parentId,
          this.childIds(entry.parentId).filter((c) => c !== id)
        ).catch((error: unknown) =>
          this.log(`[collections] order update failed: ${errorText(error)}`)
        )
      }
      return this.rescan()
    })
  }

  /**
   * Moves an item to `index` among the children of `parentId` (null = top level,
   * collections only). `index` counts positions after the item is taken out.
   */
  move(id: string, parentId: string | null, index: number): Promise<WorkspaceTree> {
    return this.run(async () => {
      const entry = this.requireValid(id)
      const insert = (ids: string[]): string[] => {
        const next = ids.filter((c) => c !== id)
        next.splice(Math.min(index, next.length), 0, id)
        return next
      }

      if (entry.kind === 'collection') {
        if (parentId !== null) {
          throw new HachiError(
            'INVALID_OPERATION',
            'A Collection cannot be moved into another item'
          )
        }
        await this.writeOrder(null, insert(this.childIds(null)))
        return this.rescan()
      }

      if (parentId === null) {
        throw new HachiError(
          'INVALID_OPERATION',
          'Folders and requests must be inside a Collection'
        )
      }
      const target = this.requireContainer(parentId)
      const node = findNode(this.tree, id)?.node
      if (node && isSelfOrDescendant(node, parentId)) {
        throw new HachiError('INVALID_OPERATION', 'Cannot move a folder into itself')
      }

      if (entry.parentId !== parentId) {
        const ext = entry.kind === 'request' ? '.json' : ''
        const base = path.basename(entry.absPath, ext)
        const destination = path.join(
          target.absPath,
          await this.uniqueName(target.absPath, base, ext)
        )
        await rename(entry.absPath, destination)
        if (entry.parentId !== null && !this.index.get(entry.parentId)?.invalid) {
          await this.writeOrder(
            entry.parentId,
            this.childIds(entry.parentId).filter((c) => c !== id)
          )
        }
      }
      await this.writeOrder(parentId, insert(this.childIds(parentId)))
      return this.rescan()
    })
  }

  // ---------------------------------------------------------------- internals

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private setTree(tree: WorkspaceTree): void {
    const json = JSON.stringify(tree)
    if (json === this.treeJson) return
    this.tree = tree
    this.treeJson = json
    for (const listener of this.listeners) listener(tree)
  }

  private requireRoot(): string {
    if (!this.root) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    return this.root
  }

  private requireEntry(id: string): IndexEntry {
    this.requireRoot()
    const entry = this.index.get(id)
    if (!entry) throw new HachiError('NOT_FOUND', 'Item not found (it may have been removed)')
    return entry
  }

  private requireValid(id: string): IndexEntry {
    const entry = this.requireEntry(id)
    if (entry.invalid) {
      throw new HachiError('INVALID_FILE', 'This item cannot be read; fix or delete the file first')
    }
    return entry
  }

  private requireContainer(id: string): IndexEntry {
    const entry = this.requireValid(id)
    if (entry.kind === 'request') {
      throw new HachiError('INVALID_OPERATION', 'Requests cannot contain other items')
    }
    return entry
  }

  /** Child ids in current display order (includes items missing from `order`). */
  private childIds(parentId: string | null): string[] {
    if (parentId === null) return this.tree.collections.map((c) => c.id)
    const found = findNode(this.tree, parentId)
    return found && found.node.kind !== 'request' ? found.node.children.map((c) => c.id) : []
  }

  private async writeOrder(parentId: string | null, ids: string[]): Promise<void> {
    const order = ids.filter((id) => !id.startsWith(INVALID_ID_PREFIX))
    if (parentId === null) {
      const file = path.join(this.requireRoot(), WORKSPACE_FILE)
      await updateJsonAtomic(
        file,
        () => readRawObject(file),
        (raw) => ({ ...raw, collectionOrder: order })
      )
      return
    }
    const meta = this.requireContainer(parentId).metaFile as string
    await updateJsonAtomic(
      meta,
      () => readRawObject(meta),
      (raw) => ({ ...raw, order })
    )
  }

  /**
   * `base + ext`, or `base-2 + ext`, `base-3 + ext`… — whichever is free in `dir`
   * (case-insensitive). `keep` is the item's own current name, which counts as free.
   */
  private async uniqueName(dir: string, base: string, ext: string, keep?: string): Promise<string> {
    const taken = new Set(
      (await readdir(dir).catch(() => [] as string[]))
        .filter((n) => n !== keep)
        .map((n) => n.toLowerCase())
    )
    if (ext === '.json') for (const reserved of RESERVED_FILE_NAMES) taken.add(reserved)
    for (let i = 1; ; i++) {
      const candidate = `${i === 1 ? base : `${base}-${i}`}${ext}`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
  }

  /** Deep-copies a collection / folder, giving every item a new id. Returns the new root id. */
  private async copyContainer(
    source: string,
    target: string,
    kind: 'collection' | 'folder',
    name?: string
  ): Promise<string> {
    const metaName = kind === 'collection' ? COLLECTION_FILE : FOLDER_FILE
    await mkdir(target, { recursive: true })
    const idMap = new Map<string, string>()

    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (isHidden(entry.name)) continue
      const from = path.join(source, entry.name)
      const to = path.join(target, entry.name)
      if (entry.isDirectory()) {
        const oldId = await readRawObject(path.join(from, FOLDER_FILE))
          .then((raw) => raw.id)
          .catch(() => undefined)
        const copiedId = await this.copyContainer(from, to, 'folder')
        if (typeof oldId === 'string') idMap.set(oldId, copiedId)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        if ((RESERVED_FILE_NAMES as readonly string[]).includes(entry.name)) continue
        try {
          const raw = await readRawObject(from)
          const copiedId = this.newId()
          if (typeof raw.id === 'string') idMap.set(raw.id, copiedId)
          await writeJsonAtomic(to, { ...raw, id: copiedId })
        } catch {
          await copyFile(from, to) // unreadable file: copy as-is, it stays flagged as invalid
        }
      }
    }

    const newId = this.newId()
    try {
      const meta = await readRawObject(path.join(source, metaName))
      const order = Array.isArray(meta.order) ? meta.order : []
      await writeJsonAtomic(path.join(target, metaName), {
        ...meta,
        id: newId,
        ...(name !== undefined ? { name } : {}),
        order: order.flatMap((old) => {
          const mapped = typeof old === 'string' ? idMap.get(old) : undefined
          return mapped ? [mapped] : []
        })
      })
    } catch {
      await copyFile(path.join(source, metaName), path.join(target, metaName)).catch(
        () => undefined
      )
    }
    return newId
  }

  private async readHttpRequest(file: string): Promise<HttpRequest> {
    const raw = await readJsonFile(file)
    if (
      typeof raw === 'object' &&
      raw !== null &&
      (raw as { type?: unknown }).type === 'websocket'
    ) {
      throw new HachiError('INVALID_OPERATION', 'WebSocket requests are edited in Phase 4')
    }
    return parseVersioned(httpRequestFormat, raw)
  }

  /** Container levels from the collection down to `parentId` (inclusive). */
  private async readChain(parentId: string | null): Promise<ContainerLevel[]> {
    const ids: string[] = []
    for (let id = parentId; id !== null; id = this.requireEntry(id).parentId) ids.unshift(id)
    return this.readChainLevels(ids)
  }

  private async readChainLevels(ids: string[]): Promise<ContainerLevel[]> {
    const levels: ContainerLevel[] = []
    for (const id of ids) {
      const entry = this.requireValid(id)
      const format = entry.kind === 'collection' ? collectionFormat : folderFormat
      const meta = await readVersionedJson(entry.metaFile as string, format)
      levels.push({ id, name: meta.name, headers: meta.headers, auth: meta.auth })
    }
    return levels
  }

  /** Re-reads one item and its subtree; see refreshItem. Must run inside the queue. */
  private async rescanItem(id: string): Promise<WorkspaceTree> {
    const root = this.requireRoot()
    const entry = this.requireEntry(id)
    const found = findNode(this.tree, id)
    if (!found) throw new HachiError('NOT_FOUND', 'Item not found')

    const index = new Map(this.index)
    for (const old of subtreeIds(found.node)) index.delete(old)
    const seenIds = new Set([...index.keys()].filter((k) => !k.startsWith(INVALID_ID_PREFIX)))
    const ctx: ScanContext = { root, index, seenIds }

    let replacement: TreeNode | null = null
    const stillThere = await access(entry.absPath).then(
      () => true,
      () => false
    )
    if (stillThere) {
      replacement =
        entry.kind === 'request'
          ? await this.scanRequest(entry.absPath, entry.parentId as string, ctx)
          : await this.scanContainer(entry.absPath, entry.kind, entry.parentId, ctx)
    }
    if (this.root !== root) return this.tree
    this.index = ctx.index
    this.setTree(replaceNode(this.tree, id, replacement))
    return this.tree
  }

  // -------------------------------------------------------------------- scan

  private async rescan(): Promise<WorkspaceTree> {
    const root = this.root
    if (!root) {
      this.index = new Map()
      this.setTree(EMPTY_TREE)
      return this.tree
    }
    const ctx: ScanContext = { root, index: new Map(), seenIds: new Set() }
    const collectionsDir = path.join(root, WORKSPACE_LAYOUT.collectionsDir)
    // Never create folders here: the Workspace may have just been deleted.
    const entries = await readdir(collectionsDir, { withFileTypes: true }).catch(() => [])
    const collections: CollectionNode[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || isHidden(entry.name)) continue
      const node = await this.scanContainer(
        path.join(collectionsDir, entry.name),
        'collection',
        null,
        ctx
      )
      collections.push(node as CollectionNode)
    }
    const collectionOrder = await readVersionedJson(
      path.join(root, WORKSPACE_FILE),
      workspaceFormat
    )
      .then((ws) => ws.collectionOrder)
      .catch(() => [])

    if (this.root !== root) return this.tree // Workspace switched during the scan
    this.index = ctx.index
    this.setTree({
      workspaceId: this.workspaceId,
      collections: applyOrder(collections, collectionOrder)
    })
    return this.tree
  }

  /** Returns the item's id, assigning (and persisting) a new one if it duplicates another item. */
  private async claimId(id: string, file: string, ctx: ScanContext): Promise<string> {
    if (!ctx.seenIds.has(id) && !id.startsWith(INVALID_ID_PREFIX)) {
      ctx.seenIds.add(id)
      return id
    }
    const fresh = this.newId()
    this.log(`[collections] duplicate id in ${toRelPath(ctx.root, file)}; assigned a new id`)
    await updateJsonAtomic(
      file,
      () => readRawObject(file),
      (raw) => ({ ...raw, id: fresh })
    )
    ctx.seenIds.add(fresh)
    return fresh
  }

  private async scanContainer(
    dir: string,
    kind: 'collection' | 'folder',
    parentId: string | null,
    ctx: ScanContext
  ): Promise<ContainerNode> {
    const metaFile = path.join(dir, kind === 'collection' ? COLLECTION_FILE : FOLDER_FILE)
    const relPath = toRelPath(ctx.root, dir)
    let id: string
    let name = path.basename(dir)
    let order: string[] = []
    let error: string | undefined

    try {
      const meta = await readVersionedJson(
        metaFile,
        kind === 'collection' ? collectionFormat : folderFormat
      )
      id = await this.claimId(meta.id, metaFile, ctx)
      name = meta.name
      order = meta.order
    } catch (e) {
      if (isHachiError(e) && e.code === 'NOT_FOUND') {
        // A plain folder (created outside Hachi): adopt it by writing its metadata file.
        id = this.newId()
        ctx.seenIds.add(id)
        const file = kind === 'collection' ? newCollectionFile(id, name) : newFolderFile(id, name)
        await writeJsonAtomic(metaFile, file)
      } else {
        id = `${INVALID_ID_PREFIX}${relPath}`
        error = errorText(e)
      }
    }

    ctx.index.set(id, { kind, absPath: dir, parentId, metaFile, invalid: error !== undefined })

    const children: ChildNode[] = []
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (isHidden(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        children.push((await this.scanContainer(full, 'folder', id, ctx)) as ChildNode)
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        !(RESERVED_FILE_NAMES as readonly string[]).includes(entry.name)
      ) {
        children.push(await this.scanRequest(full, id, ctx))
      }
    }

    const base = {
      id,
      name,
      relPath,
      ...(error ? { error } : {}),
      children: applyOrder(children, order)
    }
    return kind === 'collection' ? { kind, ...base } : { kind, ...base }
  }

  private async scanRequest(
    file: string,
    parentId: string,
    ctx: ScanContext
  ): Promise<RequestNode> {
    const relPath = toRelPath(ctx.root, file)
    let node: RequestNode
    try {
      const request = await readVersionedJson(file, requestFormat)
      const id = await this.claimId(request.id, file, ctx)
      node = {
        kind: 'request',
        id,
        name: request.name,
        relPath,
        requestType: request.type,
        ...(request.type === 'http' ? { method: (request.method ?? 'GET').toUpperCase() } : {})
      }
    } catch (e) {
      node = {
        kind: 'request',
        id: `${INVALID_ID_PREFIX}${relPath}`,
        name: path.basename(file, '.json'),
        relPath,
        requestType: 'http',
        error: errorText(e)
      }
    }
    ctx.index.set(node.id, {
      kind: 'request',
      absPath: file,
      parentId,
      metaFile: null,
      invalid: node.error !== undefined
    })
    return node
  }
}
