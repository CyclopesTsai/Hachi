import { describe, expect, it } from 'vitest'
import { layoutGraph } from './graph'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

describe('layoutGraph', () => {
  it('keeps a straight history in one lane', () => {
    const rows = layoutGraph([c('c3', 'c2'), c('c2', 'c1'), c('c1')])
    expect(rows.map((r) => [r.column, r.width])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1]
    ])
    expect(rows[2]?.segments).toEqual([{ from: 0, to: 0, kind: 'in', color: 0 }])
  })

  it('opens a lane for a merged branch and joins it back at the common parent', () => {
    // M merges B into A; both come from C.
    const rows = layoutGraph([c('M', 'A', 'B'), c('A', 'C'), c('B', 'C'), c('C')])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 0])
    expect(rows[0]).toMatchObject({
      merge: true,
      width: 2,
      segments: [
        { from: 0, to: 0, kind: 'out', color: 0 },
        { from: 0, to: 1, kind: 'out', color: 1 }
      ]
    })
    // B's lane passes A, then B joins C's lane.
    expect(rows[1]?.segments).toContainEqual({ from: 1, to: 1, kind: 'pass', color: 1 })
    expect(rows[2]?.segments).toEqual([
      { from: 0, to: 0, kind: 'pass', color: 0 },
      { from: 1, to: 1, kind: 'in', color: 1 },
      { from: 1, to: 0, kind: 'out', color: 1 }
    ])
    expect(rows[3]).toMatchObject({ column: 0, width: 1 })
  })

  it('gives unrelated branch tips their own lanes', () => {
    const rows = layoutGraph([c('x2', 'x1'), c('y1', 'base'), c('x1', 'base'), c('base')])
    // x1 joins the lane already waiting for base.
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0, 1])
    expect(rows[2]?.segments).toContainEqual({ from: 0, to: 1, kind: 'out', color: 0 })
    expect(rows[3]?.segments).toEqual([{ from: 1, to: 1, kind: 'in', color: 1 }])
  })
})
