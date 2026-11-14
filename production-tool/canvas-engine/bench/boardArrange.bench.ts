// The board-autolayout bench (features/board-autolayout.clan): nextSlot for one new thing on a board
// of 120 members with 300 blockers round it, and Tidy of 120 members. Gates: p95 under 2 ms per
// placement (a drop, a generated picture, a named view) and under 10 ms per Tidy (on demand only).

import { describe, expect, it } from 'vitest'
import { nextSlot, tidy } from '../src/boards/arrange'
import { BOARD_GAP, innerRect } from '../src/boards/sizing'
import type { Rect } from '../src/model/bounds'

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]

describe('board-autolayout: placement and Tidy', () => {
  it('120 members: nextSlot p95 under 2 ms, Tidy p95 under 10 ms', () => {
    const board: Rect = { x: 0, y: 0, w: 1400, h: 3200 }
    const inn = innerRect(board)
    const members: Rect[] = []
    for (let i = 0; i < 120; i++) members.push({ x: inn.x + (i % 6) * (180 + BOARD_GAP), y: inn.y + Math.floor(i / 6) * (140 + BOARD_GAP), w: 120 + ((i * 37) % 60), h: 100 + ((i * 53) % 40) })
    const blockers: Rect[] = []
    for (let i = 0; i < 300; i++) blockers.push({ x: 1500 + (i % 20) * 160, y: Math.floor(i / 20) * 140, w: 100, h: 80 })
    const place: number[] = []
    for (let i = 0; i < 400; i++) {
      const after = members[(i * 7) % members.length]
      const t0 = performance.now()
      nextSlot(board, members, { w: 150, h: 120 }, blockers, i % 3 ? { after, rowStart: inn.x } : { newRow: true })
      place.push(performance.now() - t0)
    }
    const lanes = Array.from({ length: 20 }, (_, l) => members.slice(l * 6, l * 6 + 6).map((m) => ({ w: m.w, h: m.h })))
    const tidied: number[] = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      tidy(board, lanes, blockers)
      tidied.push(performance.now() - t0)
    }
    process.stderr.write(`bench: nextSlot p95 ${p95(place).toFixed(3)} ms, tidy p95 ${p95(tidied).toFixed(3)} ms (120 members, 300 blockers)\n`)
    expect(p95(place)).toBeLessThan(2)
    expect(p95(tidied)).toBeLessThan(10)
  })
})
