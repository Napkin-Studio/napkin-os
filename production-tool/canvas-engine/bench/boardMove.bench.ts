// The board-move bench (features/board-move.clan): the landing preview a board drag computes on
// every frame (select tool drag → freeOffset over an R-tree of the blockers), with 300 blockers.
// Gates: p95 under 2 ms per frame while the board is over blockers, and under 0.1 ms on the fast
// path (a drop that is already clear).

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { SelectTool } from '../src/select/select'

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]

function scene() {
  const recs: ElementRecord[] = []
  // 300 loose pictures in a 20 × 15 grid, 60 apart: a dense canvas a board has to find room in.
  for (let i = 0; i < 300; i++) {
    const x = (i % 20) * 160
    const y = Math.floor(i / 20) * 140
    recs.push(element({ id: `p${i}`, kind: 'image', z: `b${String(i).padStart(4, '0')}`, x, y, w: 100, h: 80, props: { assetSha: null, status: 'saved' } }))
  }
  recs.push(element({ id: 'B', kind: 'board', z: 'a0', x: -2000, y: -2000, w: 400, h: 300, props: { name: 'Characters', purpose: 'character' } }))
  const s = new SceneStore(new Y.Doc())
  s.seed(recs)
  return s
}

// A shared CI runner stalls now and then (2026-11-22: p95 2.18 ms against the 2 ms gate on one run). One sweep's p95 is
// taken over 400 frames, so a single stall moves it; the gate reads the median of ROUNDS sweeps' p95, which a stall in one
// round cannot move, while a real slowdown moves every round and still fails.
const ROUNDS = 5
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

describe('board-move: the landing preview', () => {
  it('per drag frame at 300 blockers: p95 under 2 ms over them, under 0.1 ms when the drop is clear (median of 5 sweeps)', () => {
    const s = scene()
    const tool = new SelectTool(s, () => undefined)
    tool.press({ x: -1970, y: -2000 })
    // Warm up, then sweep the board across the grid (always over blockers) and across empty canvas.
    for (let i = 0; i < 50; i++) tool.drag({ x: -1970 + i * 37, y: -2000 + i * 31 })
    const overP95: number[] = []
    const clearP95: number[] = []
    for (let round = 0; round < ROUNDS; round++) {
      const over: number[] = []
      const clear: number[] = []
      for (let i = 0; i < 400; i++) {
        const t0 = performance.now()
        tool.drag({ x: 30 + ((i * 97) % 2800), y: ((i * 61) % 1800) })
        over.push(performance.now() - t0)
        if (!tool.landing) throw new Error('the board was not over a blocker')
      }
      for (let i = 0; i < 400; i++) {
        const t0 = performance.now()
        tool.drag({ x: -5000 - i - round * 1000, y: -5000 })
        clear.push(performance.now() - t0)
      }
      overP95.push(p95(over))
      clearP95.push(p95(clear))
    }
    tool.cancel()
    process.stderr.write(`bench: board landing p95 (median of ${ROUNDS}) ${median(overP95).toFixed(3)} ms over blockers, ${median(clearP95).toFixed(4)} ms clear; rounds ${overP95.map((x) => x.toFixed(2)).join(' ')}\n`)
    expect(median(overP95)).toBeLessThan(2)
    expect(median(clearP95)).toBeLessThan(0.1)
  })
})
