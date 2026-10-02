import { describe, expect, it } from 'vitest'
import type { HttpHistoryEntry } from '@shared/schemas/history'
import { httpRequestSchema } from '@shared/schemas/http-request'
import { groupByDay } from './history-model'

const entry = (id: string, sentAt: Date): HttpHistoryEntry => ({
  id,
  type: 'http',
  sentAt: sentAt.toISOString(),
  requestId: null,
  environmentName: null,
  request: httpRequestSchema.parse({ version: 1, id: 'r', type: 'http', name: 'R' }),
  result: { kind: 'response', status: 200, statusText: 'OK', timeMs: 1, sizeBytes: 0 }
})

describe('groupByDay', () => {
  it('groups newest-first entries into 今天 / 昨天 / dates', () => {
    const now = new Date(2026, 9, 2, 15, 0)
    const groups = groupByDay(
      [
        entry('a', new Date(2026, 9, 2, 14, 0)),
        entry('b', new Date(2026, 9, 2, 0, 5)),
        entry('c', new Date(2026, 9, 1, 23, 0)),
        entry('d', new Date(2026, 8, 20, 9, 0))
      ],
      now
    )
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ['今天', ['a', 'b']],
      ['昨天', ['c']],
      [
        new Date(2026, 8, 20).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }),
        ['d']
      ]
    ])
  })
})
