import { describe, expect, it } from 'vitest'
import { fitSize, MAX_ASPECT, MAX_SIDE, MIN_SIDE } from './fit'

describe('fitSize: every picture leaves in a size providers take', () => {
  it('a small sketch grows so its short side is at least the minimum', () => {
    // 2026-10-07: fal's Kling refused a sketch exported at its on-screen size ("too small").
    const f = fitSize(140, 300)
    expect(Math.min(f.canvasW, f.canvasH)).toBeGreaterThanOrEqual(MIN_SIDE)
    expect(f.w / f.h).toBeCloseTo(140 / 300, 2)
    expect(f.same).toBe(false)
  })

  it('a big picture shrinks to the maximum and keeps its shape', () => {
    const f = fitSize(4000, 3000)
    expect([f.w, f.h]).toEqual([MAX_SIDE, 1152])
    expect([f.canvasW, f.canvasH]).toEqual([MAX_SIDE, 1152])
  })

  it('a long thin picture is padded to an aspect providers take', () => {
    for (const [w, h] of [[1500, 100], [100, 1500], [900, 40]]) {
      const f = fitSize(w, h)
      const ratio = Math.max(f.canvasW, f.canvasH) / Math.min(f.canvasW, f.canvasH)
      expect(ratio).toBeLessThanOrEqual(MAX_ASPECT + 0.01)
      expect(Math.min(f.canvasW, f.canvasH)).toBeGreaterThanOrEqual(MIN_SIDE)
      expect(Math.max(f.canvasW, f.canvasH)).toBeLessThanOrEqual(MAX_SIDE)
      expect(f.w).toBeLessThanOrEqual(f.canvasW)
      expect(f.h).toBeLessThanOrEqual(f.canvasH)
    }
  })

  it('a picture already in range is left as it is', () => {
    expect(fitSize(768, 1024).same).toBe(true)
  })
})
