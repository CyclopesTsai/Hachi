import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { findVariableTokens } from '@shared/variables'
import { cn } from '@renderer/lib/utils'
import {
  VARIABLE_CLASS,
  describeVariable,
  useVariables,
  variablesTitle
} from '@renderer/lib/variables'

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
 * editing, selection and IME behave like a normal input. Hover shows the values.
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
        title={title ?? variablesTitle(value, map)}
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
