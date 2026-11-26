// The Campaign board's grid (features/campaign-formats.clan, CF10): one tile per size at its true
// proportion, in channel lanes (Film and online video, Social, Out of home, Print, Display), each lane
// wrapping at the board's width. Pure: sizes in, the board's box and every tile's place out, in scene
// units from the board element's top-left.

import type { FormatChannel } from '../contracts/types'
import { LANES } from './formats'

export const HEAD_H = 64
export const PAD = 24
export const LANE_HEAD = 28
export const TILE_H = 200
export const MAX_TILE_W = 520
export const MIN_TILE_W = 90
export const CAPTION_H = 46
export const GAP = 24
export const MAX_ROW_W = 1680
/** A folded lane's stack: the room it takes in place of its tiles (features/art-director.clan, slice 2). */
export const STACK_W = 230
export const STACK_H = 130
/** The board is never narrower than its header's buttons (See all sizes, Safe areas, Export zip, Export at full
 *  size, an Update or Upscaling note): UAT 2026-11-18, two 6 s films made a board "Export at full size" ran off. */
export const MIN_BOARD_W = 780

export interface TileIn { id: string; channel: FormatChannel; aspect: { w: number; h: number } }
export interface TileBox { x: number; y: number; w: number; h: number }
export interface LaneBox { channel: FormatChannel; label: string; y: number; count: number
  /** Folded into a stack: no tiles of its own, one stack box instead. */
  stack?: TileBox & { ids: string[] } }
export interface BoardLayout { w: number; h: number; lanes: LaneBox[]; tiles: Record<string, TileBox> }

/** A tile's picture size at true proportion: TILE_H tall, narrower than MAX_TILE_W, never a sliver. */
export function tileSize(aspect: { w: number; h: number }): { w: number; h: number } {
  const r = aspect.w / aspect.h
  let h = TILE_H
  let w = h * r
  if (w > MAX_TILE_W) {
    w = MAX_TILE_W
    h = w / r
  }
  if (w < MIN_TILE_W) {
    w = MIN_TILE_W
    h = Math.min(TILE_H * 1.6, w / r)
  }
  return { w: Math.round(w), h: Math.round(h) }
}

export function boardLayout(tiles: readonly TileIn[], folded: ReadonlySet<FormatChannel> = new Set()): BoardLayout {
  const lanes: LaneBox[] = []
  const out: Record<string, TileBox> = {}
  let y = HEAD_H
  let widest = MIN_BOARD_W
  for (const lane of LANES) {
    const mine = tiles.filter((t) => t.channel === lane.channel)
    if (!mine.length) continue
    const lb: LaneBox = { channel: lane.channel, label: lane.label, y, count: mine.length }
    lanes.push(lb)
    y += LANE_HEAD
    if (folded.has(lane.channel)) {
      lb.stack = { x: PAD, y, w: STACK_W, h: STACK_H, ids: mine.map((t) => t.id) }
      widest = Math.max(widest, PAD + STACK_W + PAD)
      y += STACK_H + CAPTION_H / 2 + GAP
      continue
    }
    let x = PAD
    let rowH = 0
    for (const t of mine) {
      const s = tileSize(t.aspect)
      if (x > PAD && x + s.w > MAX_ROW_W) {
        y += rowH + CAPTION_H + GAP
        x = PAD
        rowH = 0
      }
      out[t.id] = { x, y, w: s.w, h: s.h }
      x += s.w + GAP
      rowH = Math.max(rowH, s.h)
      widest = Math.max(widest, x - GAP + PAD)
    }
    y += rowH + CAPTION_H + GAP
  }
  return { w: Math.round(widest), h: Math.round(y + PAD - GAP), lanes, tiles: out }
}
