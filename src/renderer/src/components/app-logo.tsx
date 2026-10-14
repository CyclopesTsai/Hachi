import { cn } from '@renderer/lib/utils'
import appLogo from '@renderer/assets/app-logo.svg'

/** The dog of the app icon with a dark outline (scripts/make-icon.mjs) and the name. */
export function AppLogo({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img
        src={appLogo}
        alt=""
        draggable={false}
        className={cn('shrink-0', size === 'lg' ? 'size-12' : 'size-7')}
        data-testid="app-logo"
      />
      <span
        className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-3xl' : 'text-base')}
      >
        Hachi
      </span>
    </div>
  )
}
