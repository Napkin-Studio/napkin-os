// Stroke points as bytes (features/engine-foundation.clan): 5 bytes a point,
// within 0.05 px after a round trip however long the stroke, and steps past the
// Int16 range split.

import { describe, expect, it } from 'vitest'
import { BYTES_PER_POINT, decodePoints, encodePoints, localPoints, pointCount, type InkPoint } from '../src/model/points'

/** A seeded random walk (mulberry32), so the test is the same every run. */
function walk(n: number, seed = 1): InkPoint[] {
  let a = seed
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out: InkPoint[] = []
  let x = 123.456
  let y = -78.9
  for (let i = 0; i < n; i++) {
    x += (rnd() - 0.5) * 7.3
    y += (rnd() - 0.5) * 7.3
    out.push({ x, y, pressure: rnd() })
  }
  return out
}

describe('stroke points', () => {
  it('are 5 bytes a point', () => {
    const pts = walk(60)
    const b = encodePoints(pts, { x: 100, y: -80 })
    expect(BYTES_PER_POINT).toBe(5)
    expect(b.length).toBe(60 * 5)
    expect(pointCount(b)).toBe(60)
  })

  it('round-trip within 0.05 px over 2,000 points (no drift), pressure within one step', () => {
    const pts = walk(2000)
    const origin = { x: 120.03, y: -77.77 }
    const back = decodePoints(encodePoints(pts, origin), origin)
    expect(back).toHaveLength(pts.length)
    let worst = 0
    pts.forEach((p, i) => {
      worst = Math.max(worst, Math.abs(p.x - back[i].x), Math.abs(p.y - back[i].y))
      expect(Math.abs(p.pressure - back[i].pressure)).toBeLessThanOrEqual(0.5 / 255 + 1e-9)
    })
    expect(worst).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  it('split a step past Int16 (3,276.7 px) into points along it', () => {
    const pts = [{ x: 0, y: 0, pressure: 0.5 }, { x: 10000, y: -5000, pressure: 0.5 }]
    const b = encodePoints(pts, { x: 0, y: 0 })
    const back = decodePoints(b, { x: 0, y: 0 })
    expect(back.length).toBe(5) // 1 + ceil(100000 / 32767) = 1 + 4
    expect(back.at(-1)).toMatchObject({ x: 10000, y: -5000 })
    for (let i = 1; i < back.length; i++) expect(Math.abs(back[i].x - back[i - 1].x)).toBeLessThanOrEqual(3276.7)
  })

  it('move with the element: decoded against a new origin, the stroke shifts by the move', () => {
    const pts = walk(10)
    const b = encodePoints(pts, { x: 100, y: 100 })
    const moved = decodePoints(b, { x: 150, y: 90 })
    const local = localPoints(b)
    moved.forEach((p, i) => {
      expect(p.x - local[i].x).toBeCloseTo(150, 5)
      expect(p.y - local[i].y).toBeCloseTo(90, 5)
    })
  })

  it('refuses bytes that are not whole points', () => {
    expect(() => decodePoints(new Uint8Array(7), { x: 0, y: 0 })).toThrow(/5 bytes/)
  })
})
