/**
 * Error codes shared by main and renderer. Every IPC failure carries one of these.
 * See docs/ipc.md for the meaning of each code.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'DIR_NOT_EMPTY',
  'NOT_A_WORKSPACE',
  'NO_WORKSPACE',
  'INVALID_OPERATION',
  'INVALID_FILE',
  'UNSUPPORTED_VERSION',
  'IO_ERROR',
  'INTERNAL'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface SerializedError {
  code: ErrorCode
  message: string
}

/** An expected, user-presentable error. Anything else is reported as INTERNAL. */
export class HachiError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HachiError'
    this.code = code
  }

  toJSON(): SerializedError {
    return { code: this.code, message: this.message }
  }
}

export function isHachiError(value: unknown): value is HachiError {
  return value instanceof HachiError
}
