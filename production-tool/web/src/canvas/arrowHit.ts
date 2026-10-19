// Which provenance arrow is under the pointer (features/canvas-arrow-cards.clan).
// Excalidraw has no per-element hover, so the canvas tracks the pointer and asks
// this: the nearest provenance arrow whose drawn curve passes within `px` screen
// pixels. Pure maths over plain element fields, no Excalidraw import.

export type Pt = { x: number; y: number }

/** The fields of an arrow element this reads. */
export interface ArrowLike {
  id: string
  type: string
  x: number
  y: number
  points: readonly (readonly [number, number])[]
  isDeleted?: boolean
  customData?: unknown
}

export interface ProvenanceOf { from: string; to: string }

/** The arrow's provenance link, when it is one of the tool's arrows. */
export function provenanceOf(el: { type: string; customData?: unknown }): ProvenanceOf | undefined {
  const c = el.customData as { kind?: string; from?: unknown; to?: unknown } | undefined
  if (el.type !== 'arrow' || !c || c.kind !== 'provenance' || typeof c.from !== 'string' || typeof c.to !== 'string') return undefined
  return { from: c.from, to: c.to }
}

/**
 * The arrow's path in scene coordinates, as drawn: three points are the curve that passes
 * through the middle one (the quadratic FlowArrows draws; makeArrow makes three), sampled;
 * any other count is the straight segments between them.
 */
export function arrowPath(a: Pick<ArrowLike, 'x' | 'y' | 'points'>, samples = 24): Pt[] {
  const pts = a.points.map(([x, y]) => ({ x: a.x + x, y: a.y + y }))
  if (pts.length !== 3) return pts
  const [p0, m, p2] = pts
  // The control point whose quadratic passes through m at t = 0.5.
  const c = { x: 2 * m.x - (p0.x + p2.x) / 2, y: 2 * m.y - (p0.y + p2.y) / 2 }
  const out: Pt[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const u = 1 - t
    out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y })
  }
  return out
}

/** Distance from p to the segment a-b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Distance from p to a path of points (a single point counts as a path too). */
export function distToPath(p: Pt, path: readonly Pt[]): number {
  if (!path.length) return Infinity
  if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y)
  let best = Infinity
  for (let i = 1; i < path.length; i++) best = Math.min(best, distToSegment(p, path[i - 1], path[i]))
  return best
}

/**
 * The provenance arrow under a scene point: the nearest one within `px` screen pixels of
 * its curve at this zoom (8 px is 4 scene units at 200 %, 16 at 50 %). Deleted arrows and
 * anything that is not the tool's provenance arrow are ignored.
 */
export function hitArrow<A extends ArrowLike>(els: readonly A[], scene: Pt, zoom: number, px = 8): A | undefined {
  const tol = px / (zoom > 0 ? zoom : 1)
  let best: A | undefined
  let bestD = Infinity
  for (const e of els) {
    if (e.isDeleted || !provenanceOf(e) || !e.points?.length) continue
    // Cheap reject: outside the points' box grown by the tolerance and the curve's bulge.
    const xs = e.points.map((p) => e.x + p[0])
    const ys = e.points.map((p) => e.y + p[1])
    const grow = tol + Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.5
    if (scene.x < Math.min(...xs) - grow || scene.x > Math.max(...xs) + grow || scene.y < Math.min(...ys) - grow || scene.y > Math.max(...ys) + grow) continue
    const d = distToPath(scene, arrowPath(e))
    if (d <= tol && d < bestD) {
      best = e
      bestD = d
    }
  }
  return best
}
