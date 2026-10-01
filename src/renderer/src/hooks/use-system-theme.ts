import { useEffect } from 'react'

/**
 * Mirrors the effective color scheme onto `<html class="dark">`.
 * The main process sets `nativeTheme.themeSource` from app-config, so
 * `prefers-color-scheme` already reflects the user's choice (system / light / dark).
 */
export function useSystemTheme(): void {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.classList.toggle('dark', query.matches)
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
}
