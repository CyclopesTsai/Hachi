import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { findVariableTokens } from '@shared/variables'
import { cn } from '@renderer/lib/utils'
import { attachVariableHover } from '@renderer/lib/variable-hover'
import { VARIABLE_CLASS, describeVariable, useVariables } from '@renderer/lib/variables'

export interface VariableInputProps extends Omit<ComponentProps<'input'>, 'className' | 'value'> {
  value: string
  /** Box styles (border, background, height…). */
  className?: string
  /** Text metrics shared by the field and its highlight layer (padding, font). */
  textClassName?: string
  /** Dims the text (e.g. a disabled row). */
  muted?: boolean
}

/**
 * Single-line input that colours `{{variables}}`: green = defined, blue = dynamic,
 * red = not found. The text is drawn by a layer behind a transparent <input>, so
 * editing, selection and IME behave like a normal input. Hovering a variable shows its
 * value, editable in place (variable-hover.ts).
 */
export function VariableInput({
  value,
  className,
  textClassName,
  muted,
  onScroll,
  title,
  ...props
}: VariableInputProps) {
  const map = useVariables()
  const input = useRef<HTMLInputElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const tokens = findVariableTokens(value)
  const mapRef = useRef(map)
  useEffect(() => {
    mapRef.current = map
  })
  // Hovering a variable shows (and edits) its value (decision 135).
  useEffect(() => {
    const el = input.current
    if (!el) return
    return attachVariableHover(el, {
      map: () => mapRef.current,
      tokenAt: (e) => {
        for (const span of layer.current?.querySelectorAll<HTMLElement>('[data-name]') ?? []) {
          const rect = span.getBoundingClientRect()
          if (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top - 2 &&
            e.clientY <= rect.bottom + 2
          ) {
            return { name: span.dataset.name as string, rect }
          }
        }
        return null
      }
    })
  }, [])

  const sync = () => {
    if (layer.current && input.current) layer.current.scrollLeft = input.current.scrollLeft
  }
  useLayoutEffect(sync)

  const parts: ReactNode[] = []
  let at = 0
  for (const token of tokens) {
    if (token.from > at) parts.push(value.slice(at, token.from))
    const status = describeVariable(token.name, map).status
    parts.push(
      <span
        key={token.from}
        className={cn('rounded-sm', VARIABLE_CLASS[status])}
        data-variable={status}
        data-name={token.name}
      >
        {value.slice(token.from, token.to)}
      </span>
    )
    at = token.to
  }
  parts.push(value.slice(at))

  return (
    <div className={cn('relative flex min-w-0 items-stretch', className)}>
      <div
        ref={layer}
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre',
          textClassName,
          muted && 'text-muted-foreground'
        )}
      >
        {/* Trailing space keeps the layer scrollable as far as the input. */}
        <span>{parts} </span>
      </div>
      <input
        ref={input}
        value={value}
        spellCheck={false}
        title={title}
        className={cn(
          'relative w-full min-w-0 bg-transparent text-transparent caret-foreground outline-none',
          'placeholder:text-muted-foreground/60 selection:bg-primary/25 selection:text-transparent',
          textClassName
        )}
        onScroll={(e) => {
          sync()
          onScroll?.(e)
        }}
        onSelect={sync}
        onKeyUp={sync}
        {...props}
      />
    </div>
  )
}
