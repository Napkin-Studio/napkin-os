// Things landing on boards (owner decision, Shrey 2026-10-15; features/art-boards.clan), on the
// engine-neutral CanvasElement: dropped pictures, + Node, generated pictures beside their source and
// new key views next to their group all go through fitInto, so each lands in the board's next free
// slot (or the spot asked for) and the board grows toward free canvas, down first, then right; it never
// grows onto another board or loose things, and when it cannot grow the thing lands just outside it,
// on no board, and the board says "Board is full · Resize" (boardNotices). The geometry is
// canvas-engine's boards/sizing. On Excalidraw there are no board frames, so nothing here acts.

import { growToHold, placeAllInBoard, type Rect } from '../../../../canvas-engine/src'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { elementBounds } from '../core/geometry'

type Fields = Partial<CanvasElement>
const kindOf = (e: CanvasElement) => (e.customData as { kind?: string } | undefined)?.kind
/** A board frame (boards.ts isBoard; kept here so nodes can place without importing the boards module). */
const isBoard = (e: CanvasElement) => !e.isDeleted && kindOf(e) === 'board'
/** Links and arrows follow their ends: they are never on a board's mind. */
const follows = (e: CanvasElement) => e.type === 'arrow' || e.type === 'line' || kindOf(e) === 'link' || kindOf(e) === 'provenance'

export const rectOf = (els: readonly CanvasElement[]): Rect => {
  const b = elementBounds(els)
  return { x: b.minX, y: b.minY, w: b.w, h: b.h }
}
const rectOfFrame = (f: CanvasElement): Rect => ({ x: f.x, y: f.y, w: f.width, h: f.height })

/** The board frame with this element id, if it is one. */
export function boardFrame(els: readonly CanvasElement[], id: string | null | undefined): CanvasElement | undefined {
  return id ? els.find((e) => e.id === id && isBoard(e)) : undefined
}

/** The topmost board frame under a scene point (optionally only those `which` accepts). */
export function boardAt(els: readonly CanvasElement[], p: Pt, which: (f: CanvasElement) => boolean = () => true): CanvasElement | undefined {
  return els.filter((f) => isBoard(f) && which(f) && p.x >= f.x && p.y >= f.y && p.x <= f.x + f.width && p.y <= f.y + f.height).at(-1)
}

/** What is on a board, a group (a key's views, an ink group) as one unit: their boxes. */
export function unitsOn(els: readonly CanvasElement[], frameId: string, skip: ReadonlySet<string> = new Set()): Rect[] {
  const by = new Map<string, CanvasElement[]>()
  for (const e of els) {
    if (e.isDeleted || e.frameId !== frameId || skip.has(e.id) || follows(e)) continue
    const key = e.groupIds?.at(-1) ?? `#${e.id}`
    by.set(key, [...(by.get(key) ?? []), e])
  }
  return [...by.values()].map(rectOf)
}

/** What a board must not grow onto: the other boards and loose things (not links), except `skip`. */
export function blockersOf(els: readonly CanvasElement[], frameId: string, skip: ReadonlySet<string> = new Set()): Rect[] {
  return els.filter((e) => !e.isDeleted && e.id !== frameId && !skip.has(e.id) && !follows(e) && (isBoard(e) ? e.frameId !== frameId : !e.frameId)).map((e) => rectOf([e]))
}

export interface Fit {
  /** Element id → the fields to change: each unit's place and board (none when it landed outside), the board's box. */
  fields: Map<string, Fields>
  /** The units that did not fit (the board could not grow): they are just outside it, on no board. */
  outside: string[][]
}

/**
 * Put these units (each a list of element ids that move together, already in `els`) on a board, in
 * order, as boards/sizing says. `prefer(i)`: the top-left asked for unit i (beside its source, next to
 * its group), taken when it is clear. Pure: returns the fields; nothing is written.
 */
export function fitInto(els: readonly CanvasElement[], frameId: string, units: readonly (readonly string[])[], prefer?: (i: number) => Pt | undefined): Fit {
  const fields = new Map<string, Fields>()
  const frame = boardFrame(els, frameId)
  if (!frame || !units.length) return { fields, outside: [] }
  const moving = new Set(units.flat())
  const byId = new Map(els.map((e) => [e.id, e]))
  const rects = units.map((ids) => rectOf(ids.map((id) => byId.get(id)).filter((e): e is CanvasElement => !!e)))
  const board = rectOfFrame(frame)
  const r = placeAllInBoard(board, unitsOn(els, frameId, moving), rects.map((u) => ({ w: u.w, h: u.h })), blockersOf(els, frameId, moving), prefer)
  const outside: string[][] = []
  units.forEach((ids, i) => {
    const dx = r.boxes[i].x - rects[i].x
    const dy = r.boxes[i].y - rects[i].y
    if (r.full[i]) outside.push([...ids])
    for (const id of ids) {
      const e = byId.get(id)
      if (e) fields.set(id, { x: e.x + dx, y: e.y + dy, frameId: r.full[i] ? null : frameId })
    }
  })
  if (r.board.x !== board.x || r.board.y !== board.y || r.board.w !== board.w || r.board.h !== board.h) {
    fields.set(frameId, { x: r.board.x, y: r.board.y, width: r.board.w, height: r.board.h })
  }
  return { fields, outside }
}

/** The board's new box when what is on it sticks out (a picture landed taller, a stack spread), if it can grow. */
export function holdFields(els: readonly CanvasElement[], frameId: string): Map<string, Fields> {
  const out = new Map<string, Fields>()
  const frame = boardFrame(els, frameId)
  if (!frame) return out
  const g = growToHold(rectOfFrame(frame), unitsOn(els, frameId), blockersOf(els, frameId))
  if (g) out.set(frameId, { x: g.x, y: g.y, width: g.w, height: g.h })
  return out
}

/** The elements with `fields` patched in. */
export function withFields(canvas: Pick<CanvasAdapter, 'patch'>, els: readonly CanvasElement[], fields: ReadonlyMap<string, Fields>): CanvasElement[] {
  return els.map((e) => (fields.has(e.id) ? canvas.patch(e, fields.get(e.id)!) : e))
}

// ── "Board is full · Resize" ──

export interface BoardNotice {
  /** The board frame's element id. */
  frameId: string
  /** What landed outside it. */
  ids: string[]
}

const listeners = new Set<(n: BoardNotice) => void>()

/** The board layer listens: a board that could not take what came to it shows its hint. */
export const boardNotices = {
  subscribe(cb: (n: BoardNotice) => void): () => void {
    listeners.add(cb)
    return () => void listeners.delete(cb)
  },
  full(frameId: string, ids: readonly string[]) {
    for (const cb of listeners) cb({ frameId, ids: [...ids] })
  },
}

/** Say "full" for a fit's units that landed outside, if any. */
export function tellFull(frameId: string, fit: Fit) {
  if (fit.outside.length) boardNotices.full(frameId, fit.outside.flat())
}
