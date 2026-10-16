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

describe('board-move: the landing preview', () => {
  it('per drag frame at 300 blockers: p95 under 2 ms over them, under 0.1 ms when the drop is clear', () => {
    const s = scene()
    const tool = new SelectTool(s, () => undefined)
    tool.press({ x: -1970, y: -2000 })
    // Warm up, then sweep the board across the grid (always over blockers) and across empty canvas.
    for (let i = 0; i < 50; i++) tool.drag({ x: -1970 + i * 37, y: -2000 + i * 31 })
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
      tool.drag({ x: -5000 - i, y: -5000 })
      clear.push(performance.now() - t0)
    }
    tool.cancel()
    process.stderr.write(`bench: board landing p95 ${p95(over).toFixed(3)} ms over blockers, ${p95(clear).toFixed(4)} ms clear\n`)
    expect(p95(over)).toBeLessThan(2)
    expect(p95(clear)).toBeLessThan(0.1)
  })
})
