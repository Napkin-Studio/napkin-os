// Next-slot placement (features/board-autolayout.clan; owner BA1: make space, never shuffle): a new
// thing goes right after what it follows, wraps below its row past ROW_MAX_W or a neighbour, a new lane
// starts a new row, the board grows by the 2026-10-15 rules, nothing already there moves, and what
// can't fit lands outside as one ordered row.

import { describe, expect, it } from 'vitest'
import { BOARD_GAP, BOARD_PAD, innerRect, overlaps, placeAllInBoard } from '../src/boards/sizing'
import { nextSlot, ROW_MAX_W } from '../src/boards/arrange'
import type { Rect } from '../src/model/bounds'

const V = { w: 200, h: 250 }
const inside = (outer: Rect, r: Rect) => r.x >= outer.x - 1e-6 && r.y >= outer.y - 1e-6 && r.x + r.w <= outer.x + outer.w + 1e-6 && r.y + r.h <= outer.y + outer.h + 1e-6

describe('nextSlot', () => {
  const board: Rect = { x: 0, y: 0, w: 700, h: 400 }
  const front: Rect = { x: 16, y: 22, ...V }

  it('goes right after what it follows, in its row, inside the board', () => {
    const p = nextSlot(board, [front], V, [], { after: front })
    expect(p.box).toEqual({ x: 16 + 200 + BOARD_GAP, y: 22, ...V })
    expect(p.board).toEqual(board)
    expect(p.full).toBe(false)
  })

  it('grows the board right for the row while it stays under ROW_MAX_W, then wraps below the row from its start', () => {
    let b = board
    const placed: Rect[] = [front]
    for (let i = 0; i < 8; i++) {
      const p = nextSlot(b, placed, V, [], { after: placed.at(-1), rowStart: front.x })
      expect(inside(p.board, p.box)).toBe(true)
      for (const o of placed) expect(overlaps(p.box, o, BOARD_GAP)).toBe(false)
      placed.push(p.box)
      b = p.board
    }
    expect(b.w).toBeLessThanOrEqual(ROW_MAX_W)
    const rows = [...new Set(placed.map((r) => r.y))]
    expect(rows.length).toBeGreaterThan(1)
    // Each wrapped row starts at the row's start.
    for (const y of rows) expect(Math.min(...placed.filter((r) => r.y === y).map((r) => r.x))).toBe(front.x)
  })

  it('wraps instead of growing under a neighbour on the right', () => {
    const right = { x: 724, y: -100, w: 400, h: 900 }
    const a = { x: 16 + 240, y: 22, ...V }
    const c = { x: 16 + 480, y: 22, w: 180, h: 250 }
    const p = nextSlot(board, [front, a, c], V, [right], { after: c, rowStart: 16 })
    expect(p.box).toEqual({ x: 16, y: 22 + 250 + BOARD_GAP, ...V })
    expect(p.grew).toBe('down')
    expect(overlaps(p.board, right)).toBe(false)
  })

  it('wrapping, it takes the first free slot after its row in reading order (another key\'s row is in the way)', () => {
    const other = { x: 16, y: 22 + 250 + BOARD_GAP, w: 300, h: 100 }
    const big = { ...board, h: 900 }
    const p = nextSlot(big, [front, { x: 256, y: 22, w: 400, h: 250 }, other], V, [{ x: 724, y: -100, w: 10, h: 2000 }], { after: { x: 256, y: 22, w: 400, h: 250 }, rowStart: 16 })
    expect(overlaps(p.box, other, BOARD_GAP)).toBe(false)
    expect(p.box.y).toBe(other.y)
    expect(p.box.x).toBe(16 + 300 + BOARD_GAP)
  })

  it('a new lane starts a new row below everything', () => {
    const p = nextSlot(board, [front, { x: 300, y: 22, w: 100, h: 80 }], V, [], { newRow: true })
    expect(p.box).toEqual({ x: innerRect(board).x, y: 22 + 250 + BOARD_GAP, ...V })
    expect(p.grew).toBe('down')
    expect(p.board.h).toBe(22 + 250 + BOARD_GAP + 250 + BOARD_PAD.bottom)
  })

  it('never moves or covers what is there: random sequences only ever add clear boxes, the board only grows', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let run = 0; run < 30; run++) {
      let b: Rect = { x: 0, y: 0, w: 420, h: 300 }
      const blockers = [{ x: 0, y: 900 + Math.floor(rnd() * 400), w: 1000, h: 50 }, { x: 900 + Math.floor(rnd() * 600), y: -500, w: 50, h: 3000 }]
      const on: Rect[] = []
      for (let i = 0; i < 12; i++) {
        const size = { w: 80 + Math.floor(rnd() * 220), h: 80 + Math.floor(rnd() * 220) }
        const k = rnd()
        const ask = on.length && k < 0.5 ? { after: on[Math.floor(rnd() * on.length)], rowStart: 16 } : k < 0.75 ? { newRow: true } : {}
        const before = on.map((r) => ({ ...r }))
        const p = nextSlot(b, on, size, blockers, ask)
        expect(on).toEqual(before)
        if (p.full) {
          expect(p.board).toEqual(b)
          continue
        }
        for (const o of on) expect(overlaps(p.box, o)).toBe(false)
        expect(inside(p.board, p.box)).toBe(true)
        expect(inside(p.board, b)).toBe(true)
        for (const x of blockers) expect(overlaps(p.board, x)).toBe(false)
        on.push(p.box)
        b = p.board
      }
    }
  })
})

describe('overflow', () => {
  it('what does not fit a hemmed-in board lands outside as one ordered row at one side', () => {
    const low = { x: 0, y: 0, w: 400, h: 180 }
    const walls = [{ x: 0, y: 220, w: 2000, h: 10 }, { x: 430, y: -500, w: 10, h: 2000 }, { x: -500, y: -40, w: 2000, h: 10 }, { x: -40, y: -500, w: 10, h: 2000 }]
    const r = placeAllInBoard(low, [], Array(6).fill({ w: 100, h: 80 }), walls)
    const out = r.boxes.filter((_, i) => r.full[i])
    expect(out.length).toBeGreaterThan(2)
    expect(new Set(out.map((o) => o.y)).size).toBe(1)
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThan(out[i - 1].x)
  })
})
