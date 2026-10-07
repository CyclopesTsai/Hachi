/** Parsers for git's machine-readable output (pure, unit tested). */
import type { GitBranch, GitChangeKind, GitFileChange } from '@shared/git'

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
