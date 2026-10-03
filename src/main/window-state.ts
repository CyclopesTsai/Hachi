/**
 * Window position / size memory (decision 94). Pure helpers (unit tested); the window
 * wiring is in window.ts.
 */
import type { WindowState } from '@shared/schemas/app-config'

export const DEFAULT_WIDTH = 1280
export const DEFAULT_HEIGHT = 820
export const MIN_WIDTH = 900
export const MIN_HEIGHT = 600
/** At least this much of the title bar area must be on a screen to reuse the position. */
const VISIBLE_MIN = 100

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  }
}

/**
 * Bounds for a new window: the saved ones if they are still on a screen, otherwise the
 * saved (or default) size centered by Electron (no x / y). Sizes are fitted to the
 * largest work area so the window never opens bigger than the screens.
 */
export function initialBounds(
  saved: WindowState | null,
  workAreas: readonly Rect[]
): { x?: number; y?: number; width: number; height: number } {
  const maxW = Math.max(MIN_WIDTH, ...workAreas.map((a) => a.width))
  const maxH = Math.max(MIN_HEIGHT, ...workAreas.map((a) => a.height))
  const width = Math.min(Math.max(saved?.width ?? DEFAULT_WIDTH, MIN_WIDTH), maxW)
  const height = Math.min(Math.max(saved?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT), maxH)
  if (saved?.x === undefined || saved.y === undefined) return { width, height }
  // The top strip (title bar) must be reachable, or the user could not move the window.
  const titleBar: Rect = { x: saved.x, y: saved.y, width, height: 40 }
  const visible = workAreas.some((area) => {
    const o = overlap(titleBar, area)
    return o.width >= VISIBLE_MIN && o.height > 0
  })
  return visible ? { x: saved.x, y: saved.y, width, height } : { width, height }
}

/** What is stored: the normal (not maximized / full screen) bounds plus those flags. */
export function windowStateOf(
  normalBounds: Rect,
  flags: { isMaximized: boolean; isFullScreen: boolean }
): WindowState {
  return {
    x: Math.round(normalBounds.x),
    y: Math.round(normalBounds.y),
    width: Math.round(normalBounds.width),
    height: Math.round(normalBounds.height),
    isMaximized: flags.isMaximized,
    isFullScreen: flags.isFullScreen
  }
}
