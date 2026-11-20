// Views beside their front (UAT round 1 IMG-22): right of it when clear, else under it, never past the whole row.
import { describe, expect, it } from 'vitest'
import { slotNear, type El } from './scene'

const box = (id: string, x: number, y: number, w = 300, h = 400, type = 'image') => ({ id, type, x, y, width: w, height: h, isDeleted: false, frameId: null }) as unknown as El
const front = { minX: 0, minY: 0, maxX: 300, maxY: 400 }

describe('slotNear', () => {
  it('goes right of the front when nothing is there', () => {
    expect(slotNear([box('f', 0, 0)], front, { w: 980, h: 400 })).toEqual({ x: 380, y: 0, w: 980, h: 400 })
  })
  it('goes under the front when its row is taken (the collage and the park photo stay uncovered)', () => {
    const els = [box('f', 0, 0), box('collage', 400, 0), box('park', 760, 0)]
    expect(slotNear(els, front, { w: 980, h: 400 })).toEqual({ x: 0, y: 480, w: 980, h: 400 })
  })
  it('boards and arrows never block; past the row when under is taken too', () => {
    const board = box('board', -40, -40, 3000, 3000, 'frame')
    expect(slotNear([board, box('f', 0, 0)], front, { w: 980, h: 400 }).x).toBe(380)
    const els = [box('f', 0, 0), box('a', 400, 0), box('b', 0, 500)]
    expect(slotNear(els, front, { w: 980, h: 400 })).toEqual({ x: 780, y: 0, w: 980, h: 400 })
  })
})
