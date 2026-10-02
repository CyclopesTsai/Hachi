import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/** Styled native <select>: accessible and keyboard-friendly on every platform. */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30',
        className
      )}
      {...props}
    />
  )
}

export function CheckboxLabel({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { children: React.ReactNode }) {
  return (
    <label
      className={cn(
        'inline-flex cursor-default items-center gap-1.5 text-xs select-none',
        className
      )}
    >
      <input type="checkbox" className="size-3.5 accent-primary" {...props} />
      {children}
    </label>
  )
}
