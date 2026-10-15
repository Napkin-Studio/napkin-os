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
