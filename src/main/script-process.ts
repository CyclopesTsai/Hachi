/**
 * Entry of the script utility process (decision 85). Receives `{ id, input }`, runs the
 * script in QuickJS and answers `{ id, output }` / `{ id, error }`. A separate process,
 * so a misbehaving script can be stopped by killing it without affecting the app.
 *
 * Requests a script sends (decision 127) go to main as `{ id, call: { callId, call } }`;
 * main answers `{ id, callId, reply }`.
 */
import type { HostCall, HostReply, ScriptRunInput } from '@shared/scripts'
import { runScript } from './services/scripts/engine'
import { setLanguage, type Language } from '@shared/i18n'

type Incoming =
  | { id: number; input: ScriptRunInput; language: Language }
  | { id: number; callId: number; reply: HostReply }

const waiting = new Map<string, (reply: HostReply) => void>()
let nextCall = 1

process.parentPort.on('message', (event: { data: Incoming }) => {
  const message = event.data
  if ('reply' in message) {
    const key = `${message.id}:${message.callId}`
    waiting.get(key)?.(message.reply)
    waiting.delete(key)
    return
  }
  const { id, input } = message
  // Script errors and sandbox texts follow the app's language (issue #6).
  setLanguage(message.language)
  const host = (call: HostCall) =>
    new Promise<HostReply>((resolve) => {
      const callId = nextCall++
      waiting.set(`${id}:${callId}`, resolve)
      process.parentPort.postMessage({ id, call: { callId, call } })
    })
  runScript(input, host).then(
    (output) => process.parentPort.postMessage({ id, output }),
    (error: unknown) =>
      process.parentPort.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error)
      })
  )
})
