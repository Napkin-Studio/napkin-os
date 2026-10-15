// Next-slot placement on a board (features/board-autolayout.clan; owner BA1, 2026-10-15: "Don't shuffle
// the old things, make space for the new thing"). Pure geometry on boxes, beside boards/sizing.
//
// - A new thing goes in the next free slot of the board's layout, never moving what is already there:
//   right after the thing it follows (a key's last view, a generated picture's source) in that row;
//   when the row would make the board wider than ROW_MAX_W, or the board cannot grow that way, on the
//   next free spot below that row, from the row's start (a key's views wrap, one key per row: BA4); a
//   new lane (a new key) starts a new row below everything.
// - The board grows to hold it by the 2026-10-15 rules (toward free canvas, never onto a neighbour).
//   What can't be placed that way falls back to placeInBoard: the contact-sheet next free slot, growth
//   down, right, up, left, else just outside ("full").
// - Several things that don't fit land outside as one row, in order, at one side (overflowRow).

import { unionRects, type Rect } from '../model/bounds'
import { aroundRect, BOARD_GAP, BOARD_CLEAR, bottomOf, clearOf, containsRect, growthBlocked, innerRect, outsideSpot, overlaps, placeInBoard, rightOf, rowSlot, type Placement } from './sizing'

/** A row may make its board this wide (scene units) before the next thing wraps below it. */
export const ROW_MAX_W = 1400

/** What a new thing follows on its board. */
export interface SlotAsk {
  /** Go right after this box, in its row (a key's last view, a generated picture's source). */
  after?: Rect
  /** Where the row starts (its first thing's left), for wrapping; the board's inside by default. */
  rowStart?: number
  /** A new lane (a key not on the board yet): a new row below everything. */
  newRow?: boolean
}

/**
 * Where a thing of `size` goes on a board: the next free slot of its lane (`ask`), the board growing to
 * hold it; never over what is there (`occupied`), never growing onto `blockers`. Nothing else moves.
 */
export function nextSlot(board: Rect, occupied: readonly Rect[], size: { w: number; h: number }, blockers: readonly Rect[], ask: SlotAsk = {}): Placement {
  const inn = innerRect(board)
  const maxW = Math.max(board.w, ROW_MAX_W)
  const take = (box: Rect, grew: Placement['grew']): Placement | null => {
    if (!clearOf(box, occupied)) return null
    if (containsRect(inn, box)) return { box, board, grew: null, full: false }
    const g = unionRects([board, aroundRect(box)])
    if (g.w > maxW + 1e-6 || growthBlocked(board, g, blockers)) return null
    return { box, board: g, grew, full: false }
  }
  if (ask.after) {
    const a = ask.after
    const beside = take({ x: rightOf(a) + BOARD_GAP, y: a.y, ...size }, 'beside')
    if (beside) return beside
    // Wrap: the first free spot below the row, from its start (reading order), inside or growing down.
    const x0 = Math.max(inn.x, ask.rowStart ?? inn.x)
    const rowBottom = Math.max(bottomOf(a), ...occupied.filter((o) => o.y < bottomOf(a) && bottomOf(o) > a.y && o.x >= x0 - 1e-6).map(bottomOf))
    const x1 = Math.max(rightOf(inn), x0 + size.w)
    const inside = rowSlot(occupied, size, x0, x1, rowBottom + BOARD_GAP, bottomOf(inn))
    const wrapped = inside ? take({ ...inside, ...size }, null) : null
    if (wrapped) return wrapped
    const below = rowSlot(occupied, size, x0, x1, rowBottom + BOARD_GAP)
    const down = below ? take({ ...below, ...size }, 'down') : null
    if (down) return down
  } else if (ask.newRow) {
    const y = occupied.length ? Math.max(...occupied.map(bottomOf)) + BOARD_GAP : inn.y
    const row = take({ x: inn.x, y, ...size }, 'down')
    if (row) return row
  }
  return placeInBoard(board, occupied, size, blockers)
}

/**
 * Where something goes outside a full board when others already went out (`outside`, in order): right
 * after the last of them in the same row when that is clear, so the overflow is one ordered row at one
 * side; else the nearest free spot outside.
 */
export function overflowSpot(board: Rect, size: { w: number; h: number }, outside: readonly Rect[], avoid: readonly Rect[]): { x: number; y: number } {
  const last = outside.at(-1)
  if (last) {
    const r = { x: rightOf(last) + BOARD_GAP / 2, y: last.y, ...size }
    if (!overlaps(r, board, BOARD_CLEAR) && !avoid.some((a) => overlaps(r, a, BOARD_GAP / 2))) return { x: r.x, y: r.y }
  }
  return outsideSpot(board, size, avoid)
}
