import { describe, expect, it } from 'vitest'
import type { WsLogEntry } from '@shared/ws'
import {
  describeEvent,
  exportJson,
  exportText,
  formatTime,
  matchesFilter,
  matchesSearch,
  messageText,
  prettyJson
} from './log-model'

const t = new Date(2026, 9, 2, 14, 3, 9, 42).getTime()
const sent: WsLogEntry = {
  kind: 'message',
  seq: 1,
  time: t,
  direction: 'sent',
  binary: false,
  data: '{"a":1}',
  size: 7
}
const received: WsLogEntry = {
  kind: 'message',
  seq: 2,
  time: t,
  direction: 'received',
  binary: true,
  data: 'AQL/',
  size: 3
}
const heartbeat: WsLogEntry = { ...sent, seq: 3, heartbeat: true, data: 'hb' }
const closed: WsLogEntry = {
  kind: 'event',
  seq: 4,
  time: t,
  event: 'closed',
  code: 1000,
  reason: 'bye',
  message: 'user'
}

describe('log model', () => {
  it('filters by direction and system entries', () => {
    const all = [sent, received, heartbeat, closed]
    const keep = (f: Parameters<typeof matchesFilter>[1]) =>
      all.filter((e) => matchesFilter(e, f)).map((e) => e.seq)
    expect(keep('all')).toEqual([1, 2, 3, 4])
    expect(keep('sent')).toEqual([1])
    expect(keep('received')).toEqual([2])
    expect(keep('events')).toEqual([3, 4])
  })

  it('shows binary payloads as hex, Base64 or text', () => {
    if (received.kind !== 'message') throw new Error()
    expect(messageText(received, 'hex')).toBe('01 02 ff')
    expect(messageText(received, 'base64')).toBe('AQL/')
    expect(messageText({ ...received, data: btoa('hi') }, 'text')).toBe('hi')
  })

  it('searches displayed text, case-insensitive', () => {
    expect(matchesSearch(sent, '"A"', 'hex')).toBe(true)
    expect(matchesSearch(received, '02 FF', 'hex')).toBe(true)
    expect(matchesSearch(received, '02 FF', 'base64')).toBe(false)
    expect(matchesSearch(closed, 'normal closure', 'hex')).toBe(true)
    expect(matchesSearch(sent, '  ', 'hex')).toBe(true)
  })

  it('describes events in words', () => {
    if (closed.kind !== 'event') throw new Error()
    expect(describeEvent(closed)).toBe('已關閉 1000 Normal Closure：bye（由你中斷）')
    expect(describeEvent({ ...closed, event: 'pong', latencyMs: 12.4 })).toBe('收到 Pong（12 ms）')
    expect(describeEvent({ ...closed, event: 'open', protocol: 'chat.v2' })).toBe(
      '已連線（子協定 chat.v2）'
    )
    expect(describeEvent({ ...closed, event: 'ping', direction: 'sent', heartbeat: true })).toBe(
      '送出 Ping（心跳）'
    )
  })

  it('pretty-prints JSON only', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('123')).toBeNull()
    expect(prettyJson('{nope')).toBeNull()
  })

  it('exports JSON with full detail and readable text', () => {
    expect(formatTime(t)).toBe('14:03:09.042')
    const json = JSON.parse(exportJson([sent, received, closed]))
    expect(json[0]).toMatchObject({ type: 'sent', format: 'text', data: '{"a":1}', size: 7 })
    expect(json[1]).toMatchObject({
      type: 'received',
      format: 'binary',
      encoding: 'base64',
      data: 'AQL/'
    })
    expect(json[2]).toMatchObject({ type: 'event', event: 'closed', code: 1000, reason: 'bye' })
    expect(exportText([sent, received, closed]).split('\n')).toEqual([
      '[2026-10-02 14:03:09.042] → {"a":1}',
      '[2026-10-02 14:03:09.042] ← (binary 3 bytes) 01 02 ff',
      '[2026-10-02 14:03:09.042] • 已關閉 1000 Normal Closure：bye（由你中斷）',
      ''
    ])
  })
})
