import { describe, expect, it } from 'vitest'
import { arrowPath, distToPath, distToSegment, hitArrow, provenanceOf, type ArrowLike } from './arrowHit'
import { curvePoints } from './curve'

const prov = { kind: 'provenance', from: 'node_a', to: 'job_b' }

/** A straight provenance arrow from (100,100) to (300,100). */
const straight = (id = 'a1', extra: Partial<ArrowLike> = {}): ArrowLike => ({
  id, type: 'arrow', x: 100, y: 100, points: [[0, 0], [100, 0], [200, 0]], customData: prov, ...extra,
})

/** A curved one, as makeArrow makes them: 200 across, bent by 0.15 of its length. */
const curved = (id = 'c1'): ArrowLike => ({
  id, type: 'arrow', x: 0, y: 0, points: curvePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 0.15), customData: prov,
})

describe('arrowHit: the provenance arrow under the pointer', () => {
  it('reads only the tool\'s provenance arrows', () => {
    expect(provenanceOf(straight())).toEqual({ from: 'node_a', to: 'job_b' })
    expect(provenanceOf({ type: 'arrow' })).toBeUndefined()
    expect(provenanceOf({ type: 'line', customData: prov })).toBeUndefined()
    expect(provenanceOf({ type: 'arrow', customData: { kind: 'gen', id: 'x' } })).toBeUndefined()
  })

  it('measures distance to a segment, clamped to its ends', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distToPath({ x: 1, y: 1 }, [])).toBe(Infinity)
  })

  it('follows the curve through the middle point, not the chord', () => {
    const a = curved()
    const path = arrowPath(a)
    expect(path[0]).toEqual({ x: 0, y: 0 })
    expect(path.at(-1)).toEqual({ x: 200, y: 0 })
    const mid = { x: a.points[1][0], y: a.points[1][1] }
    // The curve passes through the middle point (30 off the chord) …
    expect(distToPath(mid, path)).toBeLessThan(0.5)
    // … so a point on the chord's middle is far from it.
    expect(distToPath({ x: 100, y: 0 }, path)).toBeGreaterThan(25)
  })

  it('hits on the line and near it, misses off it', () => {
    const els = [straight()]
    expect(hitArrow(els, { x: 200, y: 100 }, 1)?.id).toBe('a1')
    expect(hitArrow(els, { x: 200, y: 107 }, 1)?.id).toBe('a1')
    expect(hitArrow(els, { x: 200, y: 112 }, 1)).toBeUndefined()
    expect(hitArrow(els, { x: 320, y: 100 }, 1)).toBeUndefined()
  })

  it('scales the tolerance by zoom: 8 screen px is fewer scene units zoomed in', () => {
    const els = [straight()]
    expect(hitArrow(els, { x: 200, y: 106 }, 2)).toBeUndefined() // 6 scene units = 12 px at 200 %
    expect(hitArrow(els, { x: 200, y: 103 }, 2)?.id).toBe('a1')
    expect(hitArrow(els, { x: 200, y: 114 }, 0.5)?.id).toBe('a1') // 14 units = 7 px at 50 %
  })

  it('picks the nearest of two arrows, and skips deleted and foreign ones', () => {
    const lower = straight('a2', { y: 110 })
    expect(hitArrow([straight(), lower], { x: 200, y: 106 }, 1)?.id).toBe('a2')
    expect(hitArrow([straight(), { ...lower, isDeleted: true }], { x: 200, y: 106 }, 1)?.id).toBe('a1')
    expect(hitArrow([{ ...straight(), customData: undefined }], { x: 200, y: 100 }, 1)).toBeUndefined()
  })

  it('hits a curved arrow on its bulge', () => {
    const a = curved()
    expect(hitArrow([a], { x: a.points[1][0], y: a.points[1][1] + 4 }, 1)?.id).toBe('c1')
    expect(hitArrow([a], { x: 100, y: 0 }, 1)).toBeUndefined()
  })
})
