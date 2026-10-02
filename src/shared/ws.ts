/**
 * Types exchanged between renderer and main for WebSocket connections, plus pure
 * helpers for binary payloads (safe to import anywhere: no Buffer).
 */

export type WsStatus = 'connecting' | 'open' | 'closing' | 'closed' | 'error'

/** State of one connection, pushed with `ws:event`. */
export interface WsConnState {
  status: WsStatus
  /** URL actually connected to (variables substituted, params added). */
  url: string
  /** Subprotocol chosen by the server. */
  protocol?: string
  openedAt?: number
  closeCode?: number
  closeReason?: string
  /** Error message when the connection failed. */
  error?: string
}

interface WsEntryBase {
  /** Increasing per connection. */
  seq: number
  /** Epoch milliseconds. */
  time: number
}

export interface WsMessageEntry extends WsEntryBase {
  kind: 'message'
  direction: 'sent' | 'received'
  binary: boolean
  /** Text content; for binary messages the bytes as Base64. */
  data: string
  /** Payload size in bytes. */
  size: number
  /** Sent automatically by the heartbeat (text mode). */
  heartbeat?: boolean
}

export type WsEventKind = 'connecting' | 'open' | 'closed' | 'error' | 'ping' | 'pong'

export interface WsEventEntry extends WsEntryBase {
  kind: 'event'
  event: WsEventKind
  /** For ping / pong: who sent the frame. */
  direction?: 'sent' | 'received'
  url?: string
  protocol?: string
  code?: number
  reason?: string
  /** Error message (for "error"), or close initiated by the user. */
  message?: string
  /** Round trip of a ping we sent, on its pong. */
  latencyMs?: number
  /** Heartbeat ping (not a manual one). */
  heartbeat?: boolean
}

export type WsLogEntry = WsMessageEntry | WsEventEntry

export interface WsEventPayload {
  connectionId: string
  /** New connection state, when it changed. */
  state?: WsConnState
  entries: WsLogEntry[]
}

/** Names of the standard close codes (RFC 6455 / IANA registry), for display. */
export const WS_CLOSE_CODE_NAMES: Record<number, string> = {
  1000: 'Normal Closure',
  1001: 'Going Away',
  1002: 'Protocol Error',
  1003: 'Unsupported Data',
  1005: 'No Status Received',
  1006: 'Abnormal Closure',
  1007: 'Invalid Payload',
  1008: 'Policy Violation',
  1009: 'Message Too Big',
  1010: 'Mandatory Extension',
  1011: 'Internal Error',
  1012: 'Service Restart',
  1013: 'Try Again Later',
  1014: 'Bad Gateway',
  1015: 'TLS Handshake'
}

export class BinaryFormatError extends Error {}

/** "0a ff 10", "0aff10", "0x0a,0xff" … → bytes. Throws BinaryFormatError. */
export function hexToBytes(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[\s,:]/g, '')
  if (clean.length % 2 !== 0 || !/^[\da-f]*$/i.test(clean)) {
    throw new BinaryFormatError('Hex must be pairs of 0–9 / a–f')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += (i === 0 ? '' : ' ') + (bytes[i] as number).toString(16).padStart(2, '0')
  }
  return out
}

/** Standard or URL-safe Base64, whitespace ignored. Throws BinaryFormatError. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z\d+/]*={0,2}$/.test(clean) || clean.replace(/=+$/, '').length % 4 === 1) {
    throw new BinaryFormatError('Invalid Base64')
  }
  const padded = clean.padEnd(Math.ceil(clean.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}
