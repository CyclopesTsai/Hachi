/**
 * Runs scripts in a utility process (decision 85). The process is started on first use and
 * restarted after a crash or a script that does not answer in time (it is killed then).
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import type { HostCall, HostReply, ScriptRunInput, ScriptRunOutput } from '@shared/scripts'
import scriptProcessPath from '../../script-process?modulePath'

/** Extra time the process gets beyond the script's own limit before it is killed. */
const WATCHDOG_GRACE_MS = 5000

interface Pending {
  resolve(output: ScriptRunOutput): void
  timer: ReturnType<typeof setTimeout>
  /** Sends the requests the script asks for (decision 127). */
  host?: (call: HostCall) => Promise<HostReply>
}

type FromChild =
  | { id: number; output?: ScriptRunOutput; error?: string }
  | { id: number; call: { callId: number; call: HostCall } }

function failure(message: string): ScriptRunOutput {
  return { error: message, logs: [], tests: [], changes: [], request: null, durationMs: 0 }
}

export class ScriptHost {
  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  run(
    input: ScriptRunInput,
    host?: (call: HostCall) => Promise<HostReply>
  ): Promise<ScriptRunOutput> {
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // QuickJS stops scripts itself; this only fires if the process is stuck.
        this.settle(id, failure('腳本沒有回應，已中止'))
        this.restart()
      }, input.timeoutMs + WATCHDOG_GRACE_MS)
      this.pending.set(id, { resolve, timer, ...(host ? { host } : {}) })
      child.postMessage({ id, input })
    })
  }

  dispose(): void {
    this.restart()
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(scriptProcessPath, [], { serviceName: 'Hachi Scripts' })
    child.on('message', (message: FromChild) => {
      if ('call' in message) {
        const { callId, call } = message.call
        const host = this.pending.get(message.id)?.host
        const reply: Promise<HostReply> = host
          ? host(call).catch((error: unknown) => ({
              ok: false as const,
              error: error instanceof Error ? error.message : String(error)
            }))
          : Promise.resolve({ ok: false as const, error: '這裡不能從腳本送出請求' })
        void reply.then((r) => {
          if (this.child === child) child.postMessage({ id: message.id, callId, reply: r })
        })
        return
      }
      this.settle(
        message.id,
        message.output ?? failure(`無法執行腳本：${message.error ?? '未知錯誤'}`)
      )
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      for (const id of [...this.pending.keys()]) this.settle(id, failure('腳本程序意外結束'))
    })
    this.child = child
    return child
  }

  private settle(id: number, output: ScriptRunOutput): void {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(output)
  }

  private restart(): void {
    const child = this.child
    this.child = null
    child?.kill()
    for (const id of [...this.pending.keys()]) this.settle(id, failure('腳本程序已重新啟動'))
  }
}
