/**
 * Git status of the current Workspace as sent to the renderer (decisions 111–116).
 * Types only — safe to import anywhere.
 */

export type GitChangeKind =
  'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFileChange {
  /** Relative to the Workspace folder, "/" separators. */
  path: string
  kind: GitChangeKind
  /** Renames: the previous path (relative to the Workspace). */
  oldPath?: string
}

export interface GitRepoStatus {
  state: 'repo'
  /** Absolute path of the repository's top folder (may contain the Workspace). */
  root: string
  /** Current branch; null when HEAD is detached (then `head` is the short commit id). */
  branch: string | null
  head: string | null
  /** "origin/main" etc., or null without an upstream. */
  upstream: string | null
  ahead: number
  behind: number
  /** Changes inside the Workspace folder only (decision 112). */
  files: GitFileChange[]
  /** No commit yet (fresh `git init`). */
  empty: boolean
  /** A pull stopped on conflicts (MERGE_HEAD exists, decision 114). */
  merging: boolean
  /** At least one remote is set (push / pull possible). */
  hasRemote: boolean
}

export interface GitRemote {
  name: string
  url: string
}

/** git asks for a username / password / key passphrase (decision 113). */
export interface GitPrompt {
  id: string
  /** git's own prompt, e.g. "Password for 'https://user@github.com': " */
  prompt: string
  kind: 'username' | 'password' | 'passphrase' | 'other'
}

/** How one conflicted file is settled (decision 114). */
export type GitResolution = 'ours' | 'theirs' | 'resolved'

export type GitStatus = { state: 'no-git' } | { state: 'not-repo' } | GitRepoStatus

export interface GitBranch {
  /** Short name: "main", or "origin/feature" for remote branches. */
  name: string
  remote: boolean
  current: boolean
  /** Local branches: their upstream ("origin/main"), if any. */
  upstream: string | null
}

/**
 * A file in the last commit and now (decision 119: the Commit screen's diff). For a
 * conflicted file (`conflict`): our version and their version, without conflict markers.
 */
export interface GitFileDiff {
  path: string
  conflict: boolean
  /** null: not in the last commit (new file) / deleted on our side */
  before: string | null
  /** null: deleted (on their side, for a conflict) */
  after: string | null
  /** Too large (over 2 MB) or not text: not shown. */
  unavailable: 'tooLarge' | 'binary' | null
}

export interface GitIdentity {
  name: string
  email: string
}

// ---- History (decision 116) ------------------------------------------------

export interface GitRef {
  /** "main", "origin/main", "v1.0" */
  name: string
  kind: 'head' | 'branch' | 'remote' | 'tag'
}

export interface GitCommitSummary {
  hash: string
  parents: string[]
  author: string
  email: string
  /** Author time, epoch milliseconds. */
  date: number
  refs: GitRef[]
  subject: string
}

export interface GitLog {
  commits: GitCommitSummary[]
  /** More commits exist after these. */
  more: boolean
}

export interface GitCommitFile {
  /** Relative to the repository, "/" separators (used to ask for its diff). */
  repoPath: string
  /** Relative to the Workspace when inside it, otherwise the repository path. */
  path: string
  inWorkspace: boolean
  kind: 'added' | 'modified' | 'deleted' | 'renamed'
  /** Renames: the previous repository path. */
  oldRepoPath?: string
}

export interface GitCommitDetail extends GitCommitSummary {
  /** The whole message (subject and body). */
  message: string
  /** Compared with the first parent (merges: what the merge brought in). */
  files: GitCommitFile[]
}
