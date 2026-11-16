import { describe, expect, it } from 'vitest'
import type { ProtectBox } from '../contracts/types'
import { dragBox, hitBox, isTap, labelOf, moveBox, resizeBox, tapBox, whereWords } from './protectBoxes'

const pic = { w: 1000, h: 500 }
const box = (x: number, y: number, w: number, h: number, role: ProtectBox['role'] = 'subject'): ProtectBox => ({ role, x, y, w, h })

describe('hitBox', () => {
  it('finds the box under a point, the smallest first', () => {
    const boxes = [box(0, 0, 500, 500), box(100, 100, 100, 100)]
    expect(hitBox(boxes, 150, 150)).toBe(1)
    expect(hitBox(boxes, 400, 400)).toBe(0)
    expect(hitBox(boxes, 900, 100)).toBe(-1)
  })
})

describe('tapBox and dragBox', () => {
  it('a tap near an edge stays inside the picture', () => {
    const b = tapBox(pic, 990, 10, 'product')
    expect(b.x + b.w).toBeLessThanOrEqual(pic.w)
    expect(b.y).toBe(0)
    expect(b.label).toBe('product')
  })
  it('a drag in any direction makes the same box, clamped to the picture', () => {
    expect(dragBox(pic, 300, 200, 100, 50, 'subject')).toMatchObject({ x: 100, y: 50, w: 200, h: 150 })
    expect(dragBox(pic, -50, -50, 100, 100, 'other')).toMatchObject({ x: 0, y: 0, w: 100, h: 100, label: 'keep' })
  })
  it('tells a tap from a drag by its length on screen', () => {
    expect(isTap(pic, 10, 10, 12, 11, 0.5)).toBe(true)
    expect(isTap(pic, 10, 10, 60, 11, 0.5)).toBe(false)
  })
})

describe('moveBox', () => {
  it('never leaves the picture', () => {
    expect(moveBox(box(100, 100, 200, 100), -500, 900, pic)).toMatchObject({ x: 0, y: 400 })
    expect(moveBox(box(100, 100, 200, 100), 50, 20, pic)).toMatchObject({ x: 150, y: 120, w: 200, h: 100 })
  })
})

describe('resizeBox', () => {
  it('moves only the edges the handle names', () => {
    expect(resizeBox(box(100, 100, 200, 100), 'se', 50, 25, pic)).toMatchObject({ x: 100, y: 100, w: 250, h: 125 })
    expect(resizeBox(box(100, 100, 200, 100), 'nw', 30, 10, pic)).toMatchObject({ x: 130, y: 110, w: 170, h: 90 })
    expect(resizeBox(box(100, 100, 200, 100), 'e', 40, 999, pic)).toMatchObject({ y: 100, h: 100, w: 240 })
  })
  it('keeps a minimum size and stays in the picture', () => {
    const small = resizeBox(box(100, 100, 200, 100), 'e', -9999, 0, pic)
    expect(small.w).toBeGreaterThanOrEqual(4)
    expect(resizeBox(box(100, 100, 200, 100), 'se', 9999, 9999, pic)).toMatchObject({ w: 900, h: 400 })
    expect(resizeBox(box(100, 100, 200, 100), 'nw', -9999, -9999, pic)).toMatchObject({ x: 0, y: 0, w: 300, h: 200 })
  })
})

describe('labels and places', () => {
  it('a box wears its own label, else its role', () => {
    expect(labelOf({ ...box(0, 0, 1, 1), label: ' Can ' })).toBe('Can')
    expect(labelOf(box(0, 0, 1, 1, 'product'))).toBe('product')
    expect(labelOf({ ...box(0, 0, 1, 1, 'other'), label: '  ' })).toBe('keep')
  })
  it('says where a box sits', () => {
    expect(whereWords(box(0, 0, 200, 100), pic)).toBe('upper left')
    expect(whereWords(box(400, 200, 200, 100), pic)).toBe('centre')
    expect(whereWords(box(800, 200, 200, 100), pic)).toBe('right')
    expect(whereWords(box(400, 400, 200, 100), pic)).toBe('lower centre')
  })
})
