// Where a bound link runs (features/canvas-nodes.clan; overhaul plan 2.3): from
// its source's output edge to its target's input edge, computed from the ends'
// boxes every time it is drawn or hit, so a link follows a moved node and its
// stored geometry never goes stale. Right to left when the target is beside the
// source, bottom to top when it is below.

import type { ElementRecord, Plain } from '../model/records'
import type { SceneStore } from '../model/store'

interface Pt {
  x: number
  y: number
}

const endId = (b: Plain | undefined): string | null =>
  b && typeof b === 'object' && !Array.isArray(b) && typeof b.elementId === 'string' ? b.elementId : null

/** The ends a link or arrow is bound to, when both are on the canvas. */
export function boundEnds(get: (id: string) => ElementRecord | undefined, r: ElementRecord): { from: ElementRecord; to: ElementRecord } | null {
  if (r.kind !== 'link' && r.kind !== 'arrow') return null
  const a = endId(r.props.start)
  const b = endId(r.props.end)
  const from = a ? get(a) : undefined
  const to = b ? get(b) : undefined
  return from && to ? { from, to } : null
}

/** The segment a bound link draws: the source's output edge to the target's input edge. */
export function linkSegment(from: ElementRecord, to: ElementRecord): { a: Pt; b: Pt } {
  // Where the ends overlap across the line, it runs straight, through the middle of the overlap (mock Main).
  const mid = (a0: number, a1: number, b0: number, b1: number, own: number, their: number) => {
    const lo = Math.max(a0, b0)
    const hi = Math.min(a1, b1)
    return hi > lo ? [(lo + hi) / 2, (lo + hi) / 2] : [own, their]
  }
  const below = to.y >= from.y + from.h && to.x < from.x + from.w && to.x + to.w > from.x
  if (below) {
    const [ax, bx] = mid(from.x, from.x + from.w, to.x, to.x + to.w, from.x + from.w / 2, to.x + to.w / 2)
    return { a: { x: ax, y: from.y + from.h }, b: { x: bx, y: to.y } }
  }
  const right = to.x >= from.x + from.w / 2
  const [ay, by] = mid(from.y, from.y + from.h, to.y, to.y + to.h, from.y + from.h / 2, to.y + to.h / 2)
  return right
    ? { a: { x: from.x + from.w, y: ay }, b: { x: to.x, y: by } }
    : { a: { x: from.x, y: ay }, b: { x: to.x + to.w, y: by } }
}

/** Distance from p to the segment a-b. */
export function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** A board by its title band (just above its frame, where the title is drawn): how a board is picked up. */
export function hitBoardTitle(scene: Pick<SceneStore, 'all'>, p: Pt, zoom: number): ElementRecord | undefined {
  const band = 28 / zoom
  return scene.all()
    .filter((r) => r.kind === 'board' && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y - band && p.y <= r.y + 4 / zoom)
    .sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))[0]
}

/** The topmost node or bound link at a scene point (nodes are DOM cards above the canvas). */
export function hitNodeOrLink(scene: Pick<SceneStore, 'all' | 'get'>, p: Pt, zoom: number): ElementRecord | undefined {
  const all = scene.all().sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))
  const node = all.find((r) => r.kind === 'node' && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h)
  if (node) return node
  const get = (id: string) => scene.get(id)
  return all.find((r) => {
    if (r.kind !== 'link') return false
    const ends = boundEnds(get, r)
    if (!ends) return false
    const s = linkSegment(ends.from, ends.to)
    return toSegment(p, s.a, s.b) <= 6 / zoom
  })
}
