// Board sizing (owner decision, Shrey 2026-10-15; features/art-boards.clan): pure geometry on
// boxes, shared by the select tool (moves, resize, Fit to contents) and the web's placements
// (dropped pictures, + Node, generated pictures, new key views).
//
// - A board is a space. What lands on it goes in the next free slot: contact-sheet rows, BOARD_PAD in
//   from its edges, BOARD_GAP between things, never over what is already there.
// - It grows to fit what is placed in it, toward free canvas: down first, then right. It never moves or
//   covers another board (or loose things on the canvas); when both ways are blocked it does not grow,
//   and the thing lands at the nearest free spot just outside instead (`full`).
// - It never shrinks by itself. fitRect is Fit to contents; resizeRect is a handle's drag, which never
//   cuts through a member: an edge stops at the members whose centre is still inside, and the ones whose
//   centre it passed leave the board.

import RBush from 'rbush'
import { unionRects, type Rect } from '../model/bounds'

/** A board's inner margin: 16 at the sides, 22 under the title, 34 at the foot (room for a name chip). */
export const BOARD_PAD = { x: 16, top: 22, bottom: 34 } as const
/** The gap between things on a board, both ways (a picture's name chip fits under it). */
export const BOARD_GAP = 40
/** How close a growing board may come to a neighbour. */
export const BOARD_CLEAR = 24
/** A board is never smaller than this. */
export const BOARD_MIN = { w: 160, h: 120 } as const

const EPS = 1e-6

export const rightOf = (r: Rect) => r.x + r.w
export const bottomOf = (r: Rect) => r.y + r.h
const centreOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Do two boxes overlap, or come closer than `margin`? */
export function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  const m = margin - EPS
  return a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m
}

/** Is `r` inside `outer`? */
export function containsRect(outer: Rect, r: Rect): boolean {
  return r.x >= outer.x - EPS && r.y >= outer.y - EPS && rightOf(r) <= rightOf(outer) + EPS && bottomOf(r) <= bottomOf(outer) + EPS
}

/** Where things may go on a board: its box less its padding. */
export function innerRect(board: Rect): Rect {
  return { x: board.x + BOARD_PAD.x, y: board.y + BOARD_PAD.top, w: board.w - BOARD_PAD.x * 2, h: board.h - BOARD_PAD.top - BOARD_PAD.bottom }
}

/** The board box that holds `r` with the padding round it. */
export function aroundRect(r: Rect): Rect {
  return { x: r.x - BOARD_PAD.x, y: r.y - BOARD_PAD.top, w: r.w + BOARD_PAD.x * 2, h: r.h + BOARD_PAD.top + BOARD_PAD.bottom }
}

/** Is `r` at least BOARD_GAP from every box in `occupied`? */
export const clearOf = (r: Rect, occupied: readonly Rect[], gap: number = BOARD_GAP) => !occupied.some((o) => overlaps(r, o, gap))

/** How far apart two boxes are: the larger of the gaps across and down (negative when they overlap). */
export function distance(a: Rect, b: Rect): number {
  const gx = Math.max(b.x - rightOf(a), a.x - rightOf(b))
  const gy = Math.max(b.y - bottomOf(a), a.y - bottomOf(b))
  return Math.max(gx, gy)
}

/**
 * Would the board, grown to `grown`, come within BOARD_CLEAR of a blocker, and nearer than it was? (A
 * neighbour it already sits close to does not stop it growing the other way.)
 */
export function growthBlocked(board: Rect, grown: Rect, blockers: readonly Rect[]): boolean {
  return blockers.some((b) => {
    const d = distance(grown, b)
    return d < BOARD_CLEAR - EPS && d < distance(board, b) - EPS
  })
}

/**
 * The next free slot of `size` in rows (contact sheet), between x0 and x1, from y0 down to yMax: each row
 * left to right, after what is in it; the next row below everything in this one. Null when none fits.
 */
export function rowSlot(occupied: readonly Rect[], size: { w: number; h: number }, x0: number, x1: number, y0: number, yMax = Infinity): { x: number; y: number } | null {
  if (size.w > x1 - x0 + EPS) return null
  let y = y0
  for (let guard = 0; guard < 1000; guard++) {
    if (y + size.h > yMax + EPS) return null
    const band = occupied.filter((o) => o.y < y + size.h + BOARD_GAP - EPS && bottomOf(o) + BOARD_GAP > y + EPS)
    const xs = [x0, ...band.map((o) => rightOf(o) + BOARD_GAP)].filter((x) => x >= x0 - EPS).sort((a, b) => a - b)
    for (const x of xs) {
      if (x + size.w > x1 + EPS) break
      if (clearOf({ x, y, ...size }, occupied)) return { x, y }
    }
    if (!band.length) return null
    y = Math.max(...band.map((o) => bottomOf(o) + BOARD_GAP))
  }
  return null
}

/**
 * The nearest free spot of `size` just outside the board: on any side, BOARD_CLEAR out at least, slid
 * along the side or further out as little as it takes to be clear of `avoid` (by half a gap). Ties go
 * below, then right, left, above.
 */
export function outsideSpot(board: Rect, size: { w: number; h: number }, avoid: readonly Rect[]): { x: number; y: number } {
  const step = BOARD_GAP / 2
  const sides = [
    (out: number, t: number) => ({ x: board.x + t, y: bottomOf(board) + out }),
    (out: number, t: number) => ({ x: rightOf(board) + out, y: board.y + t }),
    (out: number, t: number) => ({ x: board.x - out - size.w, y: board.y + t }),
    (out: number, t: number) => ({ x: board.x + t, y: board.y - out - size.h }),
  ]
  const tries: { at: { x: number; y: number }; cost: number; side: number }[] = []
  for (let k = 0; k <= 60; k++) {
    for (let j = -30; j <= 30; j++) {
      const t = j * step
      sides.forEach((at, side) => tries.push({ at: at(BOARD_CLEAR + k * step, t), cost: k * step + Math.abs(t) * 0.5, side }))
    }
  }
  tries.sort((a, b) => a.cost - b.cost || a.side - b.side)
  for (const t of tries) {
    const r = { ...t.at, ...size }
    if (!overlaps(r, board, BOARD_CLEAR) && !avoid.some((a) => overlaps(r, a, BOARD_GAP / 2))) return t.at
  }
  return { x: board.x, y: bottomOf(board) + BOARD_CLEAR + 61 * step }
}

/** What a moved board must land clear of, indexed once per gesture (an R-tree of the blockers' boxes). */
export class BlockerIndex {
  private readonly tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; r: Rect }>()
  readonly size: number

  constructor(rects: readonly Rect[]) {
    this.tree.load(rects.map((r) => ({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h, r })))
    this.size = rects.length
  }

  /** The blockers whose boxes meet `r` grown by `pad`. */
  near(r: Rect, pad = 0): Rect[] {
    return this.tree.search({ minX: r.x - pad, minY: r.y - pad, maxX: r.x + r.w + pad, maxY: r.y + r.h + pad }).map((b) => b.r)
  }

  /** Does `r` overlap a blocker, or come closer to one than `margin`? */
  hits(r: Rect, margin: number): boolean {
    return this.near(r, margin).some((b) => overlaps(r, b, margin))
  }
}

const shift = (r: Rect, dx: number, dy: number): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h })

/**
 * The smallest move (dx, dy) that leaves every box in `rects` at least `margin` clear of every blocker:
 * (0, 0) when they already are (the fast path). The rects move together, by one delta, and never block
 * each other (several boards moved at once land together). Exact: the candidates are the positions
 * where an edge sits `margin` from a nearby blocker's edge, tried nearest first, searching outward until
 * one is clear. Ties go down, then right.
 */
export function freeOffset(rects: readonly Rect[], avoid: BlockerIndex, margin: number): { dx: number; dy: number } {
  if (!rects.length || !rects.some((r) => avoid.hits(r, margin))) return { dx: 0, dy: 0 }
  const all = unionRects(rects)
  const clear = (dx: number, dy: number) => !rects.some((r) => avoid.hits(shift(r, dx, dy), margin))
  for (let reach = Math.max(200, all.w, all.h); reach <= 1 << 17; reach *= 2) {
    const xs = new Set<number>([0])
    const ys = new Set<number>([0])
    for (const b of avoid.near(all, reach + margin)) {
      for (const r of rects) {
        xs.add(b.x + b.w + margin - r.x)
        xs.add(b.x - margin - (r.x + r.w))
        ys.add(b.y + b.h + margin - r.y)
        ys.add(b.y - margin - (r.y + r.h))
      }
    }
    const tries: [number, number, number][] = []
    for (const dx of xs) {
      if (Math.abs(dx) > reach) continue
      for (const dy of ys) if (Math.abs(dy) <= reach) tries.push([dx, dy, dx * dx + dy * dy])
    }
    tries.sort((a, b) => a[2] - b[2] || b[1] - a[1] || b[0] - a[0])
    for (const [dx, dy] of tries) if (clear(dx, dy)) return { dx, dy }
  }
  return { dx: 0, dy: 0 }
}

/** Where `rect` lands nearest to where it is, `margin` clear of every blocker in `avoid` (it stays when it already is). */
export function nearestFree(rect: Rect, avoid: readonly Rect[] | BlockerIndex, opts: { margin?: number } = {}): { x: number; y: number } {
  const idx = avoid instanceof BlockerIndex ? avoid : new BlockerIndex(avoid)
  const { dx, dy } = freeOffset([rect], idx, opts.margin ?? BOARD_CLEAR)
  return { x: rect.x + dx, y: rect.y + dy }
}

/**
 * How far a move (dx, dy) of `rects` may go along one axis before one of them comes within `margin` of
 * a blocker it was clear of (a nudge stops there; it never jumps a blocker). `dx` or `dy` is 0.
 */
export function clampMove(rects: readonly Rect[], avoid: BlockerIndex, margin: number, dx: number, dy: number): { dx: number; dy: number } {
  let ok = dx || dy
  const sign = Math.sign(ok)
  for (const r of rects) {
    const sweep = dx ? { x: Math.min(r.x, r.x + dx), y: r.y, w: r.w + Math.abs(dx), h: r.h } : { x: r.x, y: Math.min(r.y, r.y + dy), w: r.w, h: r.h + Math.abs(dy) }
    for (const b of avoid.near(sweep, margin)) {
      if (overlaps(r, b, margin)) continue
      if (dx) {
        if (!(b.y < r.y + r.h + margin && r.y < b.y + b.h + margin)) continue
        const room = sign > 0 ? b.x - margin - (r.x + r.w) : -(r.x - (b.x + b.w + margin))
        if (room >= -EPS) ok = sign > 0 ? Math.min(ok, Math.max(0, room)) : Math.max(ok, -Math.max(0, room))
      } else {
        if (!(b.x < r.x + r.w + margin && r.x < b.x + b.w + margin)) continue
        const room = sign > 0 ? b.y - margin - (r.y + r.h) : -(r.y - (b.y + b.h + margin))
        if (room >= -EPS) ok = sign > 0 ? Math.min(ok, Math.max(0, room)) : Math.max(ok, -Math.max(0, room))
      }
    }
  }
  return dx ? { dx: ok, dy: 0 } : { dx: 0, dy: ok }
}

/**
 * A resize's box held back so it never grows to within BOARD_CLEAR of a blocker it was clear of: each
 * edge that moved out stops where the next blocker begins (owner BM7: a side never grows under a
 * neighbour). Edges moving in are never held.
 */
export function clampGrowth(board: Rect, want: Rect, blockers: readonly Rect[]): Rect {
  let x0 = want.x
  let y0 = want.y
  let x1 = rightOf(want)
  let y1 = bottomOf(want)
  for (const b of blockers) {
    if (distance(board, b) < BOARD_CLEAR - EPS) continue
    const meetsY = (ya: number, yb: number) => b.y < yb + BOARD_CLEAR - EPS && ya < bottomOf(b) + BOARD_CLEAR - EPS
    // Across first, with the board's own height; then down, with the width the board now has.
    if (x1 > rightOf(board) && b.x >= rightOf(board) && meetsY(board.y, bottomOf(board))) x1 = Math.max(rightOf(board), Math.min(x1, b.x - BOARD_CLEAR))
    if (x0 < board.x && rightOf(b) <= board.x && meetsY(board.y, bottomOf(board))) x0 = Math.min(board.x, Math.max(x0, rightOf(b) + BOARD_CLEAR))
  }
  for (const b of blockers) {
    if (distance(board, b) < BOARD_CLEAR - EPS) continue
    const meetsX = b.x < x1 + BOARD_CLEAR - EPS && x0 < rightOf(b) + BOARD_CLEAR - EPS
    if (!meetsX) continue
    if (y1 > bottomOf(board) && b.y >= bottomOf(board)) y1 = Math.max(bottomOf(board), Math.min(y1, b.y - BOARD_CLEAR))
    if (y0 < board.y && bottomOf(b) <= board.y) y0 = Math.min(board.y, Math.max(y0, bottomOf(b) + BOARD_CLEAR))
  }
  // A corner past a blocker diagonally: what is left of it still meets one across, so hold that way too.
  for (const b of blockers) {
    if (distance(board, b) < BOARD_CLEAR - EPS) continue
    const g = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    if (!overlaps(g, b, BOARD_CLEAR)) continue
    if (x1 > rightOf(board) && b.x >= rightOf(board)) x1 = Math.max(rightOf(board), b.x - BOARD_CLEAR)
    else if (x0 < board.x && rightOf(b) <= board.x) x0 = Math.min(board.x, rightOf(b) + BOARD_CLEAR)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export interface Placement {
  /** Where the thing goes. */
  box: Rect
  /** The board's box after it (grown, or as it was). */
  board: Rect
  /** Which way the board grew to hold it, if it did. */
  grew: 'down' | 'right' | 'beside' | null
  /** True when the board could not grow: `box` is outside it, and the thing is not on the board. */
  full: boolean
}

/**
 * Where a thing of `size` goes on a board (the owner's rules above). `occupied`: the boxes of what is
 * on it; `blockers`: other boards and loose things it must not grow onto. `prefer`: a spot asked for
 * (beside a generated picture's source, next to a key's views); taken when it is clear, growing the
 * board toward it when that is free, else the next free slot.
 */
export function placeInBoard(board: Rect, occupied: readonly Rect[], size: { w: number; h: number }, blockers: readonly Rect[], prefer?: { x: number; y: number }): Placement {
  const inn = innerRect(board)
  const grown = (box: Rect) => unionRects([board, aroundRect(box)])
  if (prefer) {
    const box = { ...prefer, ...size }
    if (clearOf(box, occupied)) {
      if (containsRect(inn, box)) return { box, board, grew: null, full: false }
      const g = grown(box)
      if (!growthBlocked(board, g, blockers)) return { box, board: g, grew: 'beside', full: false }
    }
  }
  const here = rowSlot(occupied, size, inn.x, rightOf(inn), inn.y, bottomOf(inn))
  if (here) return { box: { ...here, ...size }, board, grew: null, full: false }
  // Down first: the next row below, as wide as the board is.
  const down = rowSlot(occupied, size, inn.x, rightOf(inn), inn.y)
  if (down) {
    const box = { ...down, ...size }
    const g = grown(box)
    if (!growthBlocked(board, g, blockers)) return { box, board: g, grew: 'down', full: false }
  }
  // Then right: a new column after everything, from the top.
  const colX = Math.max(inn.x, ...occupied.map((o) => rightOf(o) + BOARD_GAP))
  const box = { x: colX, y: inn.y, ...size }
  const g = grown(box)
  if (!growthBlocked(board, g, blockers)) return { box, board: g, grew: 'right', full: false }
  const spot = outsideSpot(board, size, [...blockers, ...occupied])
  return { box: { ...spot, ...size }, board, grew: null, full: true }
}

/**
 * Several things onto one board, in order: each placed as placeInBoard says, the board growing as it
 * goes; once it is full, the rest land outside too, clear of each other.
 */
export function placeAllInBoard(board: Rect, occupied: readonly Rect[], sizes: readonly { w: number; h: number }[], blockers: readonly Rect[], prefer?: (i: number) => { x: number; y: number } | undefined): { boxes: Rect[]; board: Rect; full: boolean[] } {
  let b = board
  const occ = [...occupied]
  const outside: Rect[] = []
  const boxes: Rect[] = []
  const full: boolean[] = []
  for (let i = 0; i < sizes.length; i++) {
    const p = placeInBoard(b, occ, sizes[i], [...blockers, ...outside], prefer?.(i))
    boxes.push(p.box)
    full.push(p.full)
    if (p.full) outside.push(p.box)
    else {
      occ.push(p.box)
      b = p.board
    }
  }
  return { boxes, board: b, full }
}

/** Fit to contents: the board round its members with its padding (as it is, with none). */
export function fitRect(board: Rect, members: readonly Rect[]): Rect {
  if (!members.length) return board
  const r = aroundRect(unionRects(members))
  return { x: r.x, y: r.y, w: Math.max(BOARD_MIN.w, r.w), h: Math.max(BOARD_MIN.h, r.h) }
}

/**
 * Grow the board to hold `members` with its padding, each way it needs to (up, down, left, right) that
 * does not come onto a blocker; a way that is blocked is left as it is. Null when nothing changes.
 */
export function growToHold(board: Rect, members: readonly Rect[], blockers: readonly Rect[]): Rect | null {
  if (!members.length) return null
  const need = aroundRect(unionRects(members))
  if (containsRect(board, need)) return null
  let x0 = board.x
  let y0 = board.y
  let x1 = rightOf(board)
  let y1 = bottomOf(board)
  const tryWay = (nx0: number, ny0: number, nx1: number, ny1: number) => {
    const before = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    const g = { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 }
    if (!growthBlocked(before, g, blockers)) [x0, y0, x1, y1] = [nx0, ny0, nx1, ny1]
  }
  if (need.y < y0) tryWay(x0, need.y, x1, y1)
  if (bottomOf(need) > y1) tryWay(x0, y0, x1, bottomOf(need))
  if (need.x < x0) tryWay(need.x, y0, x1, y1)
  if (rightOf(need) > x1) tryWay(x0, y0, rightOf(need), y1)
  if (x0 === board.x && y0 === board.y && x1 === rightOf(board) && y1 === bottomOf(board)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * A board's box while an edge or corner handle is dragged to `p`. `units`: the boxes of what is on it
 * (a group counts as one). An edge never cuts a unit: it stops at the units whose centre is still
 * inside, with the padding; the units whose centre it passed are in `leaving`. Never below BOARD_MIN.
 */
export function resizeRect(board: Rect, edge: Edge, p: { x: number; y: number }, units: readonly Rect[]): { rect: Rect; leaving: number[] } {
  let x0 = board.x
  let y0 = board.y
  let x1 = rightOf(board)
  let y1 = bottomOf(board)
  const W = edge.includes('w')
  const E = edge.includes('e')
  const N = edge.includes('n')
  const S = edge.includes('s')
  if (W) x0 = Math.min(p.x, x1 - BOARD_MIN.w)
  if (E) x1 = Math.max(p.x, x0 + BOARD_MIN.w)
  if (N) y0 = Math.min(p.y, y1 - BOARD_MIN.h)
  if (S) y1 = Math.max(p.y, y0 + BOARD_MIN.h)
  const inside = (r: Rect, c = centreOf(r)) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1
  // Only what was on the board counts: a member already outside it neither holds an edge nor leaves.
  const was = units.map((u, i) => ({ u, i })).filter(({ u }) => {
    const c = centreOf(u)
    return c.x >= board.x && c.x <= rightOf(board) && c.y >= board.y && c.y <= bottomOf(board)
  })
  for (let k = 0; k < 4; k++) {
    const keep = was.filter(({ u }) => inside(u))
    if (!keep.length) break
    const need = aroundRect(unionRects(keep.map((x) => x.u)))
    const before = [x0, y0, x1, y1].join()
    if (W) x0 = Math.min(x0, need.x)
    if (E) x1 = Math.max(x1, rightOf(need))
    if (N) y0 = Math.min(y0, need.y)
    if (S) y1 = Math.max(y1, bottomOf(need))
    if ([x0, y0, x1, y1].join() === before) break
  }
  const leaving = was.filter(({ u }) => !inside(u)).map(({ i }) => i)
  return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, leaving }
}
