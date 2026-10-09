import { describe, expect, it } from 'vitest'
import { boxPixels } from './mask'
import { rectToRegion, regionAround, regionToRect } from './region'
import { checkDurations, splitTarget, totalSeconds } from './shots'
import { ID_PATTERN, newId } from './ulid'

describe('region math', () => {
  const display = { w: 400, h: 200 }
  it('maps a drawn rect to 0-1 coordinates, origin top-left', () => {
    expect(rectToRegion({ x: 100, y: 50 }, { x: 300, y: 150 }, display)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })
  it('accepts any corner order', () => {
    expect(rectToRegion({ x: 300, y: 150 }, { x: 100, y: 50 }, display)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })
  it('clamps a box that spills outside the image', () => {
    expect(rectToRegion({ x: -50, y: -20 }, { x: 500, y: 100 }, display)).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
  })
  it('ignores a click (too small)', () => {
    expect(rectToRegion({ x: 10, y: 10 }, { x: 12, y: 11 }, display)).toBeNull()
  })
  it('round-trips through pixels', () => {
    const r = rectToRegion({ x: 40, y: 20 }, { x: 240, y: 120 }, display)!
    expect(regionToRect(r, { w: 1600, h: 800 })).toEqual({ x: 160, y: 80, w: 800, h: 400 })
  })
  it('click-select boxes stay inside the image', () => {
    const r = regionAround({ x: 395, y: 195 }, display)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
    expect(r.w).toBeGreaterThan(0)
  })
})

describe('shot durations', () => {
  const shots = (...d: number[]) => d.map((duration_s) => ({ duration_s }))
  it('passes when the seconds sum to the target', () => {
    expect(checkDurations(shots(5, 5, 5), 15)).toEqual({ ok: true, total: 15 })
  })
  it('says how much to add or cut', () => {
    expect(checkDurations(shots(5, 4), 10)).toMatchObject({ ok: false, total: 9, reason: 'Add 1 s to reach 10 s.' })
    expect(checkDurations(shots(8, 8, 8), 20)).toMatchObject({ ok: false, reason: 'Cut 4 s to reach 20 s.' })
  })
  it('needs 2-8 shots of 1-10 s', () => {
    expect(checkDurations(shots(10), 10).ok).toBe(false)
    expect(checkDurations(shots(12, 3), 15).ok).toBe(false)
    expect(checkDurations(shots(...Array(9).fill(2)), 18).ok).toBe(false)
  })
  it('handles half seconds without float noise', () => {
    expect(totalSeconds(shots(2.5, 2.5, 5.1, 4.9))).toBe(15)
  })
  it('even splits always sum to the target', () => {
    for (const t of [10, 15, 20]) expect(splitTarget(t).reduce((a, b) => a + b, 0)).toBe(t)
  })
})

describe('ids', () => {
  it('are prefixed ULIDs per common.schema.json', () => {
    for (const p of ['job', 'ref', 'node', 'shot', 'frame', 'take', 'rev', 'pin'] as const) expect(newId(p)).toMatch(ID_PATTERN)
  })
})

describe('box masks', () => {
  it('covers the box in whole pixels, inside the image', () => {
    expect(boxPixels({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 }, 720, 1280)).toEqual({ x: 72, y: 320, w: 360, h: 640 })
    expect(boxPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 })
    expect(boxPixels({ x: 0.5, y: 0.5, w: 0, h: 0 }, 100, 100)).toEqual({ x: 50, y: 50, w: 1, h: 1 })
  })
})
