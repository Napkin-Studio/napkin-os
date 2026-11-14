// Where a record really lies on the canvas (features/canvas-nodes.clan): its box turned by its
// rotation about its centre, and for a photo in a stack its white edge too. The selection's frame,
// the renderer's index and the link ends all read it, so a turned pile is enclosed corners and all.

import type { ElementRecord } from './records'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The white edge round a photo in a stack (the renderer draws it; web canvas/nodes/stack.ts piles them). */
export function photoEdge(r: Pick<ElementRecord, 'kind' | 'w' | 'h' | 'props'>): number {
  return r.kind === 'image' && r.props.stack ? Math.max(4, Math.min(Math.abs(r.w), Math.abs(r.h)) * 0.03) : 0
}

/** The axis-aligned box round a record as drawn: turned about its centre, with a stacked photo's edge. */
export function recordBounds(r: Pick<ElementRecord, 'kind' | 'x' | 'y' | 'w' | 'h' | 'rotation' | 'props'>): Rect {
  const e = photoEdge(r)
  const x0 = Math.min(r.x, r.x + r.w) - e
  const y0 = Math.min(r.y, r.y + r.h) - e
  const w = Math.abs(r.w) + e * 2
  const h = Math.abs(r.h) + e * 2
  const a = r.rotation || 0
  if (!a) return { x: x0, y: y0, w, h }
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  const W = w * c + h * s
  const H = w * s + h * c
  return { x: x0 + w / 2 - W / 2, y: y0 + h / 2 - H / 2, w: W, h: H }
}

/** The box round some boxes. */
export function unionRects(rs: readonly Rect[]): Rect {
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rs) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
