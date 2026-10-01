import type { ErrorCode, SerializedError } from '@shared/errors'
import type { IpcResult } from '@shared/ipc/api'

/** Error thrown in the renderer when an IPC call returns `{ ok: false }`. */
export class IpcError extends Error {
  readonly code: ErrorCode

  constructor(error: SerializedError) {
    super(error.message)
    this.name = 'IpcError'
    this.code = error.code
  }
}

/** Awaits an IPC call and returns its data, throwing IpcError on failure. */
export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) throw new IpcError(result.error)
  return result.data
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
