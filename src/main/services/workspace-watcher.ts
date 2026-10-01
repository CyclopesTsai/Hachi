import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { WORKSPACE_FILE, WORKSPACE_LAYOUT } from '@shared/schemas/workspace'
import { isTempFileName } from './fs/atomic-write'

/** What part of a Workspace a changed path belongs to. */
export type ChangeArea = 'collections' | 'workspace' | 'environments' | 'other'

const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '.DS_Store'])

/** True for paths the watcher should never report (VCS data, temp files from atomic writes). */
export function isIgnoredPath(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath)
  if (rel === '' || rel.startsWith('..')) return false
  return (
    rel.split(path.sep).some((part) => IGNORED_SEGMENTS.has(part)) ||
    isTempFileName(path.basename(filePath))
  )
}

export function classifyPath(root: string, filePath: string): ChangeArea {
  const rel = path.relative(root, filePath)
  const [first] = rel.split(path.sep)
  if (first === WORKSPACE_LAYOUT.collectionsDir) return 'collections'
  if (first === WORKSPACE_LAYOUT.environmentsDir) return 'environments'
  if (rel === WORKSPACE_FILE) return 'workspace'
  return 'other'
}

/**
 * Watches the current Workspace folder and reports changes, batched: events are
 * collected for `delayMs` after the last one, then `onChange` gets the set of areas.
 * Our own atomic writes are reported too; consumers re-scan and diff, which is cheap.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending = new Set<ChangeArea>()
  private root: string | null = null

  constructor(
    private readonly onChange: (areas: Set<ChangeArea>) => void,
    private readonly delayMs = 200,
    private readonly log: (message: string) => void = console.warn
  ) {}

  async start(root: string): Promise<void> {
    await this.stop()
    const resolved = path.resolve(root)
    this.root = resolved
    const watcher = watch(resolved, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 32,
      ignored: (p: string) => isIgnoredPath(resolved, p)
    })
    watcher.on('all', (_event, changed) => this.record(resolved, changed))
    watcher.on('error', (error) => this.log(`[watcher] ${String(error)}`))
    this.watcher = watcher
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    this.root = null
    const watcher = this.watcher
    this.watcher = null
    await watcher?.close()
  }

  private record(root: string, changed: string): void {
    if (root !== this.root) return // event from a watcher that is being closed
    this.pending.add(classifyPath(root, changed))
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const areas = this.pending
      this.pending = new Set()
      this.onChange(areas)
    }, this.delayMs)
  }
}
