/** Parsers for git's machine-readable output (pure, unit tested). */
import type {
  GitBranch,
  GitChangeKind,
  GitCommitFile,
  GitCommitSummary,
  GitFileChange,
  GitRef
} from '@shared/git'

export interface ParsedStatus {
  /** Branch name; null when detached. */
  branch: string | null
  /** Commit id of HEAD; null before the first commit. */
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Paths relative to the repository root. */
  files: GitFileChange[]
}

function kindOf(xy: string): GitChangeKind {
  const [x = '.', y = '.'] = xy
  if (x === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  return 'modified'
}

/** `git status --porcelain=v2 --branch -z` */
export function parseStatus(output: string): ParsedStatus {
  const result: ParsedStatus = {
    branch: null,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: []
  }
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string
    if (field === '') continue
    if (field.startsWith('# ')) {
      const [, key, ...rest] = field.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') result.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') result.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') result.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          result.ahead = Number(m[1])
          result.behind = Number(m[2])
        }
      }
      continue
    }
    const type = field[0]
    if (type === '?') {
      result.files.push({ path: field.slice(2), kind: 'untracked' })
    } else if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const parts = field.split(' ')
      result.files.push({ path: parts.slice(8).join(' '), kind: kindOf(parts[1] ?? '') })
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path, then the original path as the next field
      const parts = field.split(' ')
      const oldPath = fields[++i] ?? ''
      result.files.push({ path: parts.slice(9).join(' '), kind: 'renamed', oldPath })
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = field.split(' ')
      result.files.push({ path: parts.slice(10).join(' '), kind: 'conflicted' })
    }
  }
  return result
}

/**
 * `git for-each-ref --format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(HEAD)
 * refs/heads refs/remotes` (one ref per line).
 */
export function parseBranches(output: string): GitBranch[] {
  const branches: GitBranch[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const [ref = '', short = '', upstream = '', head = ''] = line.split('\0')
    // origin/HEAD only points at the remote's default branch.
    if (ref.startsWith('refs/remotes/') && ref.endsWith('/HEAD')) continue
    branches.push({
      name: short,
      remote: ref.startsWith('refs/remotes/'),
      current: head === '*',
      upstream: upstream === '' ? null : upstream
    })
  }
  return branches
}

/** The log format read by `parseLog` (fields: \x1f, records: \x1e). */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e'

/** `%D` with `--decorate=full`: "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1" */
export function parseRefs(decoration: string): GitRef[] {
  const refs: GitRef[] = []
  for (const raw of decoration.split(', ')) {
    let name = raw.trim()
    if (name === '' || name === 'refs/stash') continue
    if (name.startsWith('HEAD -> ')) {
      refs.push({ name: 'HEAD', kind: 'head' })
      name = name.slice('HEAD -> '.length)
    } else if (name === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head' })
      continue
    }
    if (name.startsWith('tag: ')) name = name.slice('tag: '.length)
    if (name.startsWith('refs/heads/')) refs.push({ name: name.slice(11), kind: 'branch' })
    else if (name.startsWith('refs/remotes/')) {
      // origin/HEAD only points at the remote's default branch.
      if (!name.endsWith('/HEAD')) refs.push({ name: name.slice(13), kind: 'remote' })
    } else if (name.startsWith('refs/tags/')) refs.push({ name: name.slice(10), kind: 'tag' })
  }
  return refs
}

export function parseLog(output: string): GitCommitSummary[] {
  return output
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [
        hash = '',
        parents = '',
        author = '',
        email = '',
        time = '0',
        refs = '',
        subject = ''
      ] = record.split('\x1f')
      return {
        hash,
        parents: parents.split(' ').filter(Boolean),
        author,
        email,
        date: Number(time) * 1000,
        refs: parseRefs(refs),
        subject
      }
    })
}

/** `git diff --name-status -z -M` → files of a commit (repository paths). */
export function parseNameStatus(output: string): Omit<GitCommitFile, 'path' | 'inWorkspace'>[] {
  const fields = output.split('\0')
  const files: Omit<GitCommitFile, 'path' | 'inWorkspace'>[] = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i] as string
    if (status === '') continue
    const code = status[0]
    if (code === 'R' || code === 'C') {
      const oldRepoPath = fields[++i] ?? ''
      const repoPath = fields[++i] ?? ''
      files.push(
        code === 'R' ? { repoPath, kind: 'renamed', oldRepoPath } : { repoPath, kind: 'added' }
      )
    } else {
      const repoPath = fields[++i] ?? ''
      files.push({
        repoPath,
        kind: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
      })
    }
  }
  return files
}
