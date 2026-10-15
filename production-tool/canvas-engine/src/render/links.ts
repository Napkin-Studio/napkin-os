// Where a bound link runs (features/canvas-nodes.clan; overhaul plan 2.3; ui-behaviour 3.4): from
// the edge port of its source nearest the target to the facing edge of its target, computed from the
// ends' boxes every time it is drawn or hit, so a link follows a moved node and its stored geometry
// never goes stale.
//
// - An end that is a group (the link's binding names it: a key link from a character's views) or a
//   picture in a stack attaches at the group's or pile's outer bounds, rotated corners included.
// - The line is a gentle curve. Where that curve would cross a picture, a card or a sketch area, it
//   goes round them instead: an elbow above or below (left or right of) what is in the way, with
//   rounded corners. Deterministic and cheap: a few boxes tested against a few segments.
// - Links are drawn under pictures, cards and sketch areas (the renderer's pass order), never over
//   their content, and two links between the same group and target are drawn as one.

import type { ElementRecord, Plain } from '../model/records'
import type { SceneStore } from '../model/store'
import { recordBounds, unionRects, type Rect } from '../model/bounds'

interface Pt {
  x: number
  y: number
}

export type Side = 'left' | 'right' | 'top' | 'bottom'

const bindingOf = (b: Plain | undefined): { elementId: string; group?: string } | null =>
  b && typeof b === 'object' && !Array.isArray(b) && typeof b.elementId === 'string'
    ? { elementId: b.elementId, ...(typeof b.group === 'string' ? { group: b.group } : {}) }
    : null

/** The ends a link or arrow is bound to, when both are on the canvas. */
export function boundEnds(get: (id: string) => ElementRecord | undefined, r: ElementRecord): { from: ElementRecord; to: ElementRecord } | null {
  if (r.kind !== 'link' && r.kind !== 'arrow') return null
  const a = bindingOf(r.props.start)
  const b = bindingOf(r.props.end)
  const from = a ? get(a.elementId) : undefined
  const to = b ? get(b.elementId) : undefined
  return from && to ? { from, to } : null
}

/** What the routing reads of the scene. */
export interface LinkEnv {
  get(id: string): ElementRecord | undefined
  /** The records in a group. */
  members(groupId: string): readonly ElementRecord[]
  /** The records whose bounds meet a box (the routing keeps the ones that block). */
  obstacles(box: Rect): readonly ElementRecord[]
  /** A record where it is drawn now (offset while dragged); itself by default. */
  at?(r: ElementRecord): ElementRecord
}

/** What blocks a link's line: pictures, node cards and sketch areas. */
export const BLOCKS = new Set<string>(['image', 'node', 'sketch'])

/**
 * The group an end of a link attaches by: the group its binding names (a key link from a character's
 * views), else, for a picture in a stack, its outermost group (the pile). Null: the element itself.
 */
export function endGroup(env: Pick<LinkEnv, 'members'>, link: ElementRecord, el: ElementRecord, which: 'start' | 'end'): string | null {
  const named = bindingOf(link.props[which])?.group
  if (named && env.members(named).length) return named
  if (el.props.stack && el.groupIds.length) return el.groupIds[el.groupIds.length - 1]
  return null
}

/** The box an end attaches at: its group's or pile's outer bounds, or its own, as drawn. */
export function endBox(env: Pick<LinkEnv, 'members' | 'at'>, el: ElementRecord, group: string | null): Rect {
  const at = env.at ?? ((r: ElementRecord) => r)
  if (!group) return recordBounds(at(el))
  return unionRects(env.members(group).map((m) => recordBounds(at(m))))
}

/**
 * The ports a link runs between: on the source's edge nearest the target and the target's edge facing
 * it. Beside each other (the wider gap is across): right edge to left edge, or left to right; above or
 * below: bottom to top, or top to bottom. Where the ends overlap across the line, it runs through the
 * middle of the overlap (mock Main); otherwise from each edge's middle.
 */
export function linkPorts(from: Rect, to: Rect): { a: Pt; b: Pt; sa: Side; sb: Side } {
  const mid = (a0: number, a1: number, b0: number, b1: number, own: number, their: number) => {
    const lo = Math.max(a0, b0)
    const hi = Math.min(a1, b1)
    return hi > lo ? [(lo + hi) / 2, (lo + hi) / 2] : [own, their]
  }
  const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w))
  const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h))
  if (gapY > 0 && gapY > gapX) {
    const [ax, bx] = mid(from.x, from.x + from.w, to.x, to.x + to.w, from.x + from.w / 2, to.x + to.w / 2)
    return to.y >= from.y + from.h
      ? { a: { x: ax, y: from.y + from.h }, b: { x: bx, y: to.y }, sa: 'bottom', sb: 'top' }
      : { a: { x: ax, y: from.y }, b: { x: bx, y: to.y + to.h }, sa: 'top', sb: 'bottom' }
  }
  const right = to.x + to.w / 2 >= from.x + from.w / 2
  const [ay, by] = mid(from.y, from.y + from.h, to.y, to.y + to.h, from.y + from.h / 2, to.y + to.h / 2)
  return right
    ? { a: { x: from.x + from.w, y: ay }, b: { x: to.x, y: by }, sa: 'right', sb: 'left' }
    : { a: { x: from.x, y: ay }, b: { x: to.x + to.w, y: by }, sa: 'left', sb: 'right' }
}

/** The segment a bound link's ports make: the source's edge nearest the target to the target's facing edge. */
export function linkSegment(from: Rect, to: Rect): { a: Pt; b: Pt } {
  const { a, b } = linkPorts(from, to)
  return { a, b }
}

const NORMAL: Record<Side, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }
/** How far a detour keeps clear of what it goes round, and how far it leaves its ports straight. */
const CLEAR = 18
const STUB = 22
const CORNER = 14
/** How many times a detour widens to take in what it newly runs into. */
const TRIES = 4

const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 })
const inside = (p: Pt, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h

/** Does the segment p-q cross the rectangle (Liang–Barsky)? */
export function segmentHits(p: Pt, q: Pt, r: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  const clip = (den: number, num: number) => {
    if (den === 0) return num >= 0
    const t = num / den
    if (den < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  return clip(-dx, p.x - r.x) && clip(dx, r.x + r.w - p.x) && clip(-dy, p.y - r.y) && clip(dy, r.y + r.h - p.y) && t1 > t0
}

const pathHits = (pts: readonly Pt[], boxes: readonly Rect[]): number[] => {
  const out: number[] = []
  boxes.forEach((b, i) => {
    for (let k = 1; k < pts.length; k++) if (segmentHits(pts[k - 1], pts[k], b)) return void out.push(i)
  })
  return out
}

const lengthOf = (pts: readonly Pt[]) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)

/** A gentle curve from a to b, leaving and arriving along the ports' normals, as a polyline. */
export function gentleCurve(a: Pt, sa: Side, b: Pt, sb: Side, steps = 16): Pt[] {
  const na = NORMAL[sa]
  const nb = NORMAL[sb]
  // Already in line: a straight line needs no samples.
  if ((Math.abs(a.y - b.y) < 0.5 && na.y === 0 && nb.y === 0) || (Math.abs(a.x - b.x) < 0.5 && na.x === 0 && nb.x === 0)) return [a, b]
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.min(120, Math.max(16, d * 0.3))
  const c1 = { x: a.x + na.x * k, y: a.y + na.y * k }
  const c2 = { x: b.x + nb.x * k, y: b.y + nb.y * k }
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    })
  }
  return out
}

/** A polyline with its corners rounded (each turned by a short quadratic, as a few points). */
export function roundCorners(pts: readonly Pt[], radius = CORNER): Pt[] {
  if (pts.length < 3) return [...pts]
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]
    const c = pts[i]
    const n = pts[i + 1]
    const l1 = Math.hypot(c.x - p.x, c.y - p.y)
    const l2 = Math.hypot(n.x - c.x, n.y - c.y)
    const r = Math.min(radius, l1 / 2, l2 / 2)
    if (r < 0.5) {
      out.push(c)
      continue
    }
    const s = { x: c.x + ((p.x - c.x) / l1) * r, y: c.y + ((p.y - c.y) / l1) * r }
    const e = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r }
    for (let k = 0; k <= 4; k++) {
      const t = k / 4
      const u = 1 - t
      out.push({ x: u * u * s.x + 2 * u * t * c.x + t * t * e.x, y: u * u * s.y + 2 * u * t * c.y + t * t * e.y })
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** An elbow from a to b that crosses over at `at` (a y for side ports, an x for top and bottom ones). */
function elbow(a: Pt, sa: Side, b: Pt, sb: Side, at: number): Pt[] {
  const na = NORMAL[sa]
  const nb = NORMAL[sb]
  const p1 = { x: a.x + na.x * STUB, y: a.y + na.y * STUB }
  const p4 = { x: b.x + nb.x * STUB, y: b.y + nb.y * STUB }
  return na.y === 0
    ? [a, p1, { x: p1.x, y: at }, { x: p4.x, y: at }, p4, b]
    : [a, p1, { x: at, y: p1.y }, { x: at, y: p4.y }, p4, b]
}

const boxOfPts = (pts: readonly Pt[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/**
 * The line between two ports that keeps off the boxes `blockers` finds (a function from a search box
 * to the boxes there): the gentle curve when it is clear, else the shorter clear elbow round what is
 * in the way (above or below for side ports, left or right for top and bottom ones), else the elbow
 * that crosses least. Boxes a port is inside never count (the ends' own).
 */
export function routeBetween(a: Pt, sa: Side, b: Pt, sb: Side, blockers: (box: Rect) => readonly Rect[]): Pt[] {
  const near = (box: Rect) => blockers(inflate(box, CLEAR)).map((r) => inflate(r, 6)).filter((r) => !inside(a, r) && !inside(b, r))
  const curve = gentleCurve(a, sa, b, sb)
  const around = near(boxOfPts(curve))
  const first = pathHits(curve, around)
  if (!first.length) return curve
  const sideways = NORMAL[sa].y === 0
  let best: { pts: Pt[]; hits: number; len: number } | null = null
  for (const dir of [-1, 1]) {
    let block = first.map((i) => around[i])
    let pts: Pt[] = curve
    let hits = first.length
    for (let t = 0; t < TRIES; t++) {
      const u = unionRects(block)
      const at = sideways ? (dir < 0 ? u.y - CLEAR : u.y + u.h + CLEAR) : (dir < 0 ? u.x - CLEAR : u.x + u.w + CLEAR)
      pts = elbow(a, sa, b, sb, at)
      const there = near(boxOfPts(pts))
      const hit = pathHits(pts, there).map((i) => there[i])
      hits = hit.length
      if (!hits) break
      const more = hit.filter((h) => !block.some((k) => sameRect(k, h)))
      if (!more.length) break
      block = [...block, ...more]
    }
    const len = lengthOf(pts)
    if (!best || hits < best.hits || (hits === best.hits && len < best.len)) best = { pts, hits, len }
  }
  return roundCorners(best!.pts)
}

export interface LinkRoute {
  /** The line as drawn, port to port. */
  pts: Pt[]
  /** The group each end attaches by, or null. */
  fromGroup: string | null
  toGroup: string | null
  from: ElementRecord
  to: ElementRecord
}

/** Where a link runs now: its ends' ports (by group or pile when it has one) and the line between them. */
export function linkRoute(env: LinkEnv, link: ElementRecord): LinkRoute | null {
  const ends = boundEnds((id) => env.get(id), link)
  if (!ends) return null
  const fromGroup = endGroup(env, link, ends.from, 'start')
  const toGroup = endGroup(env, link, ends.to, 'end')
  // Both ends in one pile (a picture and what was made from it, stacked together): nothing to draw between.
  if (fromGroup && fromGroup === toGroup) return null
  const fb = endBox(env, ends.from, fromGroup)
  const tb = endBox(env, ends.to, toGroup)
  const { a, b, sa, sb } = linkPorts(fb, tb)
  // Never a line to nowhere: an end with no finite place draws nothing.
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null
  // The ends (and their groups) never block their own link.
  const own = new Set<string>([ends.from.id, ends.to.id])
  for (const g of [fromGroup, toGroup]) if (g) for (const m of env.members(g)) own.add(m.id)
  const at = env.at ?? ((r: ElementRecord) => r)
  const pts = routeBetween(a, sa, b, sb, (box) => env.obstacles(box).filter((r) => !own.has(r.id) && BLOCKS.has(r.kind)).map((r) => recordBounds(at(r))))
  return { pts, fromGroup, toGroup, from: ends.from, to: ends.to }
}

/** The key two links share when they are drawn as one: the same group (or element) to the same target. */
export const routeKey = (r: Pick<LinkRoute, 'from' | 'to' | 'fromGroup' | 'toGroup'>) => `${r.fromGroup ?? r.from.id}>${r.toGroup ?? r.to.id}`

/** Distance from p to the segment a-b. */
export function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Distance from p to a polyline. */
export function toPolyline(p: Pt, pts: readonly Pt[]): number {
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, toSegment(p, pts[i - 1], pts[i]))
  return d
}

/** The point halfway along a polyline (where a link's role pill sits). */
export function midway(pts: readonly Pt[]): Pt {
  const half = lengthOf(pts) / 2
  let run = 0
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (run + l >= half && l > 0) {
      const t = (half - run) / l
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    run += l
  }
  return pts[0]
}

/** A link environment over a whole scene (the hit test's; the renderer keeps its own index). */
export function sceneLinkEnv(scene: Pick<SceneStore, 'all' | 'get'>): LinkEnv {
  const all = scene.all()
  const groups = new Map<string, ElementRecord[]>()
  for (const r of all) for (const g of r.groupIds) groups.set(g, [...(groups.get(g) ?? []), r])
  const blocks = all.filter((r) => BLOCKS.has(r.kind)).map((r) => ({ r, b: recordBounds(r) }))
  return {
    get: (id) => scene.get(id),
    members: (g) => groups.get(g) ?? [],
    obstacles: (box) => blocks.filter(({ b }) => b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y).map(({ r }) => r),
  }
}

/** The topmost node or bound link at a scene point (nodes are DOM cards above the canvas). */
export function hitNodeOrLink(scene: Pick<SceneStore, 'all' | 'get'>, p: Pt, zoom: number): ElementRecord | undefined {
  const all = scene.all().sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))
  const node = all.find((r) => r.kind === 'node' && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h)
  if (node) return node
  // Links, and bound arrows (a generation's provenance arrow), along the line they are drawn on; one
  // with no line (both ends in one pile) cannot be hit at all.
  const follows = (r: ElementRecord) => r.kind === 'link' || (r.kind === 'arrow' && !!boundEnds((id) => scene.get(id), r))
  if (!all.some(follows)) return undefined
  const env = sceneLinkEnv(scene)
  return all.find((r) => {
    if (!follows(r)) return false
    const route = linkRoute(env, r)
    return !!route && toPolyline(p, route.pts) <= 6 / zoom
  })
}
