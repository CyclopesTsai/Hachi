import { darwinAdapter } from './darwin'
import { createDefaultAdapter } from './default'
import type { PlatformAdapter } from './types'

export type { PlatformAdapter } from './types'

export const platform: PlatformAdapter =
  process.platform === 'darwin'
    ? darwinAdapter
    : createDefaultAdapter(process.platform === 'win32' ? 'win32' : 'linux')
