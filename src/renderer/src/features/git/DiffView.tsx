import { MergeView } from '@codemirror/merge'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type { GitFileDiff } from '@shared/git'
import { editorTheme, highlightStyle, languageExtension } from '@renderer/components/code-theme'

/** Diff colors from the app's tokens (--diff-*), for light and dark mode. */
const diffTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, & .cm-deletedChunk': {
    backgroundColor: 'var(--diff-deleted)'
  },
  '&.cm-merge-b .cm-changedLine, & .cm-insertedLine': {
    backgroundColor: 'var(--diff-inserted)'
  },
  '&.cm-merge-a .cm-changedText, & .cm-deletedChunk .cm-deletedText': {
    background: 'var(--diff-deleted-text)'
  },
  '&.cm-merge-b .cm-changedText': { background: 'var(--diff-inserted-text)' },
  '& .cm-collapsedLines': {
    background: 'var(--muted)',
    color: 'var(--muted-foreground)'
  }
})

/**
 * Side by side, read-only: the last commit (left) and the file now (right); for a
 * conflict, our version (left) and theirs (right), without conflict markers.
 */
export function DiffView({
  diff,
  labels
}: {
  diff: GitFileDiff
  /** Titles of the two sides (History: previous commit / this commit). */
  labels?: [string, string]
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current || diff.unavailable) return
    const extensions = [
      lineNumbers(),
      editorTheme,
      diffTheme,
      syntaxHighlighting(highlightStyle, { fallback: true }),
      languageExtension(diff.path.endsWith('.json') ? 'json' : 'text'),
      EditorState.readOnly.of(true),
      EditorView.editable.of(true)
    ]
    const view = new MergeView({
      a: { doc: diff.before ?? '', extensions },
      b: { doc: diff.after ?? '', extensions },
      parent: host.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      gutter: true
    })
    return () => view.destroy()
  }, [diff])

  if (diff.unavailable) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {diff.unavailable === 'tooLarge'
          ? '檔案超過 2 MB，不顯示差異。'
          : '不是文字檔，不顯示差異。'}
      </p>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="git-diff">
      <div className="grid shrink-0 grid-cols-2 border-b text-xs text-muted-foreground">
        <span className="px-3 py-1.5">
          {labels
            ? `${labels[0]}${diff.before === null ? '（沒有這個檔案）' : ''}`
            : diff.conflict
              ? diff.before === null
                ? '我的（目前分支：已刪除）'
                : '我的（目前分支）'
              : diff.before === null
                ? '最後一次 commit（沒有這個檔案）'
                : '最後一次 commit'}
        </span>
        <span className="border-l px-3 py-1.5">
          {labels
            ? `${labels[1]}${diff.after === null ? '（已刪除）' : ''}`
            : diff.conflict
              ? diff.after === null
                ? '遠端（theirs：已刪除）'
                : '遠端（theirs）'
              : diff.after === null
                ? '目前（已刪除）'
                : '目前'}
        </span>
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-auto [&_.cm-mergeView]:min-h-full" />
    </div>
  )
}
