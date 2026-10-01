import { cn } from '@renderer/lib/utils'

/** Placeholder logo (text only). Replace once the official Hachi logo is available. */
export function AppLogo({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground',
          size === 'lg' ? 'size-12 text-2xl' : 'size-7 text-sm'
        )}
        aria-hidden
      >
        H
      </div>
      <span
        className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-3xl' : 'text-base')}
      >
        Hachi
      </span>
    </div>
  )
}
