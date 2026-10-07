import { RefreshCw, Tag } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import type { GitCommitFile, GitCommitSummary, GitRef } from '@shared/git'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useGitStore } from '@renderer/stores/git-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { DiffView } from './DiffView'
import { fileIndex, labelFor } from './git-names'
import { layoutGraph, type GraphRow } from './graph'

const ROW_HEIGHT = 28
const COLUMN_WIDTH = 14
const lane = (color: number) => `var(--git-lane-${(color % 6) + 1})`
const x = (column: number) => column * COLUMN_WIDTH + COLUMN_WIDTH / 2

/** One row of the branch graph (decision 116). */
function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const mid = ROW_HEIGHT / 2
  return (
    <svg
      width={width * COLUMN_WIDTH}
      height={ROW_HEIGHT}
      className="shrink-0 overflow-visible"
      aria-hidden
    >
      {row.segments.map((s, i) => {
        const [x1, y1, x2, y2] =
          s.kind === 'pass'
            ? [x(s.from), 0, x(s.to), ROW_HEIGHT]
            : s.kind === 'in'
              ? [x(s.from), 0, x(s.to), mid]
              : [x(s.from), mid, x(s.to), ROW_HEIGHT]
        // Bends are drawn as curves, straight lines as lines.
        const d =
          x1 === x2
            ? `M${x1} ${y1}L${x2} ${y2}`
            : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
        return <path key={i} d={d} fill="none" stroke={lane(s.color)} strokeWidth={2} />
      })}
      <circle
        cx={x(row.column)}
        cy={mid}
        r={row.merge ? 3 : 4}
        fill={row.merge ? 'var(--background)' : lane(row.color)}
        stroke={lane(row.color)}
        strokeWidth={2}
      />
    </svg>
  )
}

function RefChip({ gitRef }: { gitRef: GitRef }) {
  if (gitRef.kind === 'head') return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[10px] leading-4',
        gitRef.kind === 'branch' && 'border-primary/50 bg-primary/10 text-foreground',
        gitRef.kind === 'remote' && 'border-border text-muted-foreground',
        gitRef.kind === 'tag' && 'border-amber-500/50 bg-amber-500/10'
      )}
      data-testid="git-ref"
    >
      {gitRef.kind === 'tag' && <Tag className="size-2.5" />}
      {gitRef.name}
    </span>
  )
}

const formatDate = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CommitRow({
  commit,
  row,
  width,
  selected
}: {
  commit: GitCommitSummary
  row: GraphRow
  width: number
  selected: boolean
}) {
  const head = commit.refs.some((r) => r.kind === 'head')
  return (
    <li
      className={cn(
        'flex cursor-default items-center gap-2 pr-3 pl-2 text-sm hover:bg-accent/70',
        selected && 'bg-accent'
      )}
      style={{ height: ROW_HEIGHT }}
      aria-selected={selected}
      data-testid="git-commit-row"
      onClick={() => void useGitStore.getState().selectCommit(commit.hash)}
    >
      <GraphCell row={row} width={width} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {commit.refs.map((r) => (
          <RefChip key={`${r.kind}:${r.name}`} gitRef={r} />
        ))}
        <span className={cn('truncate', head && 'font-medium')}>{commit.subject}</span>
      </div>
      <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{commit.author}</span>
      <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatDate(commit.date)}
      </span>
    </li>
  )
}

const KIND_LETTERS: Record<GitCommitFile['kind'], [string, string]> = {
  added: ['A', 'text-emerald-600 dark:text-emerald-400'],
  modified: ['M', 'text-amber-600 dark:text-amber-400'],
  deleted: ['D', 'text-red-600 dark:text-red-400'],
  renamed: ['R', 'text-sky-600 dark:text-sky-400']
}

function CommitDetail() {
  const detail = useGitStore((s) => s.commitDetail)
  const commitFile = useGitStore((s) => s.commitFile)
  const commitDiff = useGitStore((s) => s.commitDiff)
  const tree = useTreeStore((s) => s.tree)
  const index = useMemo(() => fileIndex(tree), [tree])
  if (!detail) {
    return <p className="m-auto text-sm text-muted-foreground">選擇左側的 commit 查看內容</p>
  }
  const [subject, ...body] = detail.message.split('\n')
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="git-commit-detail">
      <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-auto border-b p-3">
        <p className="font-medium break-words">{subject}</p>
        {body.join('\n').trim() !== '' && (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {body.join('\n').trim()}
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">作者</dt>
          <dd className="truncate">
            {detail.author} &lt;{detail.email}&gt;
          </dd>
          <dt className="text-muted-foreground">時間</dt>
          <dd>{formatDate(detail.date)}</dd>
          <dt className="text-muted-foreground">Commit</dt>
          <dd className="font-mono select-text">{detail.hash}</dd>
          {detail.parents.length > 0 && (
            <>
              <dt className="text-muted-foreground">
                {detail.parents.length > 1 ? '合併自' : '上一個'}
              </dt>
              <dd className="flex flex-wrap gap-2 font-mono">
                {detail.parents.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => void useGitStore.getState().selectCommit(p)}
                  >
                    {p.slice(0, 7)}
                  </button>
                ))}
              </dd>
            </>
          )}
        </dl>
        {detail.refs.some((r) => r.kind !== 'head') && (
          <div className="flex flex-wrap gap-1">
            {detail.refs.map((r) => (
              <RefChip key={`${r.kind}:${r.name}`} gitRef={r} />
            ))}
          </div>
        )}
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          改了 {detail.files.length} 個檔案
          {detail.parents.length > 1 ? '（相對於第一個上一個 commit）' : ''}
        </p>
        <ul className="flex flex-col">
          {detail.files.map((f) => {
            const [letter, className] = KIND_LETTERS[f.kind]
            const title = f.inWorkspace ? labelFor(index, f.path).title : f.path
            return (
              <li key={f.repoPath}>
                <button
                  type="button"
                  className={cn(
                    'flex h-6 w-full items-center gap-1.5 rounded-sm px-1 text-left text-sm hover:bg-accent/70',
                    commitFile === f.repoPath && 'bg-accent',
                    !f.inWorkspace && 'text-muted-foreground'
                  )}
                  title={f.oldRepoPath ? `${f.oldRepoPath} → ${f.repoPath}` : f.repoPath}
                  data-testid="git-commit-file"
                  onClick={() => void useGitStore.getState().selectCommitFile(f.repoPath)}
                >
                  <span
                    className={cn('w-3 shrink-0 font-mono text-[11px] font-semibold', className)}
                  >
                    {letter}
                  </span>
                  <span className="truncate">{title}</span>
                  {!f.inWorkspace && <span className="shrink-0 text-[11px]">（Workspace 外）</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {commitDiff ? (
        <DiffView diff={commitDiff} labels={['上一個 commit', '這個 commit']} />
      ) : (
        <p className="m-auto text-sm text-muted-foreground">
          {commitFile ? '讀取中…' : '選擇檔案查看這個 commit 改了什麼'}
        </p>
      )}
    </div>
  )
}

/** The History tab of the Git screen (decision 116). */
export function GitHistory() {
  const log = useGitStore((s) => s.log)
  const loading = useGitStore((s) => s.logLoading)
  const selected = useGitStore((s) => s.commitDetail?.hash ?? null)
  const rows = useMemo(() => layoutGraph(log?.commits ?? []), [log])
  const width = useMemo(() => Math.max(1, ...rows.map((r) => r.width)), [rows])

  useEffect(() => {
    if (!useGitStore.getState().log) void useGitStore.getState().loadLog(true)
  }, [])

  return (
    <div className="flex min-h-0 flex-1" data-testid="git-history">
      <section className="flex min-w-0 flex-[3] flex-col border-r">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
          <span>
            所有分支（{log?.commits.length ?? 0}
            {log?.more ? '+' : ''} 個 commit）
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className="hover:text-foreground"
            title="重新整理"
            aria-label="重新整理歷史"
            onClick={() => void useGitStore.getState().loadLog(true)}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        {log && log.commits.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">還沒有任何 commit。</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-auto py-1">
            {log?.commits.map((commit, i) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                row={rows[i] as GraphRow}
                width={width}
                selected={selected === commit.hash}
              />
            ))}
            {log?.more && (
              <li className="p-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => void useGitStore.getState().loadLog(false)}
                >
                  載入更多
                </Button>
              </li>
            )}
          </ul>
        )}
      </section>
      <section className="flex min-w-0 flex-[2] flex-col">
        <CommitDetail />
      </section>
    </div>
  )
}
