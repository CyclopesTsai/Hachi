/**
 * Entry of the script utility process (decision 85). Receives `{ id, input }`, runs the
 * script in QuickJS and answers `{ id, output }` / `{ id, error }`. A separate process,
 * so a misbehaving script can be stopped by killing it without affecting the app.
 */
import type { ScriptRunInput } from '@shared/scripts'
import { runScript } from './services/scripts/engine'

process.parentPort.on('message', (event: { data: { id: number; input: ScriptRunInput } }) => {
  const { id, input } = event.data
  runScript(input).then(
    (output) => process.parentPort.postMessage({ id, output }),
    (error: unknown) =>
      process.parentPort.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error)
      })
  )
})
