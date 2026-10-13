/** A changed range of the buffer against git's staged text (1-based lines of the buffer). */
export interface LineChange {
  kind: 'added' | 'modified' | 'deleted'
  /** For `deleted`: the line the removed lines followed (0 = they were at the very top). */
  start: number
  end: number
}

/** Bigger differences than this many line edits get no markers (VS Code gives up on those, too). */
const MAX_EDITS = 1000

const lines = (text: string) => (text === '' ? [] : text.split(/\r?\n/))

/**
 * Myers' O(ND) diff of two line lists — the shortest edit script as
 * '=' (keep), '-' (line of `a` removed), '+' (line of `b` inserted).
 * Null once more than `max` edits would be needed.
 */
export function diffLines(a: string[], b: string[], max = MAX_EDITS): ('=' | '-' | '+')[] | null {
  const n = a.length
  const m = b.length
  const limit = Math.min(max, n + m)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= limit; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m, offset)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): ('=' | '-' | '+')[] {
  const ops: ('=' | '-' | '+')[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : v[offset + prevK]
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('=')
      x -= 1
      y -= 1
    }
    if (d > 0) ops.push(x === prevX ? '+' : '-')
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/**
 * What the gutter marks: lines added, modified, and where lines were deleted —
 * the buffer against git's staged text. Null when the difference is too big.
 */
export function lineChanges(original: string, modified: string): LineChange[] | null {
  const a = lines(original)
  const b = lines(modified)
  // Most edits are local: only diff what lies between the common head and tail.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const ops = diffLines(a.slice(head, a.length - tail), b.slice(head, b.length - tail))
  if (!ops) return null

  const changes: LineChange[] = []
  let line = head // lines of `b` passed so far
  let removed = 0
  let inserted = 0
  const flush = () => {
    if (inserted) changes.push({ kind: removed ? 'modified' : 'added', start: line - inserted + 1, end: line })
    else if (removed) changes.push({ kind: 'deleted', start: line, end: line })
    removed = 0
    inserted = 0
  }
  for (const op of ops) {
    if (op === '=') {
      flush()
      line += 1
    } else if (op === '-') removed += 1
    else {
      inserted += 1
      line += 1
    }
  }
  flush()
  return changes
}
