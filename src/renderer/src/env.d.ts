import type { HachiApi } from '@shared/ipc/api'

declare global {
  interface Window {
    /** Whitelist API exposed by the preload script. */
    readonly hachi: HachiApi
  }
}

export {}
