// How a board is picked up (features/board-move.clan; ui-behaviour 3.2 "Moving a board"): one grab
// test shared by the select tool, the renderer (which draws the chip from boardTitleRect) and the
// web's BoardLayer (the rename field and the board bar sit on the same chip).
//
// - The title chip sits on the board's top edge and is screen-constant: never under 20 px tall on
//   screen at any zoom, so it is a handle you can see. Its hit area is the drawn chip plus 4 px.
// - The edge: within 6 screen px of the frame line, either side, moves the board (selected or not;
//   owner BM6: a selected board resizes only from its square handles).
// - The inside: the rest of the box. Whether it moves the board (selected) or marquees (unselected)
//   is the select tool's grabOrder, not this test.

import type { Rect } from '../model/bounds'
import type { ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'

/** The chip's height on screen, at least (screen pixels). */
export const TITLE_PX = 20
/** The chip's hit area beyond what is drawn (screen pixels). */
export const TITLE_REACH_PX = 4
/** How near the frame line (screen pixels) a press takes the board's edge. */
export const EDGE_PX = 6

export type BoardPart = 'title' | 'edge' | 'inside'

export interface BoardGrab {
  board: ElementRecord
  part: BoardPart
}

/** The chip's scale: 1 scene unit per screen pixel when zoomed out, the board's own scale when zoomed in. */
export const titleScale = (zoom: number) => Math.max(1, 1 / Math.max(1e-6, zoom))

/**
 * The title chip of a board at a zoom, in scene units: on the top edge, centred on it, 20 px tall on
 * screen at least, as wide as the name (never wider than the board, never narrower than 40 px).
 */
export function boardTitleRect(board: Pick<ElementRecord, 'x' | 'y' | 'w' | 'h' | 'props'>, zoom: number): Rect {
  const k = titleScale(zoom)
  const x0 = Math.min(board.x, board.x + board.w)
  const y0 = Math.min(board.y, board.y + board.h)
  const bw = Math.abs(board.w)
  const name = typeof board.props.name === 'string' ? board.props.name : ''
  const h = TITLE_PX * k
  const want = (name.length * 7 + 16) * k
  const w = Math.max(40 * k, Math.min(want, bw - 14 * k))
  const x = x0 + Math.min(14 * k, Math.max(0, bw - w))
  return { x, y: y0 - h / 2, w, h }
}

const inRect = (p: { x: number; y: number }, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad

const byZDesc = (a: ElementRecord, b: ElementRecord) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0)

/** Which part of one board a scene point takes, or null (the chip first, then the edge, then the inside). */
export function boardPartAt(b: ElementRecord, p: { x: number; y: number }, zoom: number): BoardPart | null {
  if (inRect(p, boardTitleRect(b, zoom), TITLE_REACH_PX / zoom)) return 'title'
  const x0 = Math.min(b.x, b.x + b.w)
  const y0 = Math.min(b.y, b.y + b.h)
  const box = { x: x0, y: y0, w: Math.abs(b.w), h: Math.abs(b.h) }
  const reach = EDGE_PX / zoom
  if (!inRect(p, box, reach)) return null
  const nearX = Math.abs(p.x - box.x) <= reach || Math.abs(p.x - (box.x + box.w)) <= reach
  const nearY = Math.abs(p.y - box.y) <= reach || Math.abs(p.y - (box.y + box.h)) <= reach
  if (nearX || nearY) return 'edge'
  return 'inside'
}

/**
 * The board a scene point grabs, and by what: its title chip, its edge or its inside. Every title
 * comes before any edge, and every edge before any inside, so a neighbour's chip over another board's
 * inside wins; among the same part, the topmost board.
 */
export function boardGrabAt(scene: Pick<SceneStore, 'all'>, p: { x: number; y: number }, zoom: number): BoardGrab | undefined {
  const boards = scene.all().filter((r) => r.kind === 'board').sort(byZDesc)
  let edge: BoardGrab | undefined
  let inside: BoardGrab | undefined
  for (const b of boards) {
    const part = boardPartAt(b, p, zoom)
    if (part === 'title') return { board: b, part }
    if (part === 'edge') edge ??= { board: b, part }
    else if (part === 'inside') inside ??= { board: b, part }
  }
  return edge ?? inside
}
