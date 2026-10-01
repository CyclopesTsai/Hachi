import { HachiError, isHachiError } from '@shared/errors'
import type { InvokeMap, IpcResult } from '@shared/ipc/api'
import type { InvokeChannel } from '@shared/ipc/channels'
import { inputSchemas, type InputOf } from '@shared/ipc/contract'

export type Output<C extends InvokeChannel> = InvokeMap[C]['output']
export type Handler<C extends InvokeChannel> = (input: InputOf<C>) => Promise<Output<C>> | Output<C>

/**
 * Wraps a handler so that it
 *  1. validates the raw renderer input against the channel's zod schema, and
 *  2. never throws across IPC — failures become `{ ok: false, error }`.
 *
 * Pure (no electron import) so it can be unit tested.
 */
export function createHandler<C extends InvokeChannel>(
  channel: C,
  handler: Handler<C>,
  log: (message: string, error: unknown) => void = console.error
): (rawInput: unknown) => Promise<IpcResult<Output<C>>> {
  const schema = inputSchemas[channel]
  return async (rawInput) => {
    const parsed = schema.safeParse(rawInput)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `${where}${issue?.message ?? 'Invalid input'}` }
      }
    }
    try {
      const data = await handler(parsed.data as InputOf<C>)
      return { ok: true, data }
    } catch (error) {
      if (isHachiError(error)) return { ok: false, error: error.toJSON() }
      log(`[ipc] ${channel} failed`, error)
      return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error, see logs' } }
    }
  }
}

/**
 * Returns a predicate telling whether an IPC message comes from our own renderer page.
 * - dev: same origin as the Vite dev server
 * - prod: the bundled `index.html` file URL
 */
export function createSenderValidator(
  rendererUrl: string
): (frameUrl: string | undefined) => boolean {
  const expected = new URL(rendererUrl)
  return (frameUrl) => {
    if (!frameUrl) return false
    let actual: URL
    try {
      actual = new URL(frameUrl)
    } catch {
      return false
    }
    if (expected.protocol === 'file:') {
      return actual.protocol === 'file:' && actual.pathname === expected.pathname
    }
    return actual.origin === expected.origin
  }
}

export const forbidden = (): IpcResult<never> => ({
  ok: false,
  error: new HachiError('FORBIDDEN', 'IPC sender is not trusted').toJSON()
})
