/**
 * Runs one Pre-request / Post-response script in a fresh QuickJS context (decision 70).
 * The sandbox gets a JSON snapshot only. Its one host function, `__hachiHost`, asks the
 * app to send a request or to wait (decision 127); files and Node stay out of reach.
 * Computing time, total time and memory are limited. Used inside the script
 * utility process (script-process.ts) and directly by unit tests.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule
} from 'quickjs-emscripten-core'
import {
  SCRIPT_CHANGE_LIMIT,
  SCRIPT_LOG_LIMIT,
  SCRIPT_LOG_TEXT_LIMIT,
  SCRIPT_MAX_HOST_REQUESTS,
  SCRIPT_MEMORY_BYTES,
  SCRIPT_TIMEOUT_MS,
  SCRIPT_VALUE_LIMIT,
  type HostCall,
  type HostReply,
  type ScriptLog,
  type ScriptRequest,
  type ScriptRunInput,
  type ScriptRunOutput,
  type ScriptTestResult,
  type VariableChange
} from '@shared/scripts'
import { PRELUDE } from './prelude'

let modulePromise: Promise<QuickJSWASMModule> | null = null
const loadModule = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(variant))

let cryptoSource: string | null = null
/** crypto-js (MIT, decision 83), evaluated only for scripts that mention it. */
function cryptoJs(): string {
  cryptoSource ??= readFileSync(
    createRequire(import.meta.url).resolve('crypto-js/crypto-js.js'),
    'utf8'
  )
  return cryptoSource
}

const usesCrypto = (code: string) => /CryptoJS|crypto-js/.test(code)

interface DumpedError {
  name?: unknown
  message?: unknown
  stack?: unknown
}

function describeError(raw: unknown, fileName: string, timeoutMs: number): string {
  const e = (typeof raw === 'object' && raw !== null ? raw : { message: raw }) as DumpedError
  const message = typeof e.message === 'string' ? e.message : String(e.message ?? raw)
  if (message === 'interrupted') return `腳本執行超過 ${timeoutMs / 1000} 秒，已中止`
  if (/out of memory/i.test(message)) {
    return `腳本使用的記憶體超過上限（${SCRIPT_MEMORY_BYTES / 1024 / 1024} MB）`
  }
  if (/stack overflow/i.test(message)) return '腳本遞迴太深（堆疊溢位）'
  const name = typeof e.name === 'string' && e.name !== 'Error' ? `${e.name}: ` : ''
  const stack = typeof e.stack === 'string' ? e.stack : ''
  const at = new RegExp(`${fileName.replace('.', '\\.')}:(\\d+)`).exec(stack)
  return `${name}${message}${at ? `（第 ${at[1]} 行）` : ''}`
}

/** Evaluates code; returns the dumped error, or undefined on success. */
function evaluate(ctx: QuickJSContext, code: string, fileName: string): unknown {
  const result = ctx.evalCode(code, fileName)
  if (result.error) {
    const error: unknown = ctx.dump(result.error)
    result.error.dispose()
    return error ?? 'Error'
  }
  result.value.dispose()
  return undefined
}

const asString = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** The sandbox output is produced by user-controlled code: keep only well-formed parts. */
export function sanitizeOutput(raw: unknown): Omit<ScriptRunOutput, 'error' | 'durationMs'> {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : [])
  const logs: ScriptLog[] = list(o.logs)
    .slice(0, SCRIPT_LOG_LIMIT + 1)
    .flatMap((l) => {
      const r = l as Record<string, unknown>
      const level = ['log', 'info', 'warn', 'error'].includes(r.level as string)
        ? (r.level as ScriptLog['level'])
        : 'log'
      return typeof r.text === 'string'
        ? [{ level, text: asString(r.text, SCRIPT_LOG_TEXT_LIMIT * 2) }]
        : []
    })
  const tests: ScriptTestResult[] = list(o.tests)
    .slice(0, 10_000)
    .flatMap((t) => {
      const r = t as Record<string, unknown>
      if (typeof r.name !== 'string' || typeof r.passed !== 'boolean') return []
      return [
        {
          name: asString(r.name, 500),
          passed: r.passed,
          ...(typeof r.error === 'string' ? { error: asString(r.error, 2000) } : {})
        }
      ]
    })
  const changes: VariableChange[] = list(o.changes)
    .slice(0, SCRIPT_CHANGE_LIMIT)
    .flatMap((c) => {
      const r = c as Record<string, unknown>
      if (!['runtime', 'environment', 'collection'].includes(r.scope as string)) return []
      if (typeof r.name !== 'string' || r.name.trim() === '' || r.name.length > 200) return []
      if (r.value !== null && typeof r.value !== 'string') return []
      if (typeof r.value === 'string' && r.value.length > SCRIPT_VALUE_LIMIT) return []
      return [{ scope: r.scope as VariableChange['scope'], name: r.name, value: r.value }]
    })
  let request: ScriptRequest | null = null
  if (typeof o.request === 'object' && o.request !== null) {
    const r = o.request as Record<string, unknown>
    if (typeof r.method === 'string' && typeof r.url === 'string' && Array.isArray(r.headers)) {
      request = {
        method: r.method.slice(0, 20),
        url: r.url.slice(0, 64 * 1024),
        headers: (r.headers as unknown[])
          .filter(
            (h): h is [string, string] =>
              Array.isArray(h) && typeof h[0] === 'string' && typeof h[1] === 'string'
          )
          .slice(0, 1000)
          .map(([k, v]) => [k.slice(0, 1000), v.slice(0, SCRIPT_VALUE_LIMIT)]),
        body: typeof r.body === 'string' ? r.body : null
      }
    }
  }
  const nextRequest =
    o.nextRequest === null
      ? null
      : typeof o.nextRequest === 'string'
        ? o.nextRequest.slice(0, 500)
        : undefined
  return { logs, tests, changes, request, ...(nextRequest !== undefined ? { nextRequest } : {}) }
}

/** Asks the app to send a request / run a saved one for the script (decision 127). */
export type ScriptHostFn = (call: HostCall) => Promise<HostReply>

export async function runScript(
  input: ScriptRunInput,
  host?: ScriptHostFn
): Promise<ScriptRunOutput> {
  try {
    return await runIsolated(input, host)
  } catch (error) {
    // The host stack overflowed inside wasm: the instance may be unusable.
    if (!(error instanceof RangeError)) throw error
    modulePromise = null
    return {
      error: '腳本遞迴太深（堆疊溢位）',
      logs: [],
      tests: [],
      changes: [],
      request: null,
      durationMs: 0
    }
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

async function runIsolated(input: ScriptRunInput, host?: ScriptHostFn): Promise<ScriptRunOutput> {
  const started = performance.now()
  const fileName = input.phase === 'preRequest' ? 'pre-request.js' : 'post-response.js'
  const module = await loadModule()
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(SCRIPT_MEMORY_BYTES)
  // Small enough that QuickJS reports deep recursion before the host (wasm) stack overflows.
  runtime.setMaxStackSize(256 * 1024)
  const ctx = runtime.newContext()
  let disposed = false
  /** Host work the script is waiting for (sendRequest, sleep). */
  const pending = new Set<Promise<void>>()
  try {
    const snapshot = JSON.stringify({
      phase: input.phase,
      variables: input.variables,
      iterationData: input.iterationData,
      info: input.info,
      request: input.request,
      response: input.response,
      limits: {
        logs: SCRIPT_LOG_LIMIT,
        logText: SCRIPT_LOG_TEXT_LIMIT,
        changes: SCRIPT_CHANGE_LIMIT,
        value: SCRIPT_VALUE_LIMIT
      }
    })
    const inputHandle = ctx.newString(snapshot)
    ctx.setProp(ctx.global, '__hachiInput', inputHandle)
    inputHandle.dispose()

    // Total time (waiting included) and computing time are limited separately.
    const wallDeadline = Date.now() + input.timeoutMs
    const computeLimit = Math.min(SCRIPT_TIMEOUT_MS, input.timeoutMs)
    let computeLeft = computeLimit
    const compute = <T>(work: () => T): T => {
      const sliceStart = performance.now()
      runtime.setInterruptHandler(
        shouldInterruptAfterDeadline(Date.now() + Math.max(computeLeft, 1))
      )
      try {
        return work()
      } finally {
        computeLeft -= performance.now() - sliceStart
      }
    }

    // __hachiHost(op, json) → Promise<json>: the only way out of the sandbox.
    let hostCalls = 0
    const hostFn = ctx.newFunction('__hachiHost', (opHandle, argHandle) => {
      const op = ctx.getString(opHandle)
      const arg = ctx.getString(argHandle)
      const deferred = ctx.newPromise()
      const work = (async (): Promise<string> => {
        if (op === 'sleep') {
          // A little past the deadline at most: the loop below reports the timeout first.
          await wait(Math.min(Number(arg) || 0, wallDeadline - Date.now() + 50))
          return 'null'
        }
        if (!host) throw new Error('這裡不能從腳本送出請求')
        if (++hostCalls > SCRIPT_MAX_HOST_REQUESTS) {
          throw new Error(`每次執行最多送出 ${SCRIPT_MAX_HOST_REQUESTS} 個請求`)
        }
        const reply = await host(JSON.parse(arg) as HostCall)
        if (!reply.ok) throw new Error(reply.error)
        return JSON.stringify({ response: reply.response, variables: reply.variables ?? null })
      })()
      const settle = work
        .then(
          (json) => {
            if (disposed) return
            const value = ctx.newString(json)
            deferred.resolve(value)
            value.dispose()
          },
          (error: unknown) => {
            if (disposed) return
            const e = ctx.newError(error instanceof Error ? error.message : String(error))
            deferred.reject(e)
            e.dispose()
          }
        )
        .finally(() => {
          pending.delete(settle)
          if (!disposed) deferred.dispose()
        })
      pending.add(settle)
      return deferred.handle
    })
    ctx.setProp(ctx.global, '__hachiHost', hostFn)
    hostFn.dispose()

    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 2000))
    const preludeError = evaluate(ctx, PRELUDE, 'prelude.js')
    if (preludeError !== undefined) {
      throw new Error(`script prelude failed: ${JSON.stringify(preludeError)}`)
    }
    if (usesCrypto(input.code)) {
      const cryptoError = evaluate(ctx, cryptoJs(), 'crypto-js.js')
      if (cryptoError !== undefined) {
        throw new Error(`crypto-js failed: ${JSON.stringify(cryptoError)}`)
      }
    }

    // The whole script is an async function, so `await` works anywhere (decision 127).
    // It starts on the first line, keeping line numbers in error messages.
    let scriptError: unknown = undefined
    let timedOut = false
    const result = compute(() => ctx.evalCode(`(async () => {${input.code}\n})()`, fileName))
    if (result.error) {
      scriptError = ctx.dump(result.error) ?? 'Error'
      result.error.dispose()
    } else {
      const promise = result.value
      for (;;) {
        const jobs = compute(() => runtime.executePendingJobs())
        if (jobs.error) {
          scriptError = ctx.dump(jobs.error) ?? 'Error'
          jobs.error.dispose()
          break
        }
        const state = ctx.getPromiseState(promise)
        if (state.type === 'rejected') {
          scriptError = ctx.dump(state.error) ?? 'Error'
          state.error.dispose()
          break
        }
        if (state.type === 'fulfilled') {
          if (state.notAPromise === false) state.value.dispose()
          break
        }
        if (computeLeft <= 0) {
          scriptError = 'interrupted'
          break
        }
        if (pending.size === 0) {
          scriptError = '腳本在等待一個永遠不會完成的 Promise'
          break
        }
        const left = wallDeadline - Date.now()
        if (left <= 0) {
          timedOut = true
          break
        }
        await Promise.race([Promise.race(pending), wait(left)])
      }
      promise.dispose()
    }

    // Collect what happened before an error too (changes made so far still apply).
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 2000))
    let collected: Omit<ScriptRunOutput, 'error' | 'durationMs'> = {
      logs: [],
      tests: [],
      changes: [],
      request: null
    }
    const finish = ctx.evalCode('__hachiFinish()', 'finish.js')
    if (finish.error) {
      finish.error.dispose()
    } else {
      const text: unknown = ctx.dump(finish.value)
      finish.value.dispose()
      if (typeof text === 'string') {
        try {
          collected = sanitizeOutput(JSON.parse(text))
        } catch {
          // keep the empty result
        }
      }
    }
    return {
      ...collected,
      error: timedOut
        ? `腳本總時間超過 ${Math.round(input.timeoutMs / 1000)} 秒（含等待請求），已中止`
        : scriptError === undefined
          ? null
          : describeError(scriptError, fileName, computeLimit),
      durationMs: performance.now() - started
    }
  } finally {
    disposed = true
    try {
      ctx.dispose()
      runtime.dispose()
    } catch {
      // After out-of-memory QuickJS cannot free everything and aborts its wasm instance;
      // load a fresh one for the next script.
      modulePromise = null
    }
  }
}
