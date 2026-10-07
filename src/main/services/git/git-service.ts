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
  GitFileChange,
  GitFileDiff,
  GitIdentity,
  GitRepoStatus,
  GitStatus
} from '@shared/git'
import { findGit, runGit, type GitLocator, type GitResult } from './git-exec'
import { parseBranches, parseStatus } from './parse'

/** Larger files are not compared (decision 119). */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024

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
    private readonly trash: TrashFile
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

  private async exec(cwd: string, args: string[]): Promise<GitResult> {
    const git = await this.findGit()
    if (!git) throw new HachiError('NOT_FOUND', '找不到 git，請先安裝')
    return runGit(git, ['-c', 'core.quotepath=false', ...args], { cwd })
  }

  /** Runs git; a failure becomes an error with git's own message. */
  private async must(cwd: string, args: string[], what: string): Promise<string> {
    const result = await this.exec(cwd, args)
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
      empty: parsed.oid === null
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
      const result: GitFileDiff = { path: file, before: null, after: null, unavailable: null }
      const tooLarge = (bytes: number) => bytes > MAX_DIFF_BYTES
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
        return { path: file, before: null, after: null, unavailable: 'binary' }
      }
      return result
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
