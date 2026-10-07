/**
 * Lanes of the History graph (decision 116): pure, unit tested. Commits come newest
 * first with children before parents (git log --date-order). Each lane waits for one
 * commit; a commit takes the lane waiting for it (or a new one), then hands the lane to
 * its first parent and opens lanes for the other parents of a merge.
 */

export interface GraphSegment {
  /** Column at the top of the row (`in` / `pass`), or the node's column (`out`). */
  from: number
  /** Column at the bottom of the row (`out` / `pass`), or the node's column (`in`). */
  to: number
  kind: 'pass' | 'in' | 'out'
  /** Lane color index (cycled through --git-lane-*). */
  color: number
}

export interface GraphRow {
  column: number
  color: number
  merge: boolean
  segments: GraphSegment[]
  /** Columns this row needs. */
  width: number
}

export function layoutGraph(
  commits: readonly { hash: string; parents: readonly string[] }[]
): GraphRow[] {
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  const freeLane = () => {
    const free = lanes.indexOf(null)
    return free < 0 ? lanes.length : free
  }

  return commits.map((commit) => {
    const before = lanes.slice()
    const beforeColors = colors.slice()
    let column = lanes.indexOf(commit.hash)
    if (column < 0) {
      // A branch tip nobody is waiting for: a new lane.
      column = freeLane()
      lanes[column] = commit.hash
      colors[column] = nextColor++
    }
    const color = colors[column] as number
    const segments: GraphSegment[] = []
    before.forEach((hash, i) => {
      if (hash === null || hash === undefined) return
      if (hash === commit.hash)
        segments.push({ from: i, to: column, kind: 'in', color: beforeColors[i] as number })
      else segments.push({ from: i, to: i, kind: 'pass', color: beforeColors[i] as number })
    })
    // Other lanes that waited for this commit end here.
    lanes.forEach((hash, i) => {
      if (hash === commit.hash && i !== column) lanes[i] = null
    })

    const [first, ...others] = commit.parents
    if (first === undefined) {
      lanes[column] = null
    } else {
      const waiting = lanes.indexOf(first)
      if (waiting >= 0 && waiting !== column) {
        // The first parent already has a lane: join it.
        segments.push({ from: column, to: waiting, kind: 'out', color })
        lanes[column] = null
      } else {
        lanes[column] = first
        segments.push({ from: column, to: column, kind: 'out', color })
      }
    }
    for (const parent of others) {
      let lane = lanes.indexOf(parent)
      if (lane < 0) {
        lane = freeLane()
        lanes[lane] = parent
        colors[lane] = nextColor++
      }
      segments.push({ from: column, to: lane, kind: 'out', color: colors[lane] as number })
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }
    return {
      column,
      color,
      merge: commit.parents.length > 1,
      segments,
      width: Math.max(before.length, lanes.length, column + 1)
    }
  })
}
