// Masks as pixels (features/image-editor.clan): brush, eraser, lasso, soft edge, click-select's mask
// and Snap to cut-out, at any size.
import { describe, expect, it } from 'vitest'
import { bounds, edges, painted, rasterize, rle, shrink, unrle } from './mask'

const at = (m: Uint8Array, w: number, x: number, y: number) => m[y * w + x]

describe('rasterize', () => {
  it('paints a brush dab of the given radius', () => {
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.1, soft: 0, pts: [{ x: 0.5, y: 0.5 }] }], 100, 100)
    expect(at(m, 100, 50, 50)).toBe(255)
    expect(at(m, 100, 50, 42)).toBe(255)
    expect(at(m, 100, 50, 30)).toBe(0)
  })
  it('the eraser (a subtract stroke) takes paint away', () => {
    const m = rasterize([
      { t: 'brush', mode: 'add', r: 0.2, soft: 0, pts: [{ x: 0.5, y: 0.5 }] },
      { t: 'brush', mode: 'sub', r: 0.05, soft: 0, pts: [{ x: 0.5, y: 0.5 }] },
    ], 100, 100)
    expect(at(m, 100, 50, 50)).toBe(0)
    expect(at(m, 100, 50, 35)).toBe(255)
  })
  it('a soft brush fades toward its edge', () => {
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.2, soft: 1, pts: [{ x: 0.5, y: 0.5 }] }], 100, 100)
    const centre = at(m, 100, 50, 50), mid = at(m, 100, 60, 50), edge = at(m, 100, 68, 50)
    expect(centre).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(edge)
    expect(edge).toBeGreaterThan(0)
  })
  it('a stroke covers the line between its points', () => {
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.03, soft: 0, pts: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] }], 100, 50)
    expect(at(m, 100, 50, 25)).toBe(255)
    expect(at(m, 100, 50, 10)).toBe(0)
  })
  it('a lasso fills its polygon, and a subtract lasso cuts one out', () => {
    const square = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }]
    const hole = [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }]
    const m = rasterize([{ t: 'lasso', mode: 'add', pts: square }, { t: 'lasso', mode: 'sub', pts: hole }], 100, 100)
    expect(at(m, 100, 25, 25)).toBe(255)
    expect(at(m, 100, 50, 50)).toBe(0)
    expect(at(m, 100, 10, 10)).toBe(0)
  })
  it('a click-select mask lands at any size', () => {
    const small = new Uint8Array(16)
    small[5] = small[6] = small[9] = small[10] = 255 // the 2 x 2 middle of 4 x 4
    const m = rasterize([{ t: 'pick', mode: 'add', w: 4, h: 4, rle: rle(small) }], 40, 40)
    expect(at(m, 40, 20, 20)).toBe(255)
    expect(at(m, 40, 2, 2)).toBe(0)
  })
  it('Snap to cut-out keeps the mask only where the cut-out is', () => {
    const alpha = new Uint8Array(100 * 100)
    for (let y = 0; y < 100; y++) for (let x = 0; x < 50; x++) alpha[y * 100 + x] = 255
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.3, soft: 0, pts: [{ x: 0.5, y: 0.5 }] }, { t: 'snap', cutout: 'c' }], 100, 100,
      (id) => (id === 'c' ? alpha : undefined))
    expect(at(m, 100, 40, 50)).toBe(255)
    expect(at(m, 100, 60, 50)).toBe(0)
  })
})

describe('the helpers', () => {
  it('codes runs both ways', () => {
    const bits = new Uint8Array([0, 0, 255, 255, 255, 0, 255])
    expect(rle(bits)).toEqual([2, 3, 1, 1])
    expect([...unrle(rle(bits), bits.length)]).toEqual([...bits])
  })
  it('shrinks a mask to at most 256 on a side', () => {
    const s = shrink(new Uint8Array(1344 * 768).fill(255), 1344, 768)
    expect([s.w, s.h]).toEqual([256, 146])
    expect(s.data.every((v) => v === 255)).toBe(true)
  })
  it('finds the bounds, the paint and the edge', () => {
    const m = rasterize([{ t: 'lasso', mode: 'add', pts: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.6 }, { x: 0.2, y: 0.6 }] }], 10, 10)
    expect(painted(m)).toBe(true)
    expect(bounds(m, 10, 10)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 })
    const e = edges(m, 10, 10)
    expect(e[2 * 10 + 2]).toBe(1)
    expect(e[3 * 10 + 3]).toBe(0)
    expect(bounds(new Uint8Array(4), 2, 2)).toBeNull()
  })
})
