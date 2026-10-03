import { describe, expect, it } from 'vitest'
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, initialBounds, windowStateOf } from './window-state'

const main = { x: 0, y: 25, width: 1440, height: 875 }
const external = { x: 1440, y: 0, width: 2560, height: 1415 }
const saved = (over: object) => ({
  width: 1000,
  height: 700,
  isMaximized: false,
  isFullScreen: false,
  ...over
})

describe('initialBounds', () => {
  it('uses the default size, centered, the first time', () => {
    expect(initialBounds(null, [main])).toEqual({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  })

  it('restores a position that is still on a screen', () => {
    expect(initialBounds(saved({ x: 1600, y: 100 }), [main, external])).toEqual({
      x: 1600,
      y: 100,
      width: 1000,
      height: 700
    })
  })

  it('centers on the main screen when the saved screen is gone', () => {
    expect(initialBounds(saved({ x: 1600, y: 100 }), [main])).toEqual({ width: 1000, height: 700 })
    // Only a sliver of the title bar would be visible.
    expect(initialBounds(saved({ x: 1400, y: 100 }), [main])).toEqual({ width: 1000, height: 700 })
  })

  it('fits the size to the screens and the minimum size', () => {
    expect(initialBounds(saved({ width: 5000, height: 4000 }), [main])).toEqual({
      width: 1440,
      height: 875
    })
    expect(initialBounds(saved({ width: 300, height: 200 }), [main])).toEqual({
      width: 900,
      height: 600
    })
  })
})

describe('windowStateOf', () => {
  it('stores rounded normal bounds and the flags', () => {
    expect(
      windowStateOf(
        { x: 10.4, y: 20.6, width: 1000.2, height: 700 },
        { isMaximized: true, isFullScreen: false }
      )
    ).toEqual({ x: 10, y: 21, width: 1000, height: 700, isMaximized: true, isFullScreen: false })
  })
})
