import { beforeEach, describe, expect, it } from 'vitest'
import type { WsLogEntry } from '@shared/ws'
import { isLive, useWsStore } from './ws-store'

const message = (seq: number): WsLogEntry => ({
  kind: 'message',
  seq,
  time: seq,
  direction: 'received',
  binary: false,
  data: `m${seq}`,
  size: 2
})

beforeEach(() => {
  useWsStore.setState({
    sessions: {
      tab: {
        connectionId: 'c2',
        state: { status: 'open', url: 'ws://x' },
        entries: [],
        dropped: 0,
        unresolved: [],
        error: null
      }
    },
    owners: { c1: 'tab', c2: 'tab' },
    messageLimit: 3
  })
})

describe('ws store', () => {
  it('keeps only the newest entries up to the limit and counts the dropped ones', () => {
    const { handleEvent } = useWsStore.getState()
    handleEvent({ connectionId: 'c2', entries: [message(1), message(2)] })
    handleEvent({ connectionId: 'c2', entries: [message(3), message(4), message(5)] })
    const session = useWsStore.getState().sessions.tab!
    expect(session.entries.map((e) => e.key)).toEqual(['c2:3', 'c2:4', 'c2:5'])
    expect(session.dropped).toBe(2)
    useWsStore.getState().clear('tab')
    expect(useWsStore.getState().sessions.tab).toMatchObject({ entries: [], dropped: 0 })
  })

  it('applies state only from the current connection, but keeps older log lines', () => {
    const { handleEvent } = useWsStore.getState()
    handleEvent({
      connectionId: 'c1',
      entries: [message(9)],
      state: { status: 'closed', url: 'ws://old' }
    })
    const session = useWsStore.getState().sessions.tab!
    expect(session.state?.status).toBe('open')
    expect(session.entries.map((e) => e.key)).toEqual(['c1:9'])
    handleEvent({ connectionId: 'c2', entries: [], state: { status: 'closed', url: 'ws://x' } })
    expect(isLive(useWsStore.getState().sessions.tab)).toBe(false)
    // Events of unknown connections are ignored.
    handleEvent({ connectionId: 'nope', entries: [message(1)] })
    expect(useWsStore.getState().sessions.tab!.entries).toHaveLength(1)
  })
})
