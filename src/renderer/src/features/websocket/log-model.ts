/**
 * Pure helpers for the WebSocket message log (filtering, display text, export).
 */
import {
  WS_CLOSE_CODE_NAMES,
  base64ToBytes,
  bytesToHex,
  type WsEventEntry,
  type WsLogEntry,
  type WsMessageEntry
} from '@shared/ws'
import { msg } from '@shared/i18n'

export type LogFilter = 'all' | 'sent' | 'received' | 'events'
export type BinaryView = 'hex' | 'base64' | 'text'

/** Messages larger than this start collapsed (decision 56). */
export const COLLAPSE_BYTES = 1024 * 1024

/** Connection events, ping / pong and heartbeat messages. */
export function isSystemEntry(entry: WsLogEntry): boolean {
  return entry.kind === 'event' || entry.heartbeat === true
}

export function matchesFilter(entry: WsLogEntry, filter: LogFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'events':
      return isSystemEntry(entry)
    default:
      return entry.kind === 'message' && !entry.heartbeat && entry.direction === filter
  }
}

/** Text of a message as displayed: binary payloads in the chosen view. */
export function messageText(entry: WsMessageEntry, view: BinaryView): string {
  if (!entry.binary) return entry.data
  if (view === 'base64') return entry.data
  const bytes = base64ToBytes(entry.data)
  return view === 'hex' ? bytesToHex(bytes) : new TextDecoder().decode(bytes)
}

export function prettyJson(text: string): string | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

export function describeEvent(entry: WsEventEntry): string {
  switch (entry.event) {
    case 'connecting':
      return msg().ws.log.connecting(entry.url ?? '')
    case 'open':
      return msg().ws.log.opened(entry.protocol)
    case 'closed': {
      const name = entry.code !== undefined ? (WS_CLOSE_CODE_NAMES[entry.code] ?? '') : ''
      const reason = entry.reason ? msg().ws.closeReason(entry.reason) : ''
      const who = entry.message === 'user' ? msg().ws.log.closedByUser : ''
      return msg()
        .ws.log.closed(`${entry.code ?? ''} ${name}${reason}${who}`)
        .replace(/\s+/g, ' ')
        .trim()
    }
    case 'error':
      return msg().ws.log.error(entry.message ?? '')
    case 'ping':
      return entry.direction === 'received'
        ? msg().ws.log.pingReceived
        : entry.heartbeat
          ? msg().ws.log.pingSentHeartbeat
          : msg().ws.log.pingSent
    case 'pong':
      return msg().ws.log.pong(
        entry.latencyMs !== undefined ? Math.round(entry.latencyMs) : undefined
      )
  }
}

export function matchesSearch(entry: WsLogEntry, query: string, view: BinaryView): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const text = entry.kind === 'message' ? messageText(entry, view) : describeEvent(entry)
  return text.toLowerCase().includes(q)
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** Local time with milliseconds, e.g. 14:03:09.042 */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** Full detail, one object per entry (binary data as Base64). */
export function exportJson(entries: readonly WsLogEntry[]): string {
  const rows = entries.map((e) =>
    e.kind === 'message'
      ? {
          time: new Date(e.time).toISOString(),
          type: e.direction,
          format: e.binary ? 'binary' : 'text',
          ...(e.binary ? { encoding: 'base64' } : {}),
          data: e.data,
          size: e.size,
          ...(e.heartbeat ? { heartbeat: true } : {})
        }
      : {
          time: new Date(e.time).toISOString(),
          type: 'event',
          event: e.event,
          description: describeEvent(e),
          ...(e.code !== undefined ? { code: e.code } : {}),
          ...(e.reason ? { reason: e.reason } : {}),
          ...(e.latencyMs !== undefined ? { latencyMs: e.latencyMs } : {})
        }
  )
  return `${JSON.stringify(rows, null, 2)}\n`
}

/** Readable log: "[2026-10-02 14:03:09.042] → text". Binary as hex. */
export function exportText(entries: readonly WsLogEntry[]): string {
  return entries
    .map((e) => {
      const d = new Date(e.time)
      const stamp = `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(e.time)}]`
      if (e.kind === 'event') return `${stamp} • ${describeEvent(e)}`
      const arrow = e.direction === 'sent' ? '→' : '←'
      const body = e.binary ? `(binary ${e.size} bytes) ${messageText(e, 'hex')}` : e.data
      return `${stamp} ${arrow} ${body}`
    })
    .join('\n')
    .concat('\n')
}
