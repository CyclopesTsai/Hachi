import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitRepoStatus } from '@shared/git'
import { GitService } from './git-service'
import { parseBranches, parseStatus } from './parse'

describe('parseStatus / parseBranches', () => {
  it('reads porcelain v2 with branch headers, renames, conflicts and untracked files', () => {
    const out = [
      '# branch.oid 0123456789abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a a ws/edit me.json',
      '1 A. N... 000000 100644 100644 0 a ws/new.json',
      '1 .D N... 100644 100644 000000 a a ws/gone.json',
      '2 R. N... 100644 100644 100644 a a R100 ws/to.json',
      'ws/from.json',
      'u UU N... 100644 100644 100644 100644 a b c ws/both.json',
      '? ws/untracked.json',
      ''
    ].join('\0')
    expect(parseStatus(out)).toEqual({
      branch: 'main',
      oid: '0123456789abcdef',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      files: [
        { path: 'ws/edit me.json', kind: 'modified' },
        { path: 'ws/new.json', kind: 'added' },
        { path: 'ws/gone.json', kind: 'deleted' },
        { path: 'ws/to.json', kind: 'renamed', oldPath: 'ws/from.json' },
        { path: 'ws/both.json', kind: 'conflicted' },
        { path: 'ws/untracked.json', kind: 'untracked' }
      ]
    })
    expect(parseStatus('# branch.oid (initial)\0# branch.head (detached)\0')).toMatchObject({
      oid: null,
      branch: null
    })
  })

  it('lists local and remote branches, skipping origin/HEAD', () => {
    const out = [
      'refs/heads/main\0main\0origin/main\0*',
      'refs/heads/dev\0dev\0\0 ',
      'refs/remotes/origin/HEAD\0origin\0\0 ',
      'refs/remotes/origin/main\0origin/main\0\0 '
    ].join('\n')
    expect(parseBranches(out)).toEqual([
      { name: 'main', remote: false, current: true, upstream: 'origin/main' },
      { name: 'dev', remote: false, current: false, upstream: null },
      { name: 'origin/main', remote: true, current: false, upstream: null }
    ])
  })
})

const locator = { gitCandidates: () => [], gitUsable: async () => true }
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim()

describe('GitService', () => {
  let tmp: string
  let repo: string
  let ws: string
  let trashed: string[]
  let service: GitService

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'hachi-git-'))
    repo = path.join(tmp, 'project')
    // The Workspace is a folder inside the repository (decision 111).
    ws = path.join(repo, 'api')
    await mkdir(path.join(ws, 'collections'), { recursive: true })
    trashed = []
    service = new GitService(locator, async (p) => {
      trashed.push(p)
      await rm(p)
    })
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  const repoStatus = async () => (await service.status(ws)) as GitRepoStatus

  it('reports a folder outside any repository, then git init', async () => {
    expect(await service.status(ws)).toEqual({ state: 'not-repo' })
    const status = (await service.init(ws)) as GitRepoStatus
    expect(status).toMatchObject({ state: 'repo', branch: 'main', empty: true, head: null })
  })

  it('commits only the chosen files of the Workspace, with paths inside it', async () => {
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Tester')
    git(repo, 'config', 'user.email', 'tester@example.com')
    await writeFile(path.join(repo, 'README.md'), 'outside the Workspace\n')
    await writeFile(path.join(ws, 'workspace.json'), '{}\n')
    await writeFile(path.join(ws, 'collections', 'a.json'), '{"a":1}\n')
    await writeFile(path.join(ws, 'collections', 'b.json'), '{"b":1}\n')

    const before = await repoStatus()
    expect(before.files.map((f) => [f.path, f.kind])).toEqual([
      ['collections/a.json', 'untracked'],
      ['collections/b.json', 'untracked'],
      ['workspace.json', 'untracked']
    ])
    expect(await service.identity(ws)).toEqual({ name: 'Tester', email: 'tester@example.com' })

    const after = (await service.commit(
      ws,
      ['collections/a.json', 'workspace.json'],
      '新增 a'
    )) as GitRepoStatus
    expect(after.files.map((f) => f.path)).toEqual(['collections/b.json'])
    expect(after.empty).toBe(false)
    expect(git(repo, 'log', '--format=%s')).toBe('新增 a')
    expect(git(repo, 'show', '--name-only', '--format=')).toBe(
      'api/collections/a.json\napi/workspace.json'
    )

    await expect(service.commit(ws, ['../README.md'], 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
  })

  it('discards changes per file: restore tracked files, trash new ones', async () => {
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Tester')
    git(repo, 'config', 'user.email', 'tester@example.com')
    const a = path.join(ws, 'collections', 'a.json')
    await writeFile(a, 'v1\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'init')
    await writeFile(a, 'v2\n')
    await writeFile(path.join(ws, 'collections', 'new.json'), 'new\n')

    expect((await repoStatus()).files.map((f) => [f.path, f.kind])).toEqual([
      ['collections/a.json', 'modified'],
      ['collections/new.json', 'untracked']
    ])
    await service.discard(ws, 'collections/a.json')
    expect(await readFile(a, 'utf8')).toBe('v1\n')
    const left = (await service.discard(ws, 'collections/new.json')) as GitRepoStatus
    // The real path (macOS temp folders are behind a /private symlink).
    expect(trashed).toHaveLength(1)
    expect(trashed[0]?.endsWith(path.join('api', 'collections', 'new.json'))).toBe(true)
    expect(left.files).toEqual([])
  })

  it('compares a changed file with the last commit', async () => {
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Tester')
    git(repo, 'config', 'user.email', 'tester@example.com')
    await writeFile(path.join(ws, 'collections', 'a.json'), 'v1\n')
    await writeFile(path.join(ws, 'collections', 'gone.json'), 'old\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'init')
    await writeFile(path.join(ws, 'collections', 'a.json'), 'v2\n')
    await rm(path.join(ws, 'collections', 'gone.json'))
    await writeFile(path.join(ws, 'collections', 'new.json'), 'new\n')

    expect(await service.diff(ws, 'collections/a.json')).toEqual({
      path: 'collections/a.json',
      before: 'v1\n',
      after: 'v2\n',
      unavailable: null
    })
    expect(await service.diff(ws, 'collections/gone.json')).toMatchObject({
      before: 'old\n',
      after: null
    })
    expect(await service.diff(ws, 'collections/new.json')).toMatchObject({
      before: null,
      after: 'new\n'
    })
    await writeFile(path.join(ws, 'collections', 'bin.dat'), Buffer.from([0, 1, 2]))
    expect((await service.diff(ws, 'collections/bin.dat')).unavailable).toBe('binary')
  })

  it('creates, lists and switches branches', async () => {
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Tester')
    git(repo, 'config', 'user.email', 'tester@example.com')
    await writeFile(path.join(ws, 'workspace.json'), '{}\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'init')

    expect(((await service.createBranch(ws, 'feature/x')) as GitRepoStatus).branch).toBe(
      'feature/x'
    )
    await expect(service.createBranch(ws, 'bad name')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    expect((await service.branches(ws)).map((b) => [b.name, b.current])).toEqual([
      ['feature/x', true],
      ['main', false]
    ])
    expect(((await service.switchBranch(ws, 'main', false)) as GitRepoStatus).branch).toBe('main')
    await expect(service.switchBranch(ws, 'nope', false)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('reports when git is not installed', async () => {
    const missing = new GitService(
      { gitCandidates: () => [], gitUsable: async () => false },
      async () => undefined
    )
    expect(await missing.status(ws)).toEqual({ state: 'no-git' })
  })

  it('fetches, pulls (merge), pushes, and settles conflicts file by file', async () => {
    const remote = path.join(tmp, 'remote.git')
    const other = path.join(tmp, 'other')
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote)
    git(repo, 'init', '-q', '-b', 'main')
    for (const dir of [repo]) {
      git(dir, 'config', 'user.name', 'Tester')
      git(dir, 'config', 'user.email', 'tester@example.com')
    }
    const file = path.join(ws, 'collections', 'a.json')
    await writeFile(file, 'line 1\nline 2\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'init')

    await expect(service.push(ws)).rejects.toThrow(/還沒有設定遠端/)
    expect((await service.setRemote(ws, remote)) as GitRepoStatus).toMatchObject({
      hasRemote: true
    })
    await expect(service.setRemote(ws, '--upload-pack=x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    expect(await service.remote(ws)).toEqual({ name: 'origin', url: remote })
    // First push sets the upstream.
    expect((await service.push(ws)) as GitRepoStatus).toMatchObject({
      upstream: 'origin/main',
      ahead: 0
    })

    // Someone else pushes a change.
    git(tmp, 'clone', '-q', remote, other)
    git(other, 'config', 'user.name', 'Other')
    git(other, 'config', 'user.email', 'other@example.com')
    await writeFile(path.join(other, 'api', 'collections', 'a.json'), 'line 1 (theirs)\nline 2\n')
    git(other, 'commit', '-q', '-am', 'theirs')
    git(other, 'push', '-q')

    expect(((await service.fetch(ws)) as GitRepoStatus).behind).toBe(1)
    // Our own change to the same line, then pull: a conflict, not an error.
    await writeFile(file, 'line 1 (ours)\nline 2\n')
    git(repo, 'commit', '-q', '-am', 'ours')
    await expect(service.push(ws)).rejects.toThrow(/請先 Pull/)
    const merging = (await service.pull(ws)) as GitRepoStatus
    expect(merging.merging).toBe(true)
    expect(merging.files).toEqual([{ path: 'collections/a.json', kind: 'conflicted' }])
    await expect(service.commit(ws, ['collections/a.json'], 'x')).rejects.toThrow(/完成合併/)
    await expect(service.resolve(ws, 'collections/a.json', 'resolved')).rejects.toThrow(/衝突標記/)
    await expect(service.finishMerge(ws)).rejects.toThrow(/還有衝突/)

    const settled = (await service.resolve(ws, 'collections/a.json', 'theirs')) as GitRepoStatus
    expect(settled.files.map((f) => f.kind)).toEqual(['modified'])
    expect(await readFile(file, 'utf8')).toBe('line 1 (theirs)\nline 2\n')
    const done = (await service.finishMerge(ws)) as GitRepoStatus
    expect(done).toMatchObject({ merging: false, files: [], ahead: 2, behind: 0 })
    expect(((await service.push(ws)) as GitRepoStatus).ahead).toBe(0)
  })

  it('aborts a merge', async () => {
    const remote = path.join(tmp, 'remote.git')
    const other = path.join(tmp, 'other')
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Tester')
    git(repo, 'config', 'user.email', 'tester@example.com')
    const file = path.join(ws, 'a.txt')
    await writeFile(file, 'base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'init')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(tmp, 'clone', '-q', remote, other)
    git(other, 'config', 'user.name', 'Other')
    git(other, 'config', 'user.email', 'other@example.com')
    await writeFile(path.join(other, 'api', 'a.txt'), 'theirs\n')
    git(other, 'commit', '-q', '-am', 'theirs')
    git(other, 'push', '-q')
    await writeFile(file, 'ours\n')
    git(repo, 'commit', '-q', '-am', 'ours')

    expect(((await service.pull(ws)) as GitRepoStatus).merging).toBe(true)
    const aborted = (await service.abortMerge(ws)) as GitRepoStatus
    expect(aborted).toMatchObject({ merging: false, files: [] })
    expect(await readFile(file, 'utf8')).toBe('ours\n')
  })
})
