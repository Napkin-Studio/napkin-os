// A precise hit for things drawn as lines (features/container-select.clan, phase 1):
// a stroke, or a shape with no fill, is hit only near its line, measured to its
// segments, not anywhere in its box. Its reach is half its width plus a fixed slop in
// screen pixels, so it is as easy to pick at any zoom. The eraser uses the same
// distance with its own radius.

import { localPoints, strokeScale } from '../model/points'
import type { ElementRecord } from '../model/records'

/** How far beyond its half-width a line is still hit, in screen pixels. */
export const HIT_SLOP_PX = 6

/** A stroke's width when its record names none (what the renderer draws). */
const STROKE_WIDTH = 4
/** A shape's line width when its record names none. */
const SHAPE_WIDTH = 2
/** Segments an ellipse outline is measured against. */
const ELLIPSE_STEPS = 64

type Pt = { x: number; y: number }

/** Distance from p to the segment a-b (scene units). */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Distance from p to a polyline (one point counts as a dot). */
function distToPolyline(p: Pt, line: Pt[]): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return Math.hypot(p.x - line[0].x, p.y - line[0].y)
  let d = Infinity
  for (let i = 1; i < line.length; i++) d = Math.min(d, distToSegment(p, line[i - 1], line[i]))
  return d
}

/** A stroke's centreline where it is drawn: its points, scaled by the handles, at its origin. */
export function strokeLine(r: Pick<ElementRecord, 'x' | 'y' | 'w' | 'h'>, pts: Uint8Array): Pt[] {
  const { sx, sy } = strokeScale(r, pts)
  return localPoints(pts).map((q) => ({ x: r.x + q.x * sx, y: r.y + q.y * sy }))
}

/** Distance from p to a stroke's centreline (scene units). */
export function strokeDistance(r: Pick<ElementRecord, 'x' | 'y' | 'w' | 'h'>, pts: Uint8Array, p: Pt): number {
  return distToPolyline(p, strokeLine(r, pts))
}

/** A shape's outline as closed or open polylines (scene units), as the renderer draws it. */
function shapeOutline(r: ElementRecord): Pt[] {
  const { x, y, w, h } = r
  switch (r.props.geo) {
    case 'line':
      return [{ x, y }, { x: x + w, y: y + h }]
    case 'diamond':
      return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }, { x: x + w / 2, y }]
    case 'ellipse': {
      const cx = x + w / 2, cy = y + h / 2, rx = Math.abs(w / 2), ry = Math.abs(h / 2)
      return Array.from({ length: ELLIPSE_STEPS + 1 }, (_, i) => {
        const t = (i / ELLIPSE_STEPS) * Math.PI * 2
        return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }
      })
    }
    default:
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]
  }
}

/** Is this record drawn as a line (a stroke, or a shape with no fill), so it is hit only along it? */
export function isLineDrawn(r: ElementRecord): boolean {
  if (r.kind === 'stroke') return true
  if (r.kind !== 'shape') return false
  const fill = r.style.fill
  return r.props.geo === 'line' || !fill || fill === 'transparent'
}

/** How far from its line a line-drawn record is hit, in scene units, at this zoom. */
export function lineReach(r: ElementRecord, zoom: number): number {
  const width = typeof r.style.width === 'number' ? r.style.width : r.kind === 'stroke' ? STROKE_WIDTH : SHAPE_WIDTH
  return width / 2 + HIT_SLOP_PX / (zoom > 0 ? zoom : 1)
}

/**
 * Is a line-drawn record hit at p? Strokes need their points (`pts`); a shape uses its box.
 * `reach` is in scene units (lineReach for a click, the eraser's radius for the eraser).
 */
export function hitsLine(r: ElementRecord, pts: Uint8Array | undefined, p: Pt, reach: number): boolean {
  // Cheap reject: outside the box grown by the reach.
  const x0 = Math.min(r.x, r.x + r.w), y0 = Math.min(r.y, r.y + r.h)
  if (p.x < x0 - reach || p.y < y0 - reach || p.x > x0 + Math.abs(r.w) + reach || p.y > y0 + Math.abs(r.h) + reach) return false
  if (r.kind === 'stroke') return !!pts && strokeDistance(r, pts, p) <= reach
  return distToPolyline(p, shapeOutline(r)) <= reach
}
