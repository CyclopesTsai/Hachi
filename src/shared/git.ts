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
}

export type GitStatus = { state: 'no-git' } | { state: 'not-repo' } | GitRepoStatus

export interface GitBranch {
  /** Short name: "main", or "origin/feature" for remote branches. */
  name: string
  remote: boolean
  current: boolean
  /** Local branches: their upstream ("origin/main"), if any. */
  upstream: string | null
}

/** A file in the last commit and now (decision 119: the Commit screen's diff). */
export interface GitFileDiff {
  path: string
  /** null: not in the last commit (new file) */
  before: string | null
  /** null: deleted */
  after: string | null
  /** Too large (over 2 MB) or not text: not shown. */
  unavailable: 'tooLarge' | 'binary' | null
}

export interface GitIdentity {
  name: string
  email: string
}
