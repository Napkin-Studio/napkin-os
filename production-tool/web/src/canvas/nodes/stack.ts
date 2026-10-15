// A key group shown as a stack (owner, Shrey 2026-10-15; features/canvas-nodes.clan): the views pile
// up like a real pile of photos, each turned noticeably (within ±12°, mixed directions) and offset so
// the corners and edges of the ones below peek out, the top card (the front) nearly straight. The
// turn and offset of each card come from a hash of its element id, so they are the same on every
// load and every screen. Spread is the default; Stack and Spread are one undo step each, written to
// the scene so everyone sees the same state. Engine-neutral: plain CanvasElements in, fields out.
//
// A stacked card keeps `stack`: {dx, dy, angle}, the way back to its spread place from where it lies
// (relative, so a stack moved as one spreads out where it now is).

import type { CanvasAdapter, CanvasElement } from '../core/canvasAdapter'

/** How far a card below the top may turn: 12°. */
export const MAX_TURN = (12 * Math.PI) / 180
/** The least a card below the top turns, so the pile reads as one: 5°. */
export const MIN_TURN = (5 * Math.PI) / 180
/** How far the top card may turn: 2.5°. */
export const TOP_TURN = (2.5 * Math.PI) / 180
/** How far a card's centre may sit from the top card's, as a share of the larger card's width and height. */
export const MAX_SHIFT = { x: 0.16, y: 0.12 }
/** How long a stack takes to open or fold. */
export const STACK_MS = 320

export interface StackWay {
  dx: number
  dy: number
  angle: number
}

type El = CanvasElement & { stack?: StackWay }

/** A number in [0, 1) from a string (FNV-1a), the same everywhere. */
export function unitHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

export interface Card {
  id: string
  w: number
  h: number
}

/**
 * Where each card lies in the pile, top card first in `cards`: its top-left and its turn (radians).
 * The top card lies at `at` (its top-left); each card below it is centred near the top card's
 * centre, shifted and turned the other way from the one above it.
 */
export function stackLayout(cards: readonly Card[], at: { x: number; y: number }): Map<string, { x: number; y: number; angle: number }> {
  const out = new Map<string, { x: number; y: number; angle: number }>()
  if (!cards.length) return out
  const top = cards[0]
  const cx = at.x + top.w / 2
  const cy = at.y + top.h / 2
  // The pile's first turn goes one way or the other, by the top card's hash; then they alternate.
  const first = unitHash(`${top.id}#way`) < 0.5 ? 1 : -1
  cards.forEach((c, k) => {
    if (k === 0) {
      out.set(c.id, { x: at.x, y: at.y, angle: (unitHash(`${c.id}#turn`) * 2 - 1) * TOP_TURN })
      return
    }
    const way = k % 2 === 1 ? first : -first
    const angle = way * (MIN_TURN + unitHash(`${c.id}#turn`) * (MAX_TURN - MIN_TURN))
    // Shifted the way it turns, a little more the deeper it lies, never past MAX_SHIFT.
    const depth = Math.min(1, 0.55 + 0.15 * k)
    // Measured on the larger of it and the top card, so a smaller card still shows past the top one.
    const w = Math.max(c.w, top.w)
    const h = Math.max(c.h, top.h)
    const dx = way * (0.5 + 0.5 * unitHash(`${c.id}#x`)) * depth * MAX_SHIFT.x * w
    const dy = (unitHash(`${c.id}#y`) * 2 - 1) * depth * MAX_SHIFT.y * h
    out.set(c.id, { x: cx + dx - c.w / 2, y: cy + dy - c.h / 2, angle })
  })
  return out
}

/** Is this group stacked? (any member keeps a way back) */
export const isStacked = (members: readonly CanvasElement[]) => members.some((m) => !!(m as El).stack)

/** A card's spread place: where it lies, or for a stacked one, where its way back leads. */
export function spreadPlace(e: CanvasElement): { x: number; y: number; angle: number } {
  const w = (e as El).stack
  return w ? { x: e.x + w.dx, y: e.y + w.dy, angle: w.angle } : { x: e.x, y: e.y, angle: e.angle ?? 0 }
}

/**
 * The fields that pile `members` (top card first: the front) into a stack on the top card's place,
 * each keeping its way back. Pure.
 */
export function stackFields(members: readonly CanvasElement[]): Map<string, Partial<El>> {
  const out = new Map<string, Partial<El>>()
  if (members.length < 2) return out
  const places = members.map(spreadPlace)
  const lay = stackLayout(members.map((m) => ({ id: m.id, w: m.width, h: m.height })), places[0])
  members.forEach((m, i) => {
    const p = lay.get(m.id)!
    const from = places[i]
    out.set(m.id, { x: p.x, y: p.y, angle: p.angle, stack: { dx: from.x - p.x, dy: from.y - p.y, angle: from.angle } })
  })
  return out
}

/** The fields that lay a stack's cards back out where they came from. Pure. */
export function spreadFields(members: readonly CanvasElement[]): Map<string, Partial<El>> {
  const out = new Map<string, Partial<El>>()
  for (const m of members) {
    if (!(m as El).stack) continue
    const p = spreadPlace(m)
    out.set(m.id, { x: p.x, y: p.y, angle: p.angle, stack: undefined })
  }
  return out
}

/**
 * Stack or spread a group's members (top card first) as one undo step. A stack puts its cards in
 * paint order bottom to top (the front on top); `animate` glides them there (reduced motion: off).
 * False when there was nothing to change.
 */
export function setStacked(canvas: CanvasAdapter, members: readonly CanvasElement[], on: boolean, opts: { animate?: boolean } = {}): boolean {
  if (isStacked(members) === on) return false
  const fields = on ? stackFields(members) : spreadFields(members)
  if (!fields.size) return false
  const before = new Map(members.map((m) => [m.id, { x: m.x, y: m.y, angle: m.angle ?? 0 }]))
  canvas.transact((all) => {
    const next = all.map((e) => (fields.has(e.id) ? canvas.patch(e, fields.get(e.id)!) : e))
    if (!on) return next
    // Bottom to top in paint order, where the topmost of them was.
    const ids = new Set(fields.keys())
    const at = Math.max(...next.map((e, i) => (ids.has(e.id) ? i : -1)))
    const pile = [...members].reverse().map((m) => next.find((e) => e.id === m.id)!)
    const rest = next.filter((e) => !ids.has(e.id))
    const before = next.slice(0, at + 1).filter((e) => !ids.has(e.id)).length
    return [...rest.slice(0, before), ...pile, ...rest.slice(before)]
  }, { undoable: true })
  if (opts.animate) canvas.animate?.(before, STACK_MS)
  return true
}
