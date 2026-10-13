import { ChevronRight } from 'lucide-react'
import { memo, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import type { TreeExpansion } from './json-tree-expansion'

/** Children shown per object / array before 「再顯示」 (big arrays stay responsive). */
const TREE_PAGE = 100

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** `source[3]`, `user.name`, `["a b"]`: shown on hover and used by the tests. */
function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return parent ? `${parent}.${key}` : key
  return `${parent}[${JSON.stringify(key)}]`
}

function isContainer(value: Json): value is Json[] | { [key: string]: Json } {
  return value !== null && typeof value === 'object'
}

/**
 * Tree view of a JSON response (decision 136): objects and arrays open / close one by
 * one, all open at first. The root stays open (全部收合 leaves its keys visible).
 */
export function JsonTree({
  value,
  expansion,
  onToggle,
  wrap
}: {
  value: unknown
  expansion: TreeExpansion
  onToggle(path: string): void
  wrap: boolean
}) {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-auto rounded-md border bg-background py-1.5 font-mono text-xs leading-[1.55] select-text',
        wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
      )}
      data-testid="json-tree"
      role="tree"
      aria-label="JSON 樹狀檢視"
    >
      <Node
        value={value as Json}
        name={null}
        path=""
        depth={0}
        expansion={expansion}
        onToggle={onToggle}
        last
      />
    </div>
  )
}

interface NodeProps {
  value: Json
  /** Key in the parent object / index in the parent array; null for the root. */
  name: string | number | null
  path: string
  depth: number
  expansion: TreeExpansion
  onToggle(path: string): void
  last: boolean
}

const Node = memo(function Node({
  value,
  name,
  path,
  depth,
  expansion,
  onToggle,
  last
}: NodeProps) {
  const [shown, setShown] = useState(TREE_PAGE)
  const indent = { paddingLeft: `${depth * 16 + 8}px` }
  const label =
    name === null ? null : typeof name === 'number' ? (
      <span className="text-muted-foreground">{name}: </span>
    ) : (
      <span className="text-[var(--code-property)]">{JSON.stringify(name)}: </span>
    )
  const comma = last ? '' : ','

  if (!isContainer(value)) {
    return (
      <div role="treeitem" data-testid="json-node" data-path={path} style={indent}>
        <span className="inline-block w-4" />
        {label}
        <Scalar value={value} />
        {comma}
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries: [string | number, Json][] = isArray
    ? value.map((v, i) => [i, v])
    : Object.entries(value)
  const [open, close] = isArray ? ['[', ']'] : ['{', '}']
  const expanded =
    depth === 0 ||
    entries.length === 0 ||
    (expansion.base === 'expanded') !== expansion.toggled.has(path)
  const count = (
    <span className="text-muted-foreground">
      {' '}
      {isArray ? `${entries.length} 項` : `${entries.length} 個 key`}
    </span>
  )

  return (
    <div role="treeitem" aria-expanded={expanded} data-testid="json-node" data-path={path}>
      <div style={indent} className="group">
        {depth > 0 && entries.length > 0 ? (
          <button
            type="button"
            aria-label={expanded ? `收合 ${path}` : `展開 ${path}`}
            onClick={() => onToggle(path)}
            className="inline-flex w-4 items-center justify-center align-[-2px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="inline-block w-4" />
        )}
        {label}
        {expanded ? (
          <>
            {open}
            {entries.length === 0 && close + comma}
          </>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(path)}
            className="text-left hover:underline"
            tabIndex={-1}
          >
            {open}…{close}
            {count}
            {comma}
          </button>
        )}
      </div>
      {expanded && entries.length > 0 && (
        <div role="group">
          {entries.slice(0, shown).map(([key, child], i) => (
            <Node
              key={key}
              value={child}
              name={key}
              path={childPath(path, key)}
              depth={depth + 1}
              expansion={expansion}
              onToggle={onToggle}
              last={i === entries.length - 1}
            />
          ))}
          {entries.length > shown && (
            <div style={{ paddingLeft: `${(depth + 1) * 16 + 24}px` }}>
              <button
                type="button"
                className="font-sans text-primary hover:underline"
                onClick={() => setShown((n) => n + TREE_PAGE)}
              >
                再顯示 {Math.min(TREE_PAGE, entries.length - shown)} 項（共 {entries.length} 項）
              </button>
            </div>
          )}
          <div style={indent}>
            <span className="inline-block w-4" />
            {close}
            {comma}
          </div>
        </div>
      )}
    </div>
  )
})

function Scalar({ value }: { value: null | boolean | number | string }) {
  if (typeof value === 'string') {
    return <span className="text-[var(--code-string)]">{JSON.stringify(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="text-[var(--code-number)]">{String(value)}</span>
  }
  return <span className="text-[var(--code-atom)]">{String(value)}</span>
}
