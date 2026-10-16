// The precise line hit (features/container-select.clan, phase 1): a stroke or an
// unfilled shape is hit only within half its width plus 6 screen px of its line,
// measured to its segments, at any zoom; a click in the gaps of a drawing falls
// through to its frame.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints, type InkPoint } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { distToSegment, HIT_SLOP_PX, hitsLine, isLineDrawn, lineReach, strokeDistance } from '../src/select/hitStroke'

const pt = (x: number, y: number): InkPoint => ({ x, y, pressure: 0.5 })
const enc = (pts: InkPoint[]) => encodePoints(pts, { x: 0, y: 0 })

/** A stroke record whose box is the extent of its (local) points times a scale. */
function stroke(id: string, x: number, y: number, local: InkPoint[], extra: Partial<ElementRecord> = {}, scale = 1) {
  const w = Math.max(...local.map((p) => p.x)) * scale
  const h = Math.max(...local.map((p) => p.y)) * scale
  return { rec: element({ id, kind: 'stroke', z: `b${id}`, x, y, w, h, style: { width: 4 }, props: { tool: 'pen' }, ...extra }), pts: enc(local) }
}

function renderer(records: ElementRecord[], points: Record<string, Uint8Array> = {}) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records, points)
  return new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
}

describe('distToSegment', () => {
  it('measures to the segment, its ends included', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3)
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5)
    expect(distToSegment({ x: 2, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(Math.SQRT2)
  })
})

describe('a stroke is hit only near its line', () => {
  it('a two-point stroke is hit mid-segment, far from either point', () => {
    const s = stroke('s', 0, 0, [pt(0, 0), pt(200, 100)])
    expect(strokeDistance(s.rec, s.pts, { x: 100, y: 50 })).toBeCloseTo(0)
    expect(hitsLine(s.rec, s.pts, { x: 100, y: 52 }, lineReach(s.rec, 1))).toBe(true)
  })

  it('inside a closed loop but off its line is a miss', () => {
    const loop = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 0)]
    const s = stroke('s', 0, 0, loop)
    const reach = lineReach(s.rec, 1)
    expect(hitsLine(s.rec, s.pts, { x: 50, y: 50 }, reach)).toBe(false)
    expect(hitsLine(s.rec, s.pts, { x: 50, y: 3 }, reach)).toBe(true)
  })

  it('a stroke scaled by the handles is measured where it is drawn', () => {
    // Points span 100 x 50; the record is drawn at twice that.
    const s = stroke('s', 10, 10, [pt(0, 0), pt(100, 50)], {}, 2)
    expect(strokeDistance(s.rec, s.pts, { x: 10 + 100, y: 10 + 50 })).toBeCloseTo(0)
    // The midpoint of the unscaled line is now off the drawn line.
    expect(strokeDistance(s.rec, s.pts, { x: 10 + 50, y: 10 + 40 })).toBeGreaterThan(10)
  })

  it('the reach is half the width plus 6 screen px, at zoom 0.25, 1 and 2', () => {
    const s = stroke('s', 0, 0, [pt(0, 0), pt(100, 0), pt(100, 1)])
    for (const zoom of [0.25, 1, 2]) {
      const reach = lineReach(s.rec, zoom)
      expect(reach).toBeCloseTo(2 + HIT_SLOP_PX / zoom)
      // Just inside and just outside, in scene units at this zoom.
      expect(hitsLine(s.rec, s.pts, { x: 50, y: reach - 0.01 }, reach)).toBe(true)
      expect(hitsLine(s.rec, s.pts, { x: 50, y: reach + 0.5 }, reach)).toBe(false)
    }
  })

  it('a highlighter’s width counts', () => {
    const s = stroke('h', 0, 0, [pt(0, 0), pt(100, 0), pt(100, 1)], { style: { width: 18 }, props: { tool: 'highlighter' } })
    const reach = lineReach(s.rec, 1)
    expect(reach).toBeCloseTo(9 + HIT_SLOP_PX)
    expect(hitsLine(s.rec, s.pts, { x: 50, y: 14 }, reach)).toBe(true)
  })
})

describe('shapes', () => {
  const rect = (fill?: string, geo = 'rect') => element({ id: 'r', kind: 'shape', z: 'ar', x: 0, y: 0, w: 100, h: 60, style: fill ? { fill, width: 2 } : { width: 2 }, props: { geo } })

  it('an unfilled shape is hit on its outline only; a filled one anywhere inside', () => {
    expect(isLineDrawn(rect())).toBe(true)
    expect(isLineDrawn(rect('transparent'))).toBe(true)
    expect(isLineDrawn(rect('#ffcc00'))).toBe(false)
    const r = rect()
    const reach = lineReach(r, 1)
    expect(hitsLine(r, undefined, { x: 50, y: 30 }, reach)).toBe(false)
    expect(hitsLine(r, undefined, { x: 50, y: 2 }, reach)).toBe(true)
    expect(hitsLine(r, undefined, { x: 98, y: 30 }, reach)).toBe(true)
  })

  it('an unfilled ellipse and diamond are hit along their outlines', () => {
    for (const geo of ['ellipse', 'diamond']) {
      const r = rect(undefined, geo)
      const reach = lineReach(r, 1)
      expect(hitsLine(r, undefined, { x: 50, y: 30 }, reach)).toBe(false)
      expect(hitsLine(r, undefined, { x: 50, y: 1 }, reach)).toBe(true)
    }
  })
})

describe('Renderer.hit', () => {
  it('a click in the gaps of a drawing falls through to its frame; on a stroke it hits the stroke', () => {
    const frame = element({ id: 'f', kind: 'frame', z: 'a1', x: 0, y: 0, w: 300, h: 300, props: { name: 'Drawing' } })
    // A stick figure's body: a vertical line, inside the frame and above it in z.
    const body = stroke('s', 140, 50, [pt(0, 0), pt(0, 200), pt(20, 200)], { parentId: 'f', z: 'a2' })
    const r = renderer([frame, body.rec], { s: body.pts })
    expect(r.hit(140, 150)?.id).toBe('s')
    expect(r.hit(200, 150)?.id).toBe('f')
    // In the stroke's box but off its line.
    expect(r.hit(155, 100)?.id).toBe('f')
  })

  it('a horizontal line one pixel tall is hit within its reach, which grows when zoomed out', () => {
    const s = stroke('s', 0, 100, [pt(0, 0), pt(200, 0), pt(200, 1)])
    const r = renderer([s.rec], { s: s.pts })
    // Width 4: reach 2 + 6 = 8 scene px at zoom 1, 2 + 12 = 14 at zoom 0.5.
    expect(r.hit(100, 107, 1)?.id).toBe('s')
    expect(r.hit(100, 109, 1)).toBeUndefined()
    expect(r.hit(100, 113, 0.5)?.id).toBe('s')
    expect(r.hit(100, 115, 0.5)).toBeUndefined()
  })
})
