/**
 * Git for the current Workspace (decisions 111–115): status, commit of chosen files,
 * discarding a file's changes, branches. Operations run one at a time; every path from
 * the renderer must be one the status reported.
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { HachiError } from '@shared/errors'
import type {
  GitBranch,
  GitCommitDetail,
  GitCommitFile,
  GitFileChange,
  GitLog,
  GitFileDiff,
  GitIdentity,
  GitRemote,
  GitRepoStatus,
  GitResolution,
  GitStatus
} from '@shared/git'
import { findGit, runGit, type GitLocator, type GitResult } from './git-exec'
import { LOG_FORMAT, parseBranches, parseLog, parseNameStatus, parseStatus } from './parse'

/** Fetch / pull / push may wait for the network and for the user's password. */
const NETWORK_TIMEOUT_MS = 10 * 60_000

/** Environment that makes git ask for credentials through the app (askpass.ts). */
export type AskpassEnv = () => Promise<Record<string, string>>

/** Larger files are not compared (decision 119). */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024

/** Commits per page of the History (decision 116). */
export const LOG_PAGE = 300

const isHash = (hash: string) => /^[0-9a-f]{7,64}$/.test(hash)

/** Moves a file to the trash (recoverable), like deletions elsewhere in Hachi. */
export type TrashFile = (absPath: string) => Promise<void>

const toPosix = (p: string) => p.split(path.sep).join('/')

/** The first meaningful line of git's error output. */
function gitMessage(result: GitResult): string {
  const lines = result.stderr
    .split('\n')
    .map((l) => l.replace(/^(fatal|error):\s*/, '').trim())
    .filter((l) => l !== '' && !l.startsWith('hint:'))
  return lines[0] ?? `git exited with code ${result.code}`
}

export class GitService {
  private gitPath: Promise<string | null> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly locator: GitLocator,
    private readonly trash: TrashFile,
    private readonly askpass: AskpassEnv = async () => ({})
  ) {}

  /** Runs operations one at a time (git takes a lock on the index). */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }

  private findGit(): Promise<string | null> {
    // A failed search is retried next time (git may have been installed meanwhile).
    this.gitPath ??= findGit(this.locator).then((found) => {
      if (!found) this.gitPath = null
      return found
    })
    return this.gitPath
  }

  private async exec(cwd: string, args: string[], network = false): Promise<GitResult> {
    const git = await this.findGit()
    if (!git) throw new HachiError('NOT_FOUND', '找不到 git，請先安裝')
    return runGit(git, ['-c', 'core.quotepath=false', ...args], {
      cwd,
      // No editor ever opens (merge commits use their default message).
      env: { GIT_EDITOR: ':', GIT_MERGE_AUTOEDIT: 'no', ...(network ? await this.askpass() : {}) },
      timeoutMs: network ? NETWORK_TIMEOUT_MS : undefined
    })
  }

  /** Runs git; a failure becomes an error with git's own message. */
  private async must(cwd: string, args: string[], what: string, network = false): Promise<string> {
    const result = await this.exec(cwd, args, network)
    if (result.code !== 0) throw new HachiError('IO_ERROR', `${what}失敗：${gitMessage(result)}`)
    return result.stdout
  }

  status(workspace: string): Promise<GitStatus> {
    return this.run(() => this.readStatus(workspace))
  }

  private async readStatus(workspace: string): Promise<GitStatus> {
    if (!(await this.findGit())) return { state: 'no-git' }
    const top = await this.exec(workspace, ['rev-parse', '--show-toplevel'])
    if (top.code !== 0) return { state: 'not-repo' }
    const root = await realpath(top.stdout.trim())
    // The Workspace may be a folder inside the repository (decision 111).
    const prefix = toPosix(path.relative(root, await realpath(workspace)))
    const out = await this.must(
      root,
      [
        'status',
        '--porcelain=v2',
        '--branch',
        '-z',
        '--untracked-files=all',
        '--',
        prefix === '' ? '.' : prefix
      ],
      '讀取 Git 狀態'
    )
    const parsed = parseStatus(out)
    const inWorkspace = (p: string) => (prefix === '' ? p : p.slice(prefix.length + 1))
    const files: GitFileChange[] = parsed.files.map((f) => ({
      ...f,
      path: inWorkspace(f.path),
      ...(f.oldPath !== undefined
        ? {
            oldPath:
              f.oldPath.startsWith(`${prefix}/`) || prefix === ''
                ? inWorkspace(f.oldPath)
                : f.oldPath
          }
        : {})
    }))
    return {
      state: 'repo',
      root,
      branch: parsed.branch,
      head: parsed.oid ? parsed.oid.slice(0, 7) : null,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      empty: parsed.oid === null,
      merging: (await this.exec(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code === 0,
      hasRemote: (await this.exec(root, ['remote'])).stdout.trim() !== ''
    }
  }

  private async requireRepo(workspace: string): Promise<GitRepoStatus & { prefix: string }> {
    const status = await this.readStatus(workspace)
    if (status.state === 'no-git') throw new HachiError('NOT_FOUND', '找不到 git，請先安裝')
    if (status.state === 'not-repo') {
      throw new HachiError('INVALID_OPERATION', '這個 Workspace 不在 Git repo 中')
    }
    const prefix = toPosix(path.relative(status.root, await realpath(workspace)))
    return { ...status, prefix }
  }

  /** `git init` in the Workspace folder (first branch: main). */
  init(workspace: string): Promise<GitStatus> {
    return this.run(async () => {
      await this.must(workspace, ['-c', 'init.defaultBranch=main', 'init'], '建立 Git repo')
      return this.readStatus(workspace)
    })
  }

  /** user.name / user.email git would use here, or null when one is missing. */
  identity(workspace: string): Promise<GitIdentity | null> {
    return this.run(async () => {
      const name = (await this.exec(workspace, ['config', 'user.name'])).stdout.trim()
      const email = (await this.exec(workspace, ['config', 'user.email'])).stdout.trim()
      return name !== '' && email !== '' ? { name, email } : null
    })
  }

  /** Saves user.name / user.email for this repository, or for every repository (global). */
  setIdentity(workspace: string, identity: GitIdentity, global: boolean): Promise<void> {
    return this.run(async () => {
      const scope = global ? '--global' : '--local'
      await this.must(workspace, ['config', scope, 'user.name', identity.name], '儲存 Git 使用者')
      await this.must(workspace, ['config', scope, 'user.email', identity.email], '儲存 Git 使用者')
    })
  }

  /** Paths of the chosen changes relative to the repository (renames: both paths). */
  private pick(
    repo: GitRepoStatus & { prefix: string },
    paths: readonly string[]
  ): GitFileChange[] {
    const byPath = new Map(repo.files.map((f) => [f.path, f]))
    return paths.map((p) => {
      const change = byPath.get(p)
      if (!change) throw new HachiError('VALIDATION_ERROR', `沒有這個變更：${p}（請重新整理）`)
      return change
    })
  }

  private repoPath(repo: { prefix: string }, p: string): string {
    return repo.prefix === '' ? p : `${repo.prefix}/${p}`
  }

  /** Commits the chosen files only (decision 112: no separate staging). */
  commit(workspace: string, paths: readonly string[], message: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (repo.merging) {
        throw new HachiError('INVALID_OPERATION', '合併進行中：解決衝突後請用「完成合併」')
      }
      const changes = this.pick(repo, paths)
      if (changes.some((c) => c.kind === 'conflicted')) {
        throw new HachiError('INVALID_OPERATION', '有衝突的檔案要先解決才能 commit')
      }
      const repoPaths = changes.flatMap((c) => [
        this.repoPath(repo, c.path),
        ...(c.oldPath !== undefined ? [this.repoPath(repo, c.oldPath)] : [])
      ])
      await this.must(repo.root, ['add', '-A', '--', ...repoPaths], 'Commit')
      // With paths, git commits exactly these (anything else already staged stays staged).
      await this.must(repo.root, ['commit', '-m', message, '--', ...repoPaths], 'Commit')
      return this.readStatus(workspace)
    })
  }

  /** Puts one file back as it is in the last commit (decision 112: per file, confirmed). */
  discard(workspace: string, file: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const [change] = this.pick(repo, [file])
      if (!change) throw new HachiError('VALIDATION_ERROR', '沒有這個變更')
      const abs = (p: string) => path.join(repo.root, ...this.repoPath(repo, p).split('/'))
      const restore = (p: string) =>
        this.must(
          repo.root,
          ['restore', '--source=HEAD', '--staged', '--worktree', '--', this.repoPath(repo, p)],
          '捨棄變更'
        )
      const unstage = (p: string) =>
        this.must(repo.root, ['rm', '--cached', '-q', '--', this.repoPath(repo, p)], '捨棄變更')
      switch (change.kind) {
        case 'untracked':
          await this.trash(abs(change.path))
          break
        case 'added':
          await unstage(change.path)
          await this.trash(abs(change.path))
          break
        case 'renamed':
          await unstage(change.path)
          await this.trash(abs(change.path))
          if (change.oldPath !== undefined) await restore(change.oldPath)
          break
        case 'conflicted':
          throw new HachiError('INVALID_OPERATION', '衝突的檔案請用合併工具處理')
        default:
          await restore(change.path)
      }
      return this.readStatus(workspace)
    })
  }

  /** One changed file in the last commit and on disk now. */
  diff(workspace: string, file: string): Promise<GitFileDiff> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const [change] = this.pick(repo, [file])
      if (!change) throw new HachiError('VALIDATION_ERROR', '沒有這個變更')
      const conflict = change.kind === 'conflicted'
      const result: GitFileDiff = {
        path: file,
        conflict,
        before: null,
        after: null,
        unavailable: null
      }
      const tooLarge = (bytes: number) => bytes > MAX_DIFF_BYTES
      /** A version stored by git (`HEAD:path`, or a merge stage `:2:path`); null if absent. */
      const blob = async (spec: string): Promise<string | null | 'tooLarge'> => {
        const size = await this.exec(repo.root, ['cat-file', '-s', spec])
        if (size.code !== 0) return null
        if (tooLarge(Number(size.stdout.trim()))) return 'tooLarge'
        return this.must(repo.root, ['show', spec], '讀取差異')
      }
      if (conflict) {
        // Stage 2 = ours (current branch), stage 3 = theirs (what is being merged in).
        const target = this.repoPath(repo, change.path)
        const [ours, theirs] = [await blob(`:2:${target}`), await blob(`:3:${target}`)]
        if (ours === 'tooLarge' || theirs === 'tooLarge')
          return { ...result, unavailable: 'tooLarge' }
        if ([ours, theirs].some((text) => text?.includes('\0'))) {
          return { ...result, unavailable: 'binary' }
        }
        return { ...result, before: ours, after: theirs }
      }
      if (change.kind !== 'untracked' && change.kind !== 'added' && !repo.empty) {
        const source = this.repoPath(repo, change.oldPath ?? change.path)
        const size = await this.exec(repo.root, ['cat-file', '-s', `HEAD:${source}`])
        if (size.code === 0) {
          if (tooLarge(Number(size.stdout.trim()))) return { ...result, unavailable: 'tooLarge' }
          result.before = await this.must(repo.root, ['show', `HEAD:${source}`], '讀取差異')
        }
      }
      if (change.kind !== 'deleted') {
        const abs = path.join(repo.root, ...this.repoPath(repo, change.path).split('/'))
        if (tooLarge((await stat(abs)).size)) return { ...result, unavailable: 'tooLarge' }
        result.after = await readFile(abs, 'utf8')
      }
      if ([result.before, result.after].some((text) => text?.includes('\0'))) {
        return { ...result, before: null, after: null, unavailable: 'binary' }
      }
      return result
    })
  }

  // ---- Remotes (decision 113) ------------------------------------------------

  private async remoteName(root: string): Promise<string | null> {
    const names = (await this.exec(root, ['remote'])).stdout.split('\n').filter(Boolean)
    return names.includes('origin') ? 'origin' : (names[0] ?? null)
  }

  /** The remote push / pull use (origin, or the only one), or null. */
  remote(workspace: string): Promise<GitRemote | null> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const name = await this.remoteName(repo.root)
      if (!name) return null
      const url = (await this.exec(repo.root, ['remote', 'get-url', name])).stdout.trim()
      return { name, url }
    })
  }

  /** Sets the URL of origin (added when missing). */
  setRemote(workspace: string, url: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (url.startsWith('-') || /\s/.test(url)) {
        throw new HachiError('VALIDATION_ERROR', '遠端網址不合法')
      }
      const exists = (await this.exec(repo.root, ['remote'])).stdout.split('\n').includes('origin')
      await this.must(
        repo.root,
        exists ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url],
        '設定遠端'
      )
      return this.readStatus(workspace)
    })
  }

  fetch(workspace: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (!repo.hasRemote) throw new HachiError('INVALID_OPERATION', '還沒有設定遠端')
      await this.must(repo.root, ['fetch', '--all', '--prune'], 'Fetch', true)
      return this.readStatus(workspace)
    })
  }

  /** Pull with merge (decision 113). Conflicts are not an error: the status shows them. */
  pull(workspace: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (repo.merging) throw new HachiError('INVALID_OPERATION', '還有沒完成的合併')
      if (!repo.upstream) {
        throw new HachiError(
          'INVALID_OPERATION',
          '目前的分支沒有追蹤遠端分支：先 Push 一次（會自動設定）'
        )
      }
      const result = await this.exec(
        repo.root,
        ['-c', 'pull.rebase=false', 'pull', '--no-edit'],
        true
      )
      const after = await this.readStatus(workspace)
      if (result.code !== 0 && !(after.state === 'repo' && after.merging)) {
        throw new HachiError('IO_ERROR', `Pull 失敗：${gitMessage(result)}`)
      }
      return after
    })
  }

  /** Push; the first push of a branch sets its upstream (push -u). */
  push(workspace: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const remote = await this.remoteName(repo.root)
      if (!remote) throw new HachiError('INVALID_OPERATION', '還沒有設定遠端')
      if (repo.empty) throw new HachiError('INVALID_OPERATION', '還沒有任何 commit')
      if (!repo.branch) throw new HachiError('INVALID_OPERATION', '目前不在任何分支上')
      const result = await this.exec(
        repo.root,
        repo.upstream ? ['push'] : ['push', '-u', remote, 'HEAD'],
        true
      )
      if (result.code !== 0) {
        const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(result.stderr)
        throw new HachiError(
          'IO_ERROR',
          rejected
            ? 'Push 被拒絕：遠端有新的 commit，請先 Pull'
            : `Push 失敗：${gitMessage(result)}`
        )
      }
      return this.readStatus(workspace)
    })
  }

  // ---- Conflicts (decision 114) ----------------------------------------------

  /** Settles one conflicted file: keep ours / theirs, or mark it resolved after editing. */
  resolve(workspace: string, file: string, how: GitResolution): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const [change] = this.pick(repo, [file])
      if (change?.kind !== 'conflicted')
        throw new HachiError('VALIDATION_ERROR', '這個檔案沒有衝突')
      const target = this.repoPath(repo, file)
      const abs = path.join(repo.root, ...target.split('/'))
      if (how === 'resolved') {
        const text = await readFile(abs, 'utf8').catch(() => null)
        if (text !== null && /^(<{7}|>{7})( |$)/m.test(text)) {
          throw new HachiError('VALIDATION_ERROR', '檔案中還有衝突標記（<<<<<<< / >>>>>>>）')
        }
        await this.must(
          repo.root,
          text === null ? ['rm', '-q', '--', target] : ['add', '--', target],
          '標記已解決'
        )
      } else {
        const side = how === 'ours' ? '--ours' : '--theirs'
        const checkout = await this.exec(repo.root, ['checkout', side, '--', target])
        // That side deleted the file: keeping it means deleting it.
        await this.must(
          repo.root,
          checkout.code === 0 ? ['add', '--', target] : ['rm', '-q', '--', target],
          '解決衝突'
        )
      }
      return this.readStatus(workspace)
    })
  }

  abortMerge(workspace: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      await this.must(repo.root, ['merge', '--abort'], '放棄合併')
      return this.readStatus(workspace)
    })
  }

  /** The merge commit, once every conflict is settled (git's default message). */
  finishMerge(workspace: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (!repo.merging) throw new HachiError('INVALID_OPERATION', '目前沒有進行中的合併')
      if (repo.files.some((f) => f.kind === 'conflicted')) {
        throw new HachiError('INVALID_OPERATION', '還有衝突的檔案沒有解決')
      }
      await this.must(repo.root, ['commit', '--no-edit'], '完成合併')
      return this.readStatus(workspace)
    })
  }

  /** Absolute path of a changed file (to open it in another editor). */
  filePath(workspace: string, file: string): Promise<string> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      this.pick(repo, [file])
      return path.join(repo.root, ...this.repoPath(repo, file).split('/'))
    })
  }

  // ---- History (decision 116) ------------------------------------------------

  /** Commits of every branch, newest first (date order: children before parents). */
  log(workspace: string, skip: number): Promise<GitLog> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (repo.empty) return { commits: [], more: false }
      const out = await this.must(
        repo.root,
        [
          'log',
          '--decorate=full',
          '--date-order',
          `--skip=${skip}`,
          '-n',
          String(LOG_PAGE + 1),
          `--format=${LOG_FORMAT}`,
          '--exclude=refs/stash',
          '--all'
        ],
        '讀取歷史'
      )
      const commits = parseLog(out)
      return { commits: commits.slice(0, LOG_PAGE), more: commits.length > LOG_PAGE }
    })
  }

  private async commitFiles(
    repo: GitRepoStatus & { prefix: string },
    hash: string,
    parent: string | undefined
  ): Promise<GitCommitFile[]> {
    const out = await this.must(
      repo.root,
      parent
        ? ['diff', '--name-status', '-z', '-M', parent, hash]
        : ['diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '-z', '-M', hash],
      '讀取 commit'
    )
    const inside = (p: string) => repo.prefix === '' || p.startsWith(`${repo.prefix}/`)
    // Workspace files first, then the rest of the repository.
    return parseNameStatus(out)
      .map((f) => ({
        ...f,
        inWorkspace: inside(f.repoPath),
        path:
          inside(f.repoPath) && repo.prefix !== ''
            ? f.repoPath.slice(repo.prefix.length + 1)
            : f.repoPath
      }))
      .sort((a, b) => Number(b.inWorkspace) - Number(a.inWorkspace) || a.path.localeCompare(b.path))
  }

  /** One commit: whole message and the files it changed (against its first parent). */
  commitDetail(workspace: string, hash: string): Promise<GitCommitDetail> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (!isHash(hash)) throw new HachiError('VALIDATION_ERROR', '不是 commit id')
      const out = await this.must(
        repo.root,
        ['show', '-s', '--decorate=full', `--format=${LOG_FORMAT}%B`, hash],
        '讀取 commit'
      )
      const end = out.indexOf('\x1e')
      const [summary] = parseLog(out.slice(0, end + 1))
      if (!summary) throw new HachiError('NOT_FOUND', '找不到這個 commit')
      return {
        ...summary,
        message: out.slice(end + 1).trim(),
        files: await this.commitFiles(repo, summary.hash, summary.parents[0])
      }
    })
  }

  /** A file of a commit: before (first parent) and after (the commit). */
  commitDiff(workspace: string, hash: string, repoPath: string): Promise<GitFileDiff> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      if (!isHash(hash)) throw new HachiError('VALIDATION_ERROR', '不是 commit id')
      const parents = (await this.must(repo.root, ['rev-parse', `${hash}^@`], '讀取 commit'))
        .split('\n')
        .filter(Boolean)
      const file = (await this.commitFiles(repo, hash, parents[0])).find(
        (f) => f.repoPath === repoPath
      )
      if (!file) throw new HachiError('VALIDATION_ERROR', '這個 commit 沒有改到這個檔案')
      const result: GitFileDiff = {
        path: file.path,
        conflict: false,
        before: null,
        after: null,
        unavailable: null
      }
      const blob = async (spec: string): Promise<string | null | 'tooLarge'> => {
        const size = await this.exec(repo.root, ['cat-file', '-s', spec])
        if (size.code !== 0) return null
        if (Number(size.stdout.trim()) > MAX_DIFF_BYTES) return 'tooLarge'
        return this.must(repo.root, ['show', spec], '讀取差異')
      }
      const before =
        parents[0] && file.kind !== 'added'
          ? await blob(`${parents[0]}:${file.oldRepoPath ?? file.repoPath}`)
          : null
      const after = file.kind === 'deleted' ? null : await blob(`${hash}:${file.repoPath}`)
      if (before === 'tooLarge' || after === 'tooLarge')
        return { ...result, unavailable: 'tooLarge' }
      if ([before, after].some((text) => text?.includes('\0'))) {
        return { ...result, unavailable: 'binary' }
      }
      return { ...result, before, after }
    })
  }

  branches(workspace: string): Promise<GitBranch[]> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const out = await this.must(
        repo.root,
        [
          'for-each-ref',
          '--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(HEAD)',
          'refs/heads',
          'refs/remotes'
        ],
        '讀取分支'
      )
      return parseBranches(out)
    })
  }

  /** Switches branch; a remote branch gets a local tracking branch of the same name. */
  switchBranch(workspace: string, name: string, remote: boolean): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const branches = parseBranches(
        await this.must(
          repo.root,
          [
            'for-each-ref',
            '--format=%(refname)%00%(refname:short)%00%00',
            'refs/heads',
            'refs/remotes'
          ],
          '讀取分支'
        )
      )
      if (!branches.some((b) => b.name === name && b.remote === remote)) {
        throw new HachiError('NOT_FOUND', `找不到分支「${name}」`)
      }
      if (!remote) {
        await this.must(repo.root, ['switch', name], '切換分支')
      } else {
        const local = name.slice(name.indexOf('/') + 1)
        if (branches.some((b) => !b.remote && b.name === local)) {
          await this.must(repo.root, ['switch', local], '切換分支')
        } else {
          await this.must(repo.root, ['switch', '-c', local, '--track', name], '切換分支')
        }
      }
      return this.readStatus(workspace)
    })
  }

  /** Creates a branch from the current position and switches to it. */
  createBranch(workspace: string, name: string): Promise<GitStatus> {
    return this.run(async () => {
      const repo = await this.requireRepo(workspace)
      const check = await this.exec(repo.root, ['check-ref-format', '--branch', name])
      if (check.code !== 0) throw new HachiError('VALIDATION_ERROR', `分支名稱不合法：${name}`)
      await this.must(repo.root, ['switch', '-c', name], '建立分支')
      return this.readStatus(workspace)
    })
  }
}
