// The Gather nudge, Move to <Board> and Tidy as canvas actions (features/board-autolayout.clan), each
// one undoable step on the canvas. Gather writes the new board's document entry first (a system write,
// as "+ New board" does), so the rail never lists a frame without one; undoing the frame takes the
// entry away again (BoardLayer's reconcile).

import type { ProductionDocument } from '../../contracts/types'
import { systemUpdate } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'
import type { CanvasAdapter } from '../core/canvasAdapter'
import { gatherLayout, placeOnBoard, tidyFields, type GatherOffer } from './arrange'
import { newBoard } from './boards'
import { tellFull, withFields } from './fitting'

/** Gather the offer's loose pictures into a new board of their purpose. Returns the new frame's id. */
export async function gatherIntoBoard(canvas: CanvasAdapter, store: DocumentStore, offer: GatherOffer): Promise<string> {
  const doc = store.get() as unknown as ProductionDocument
  const probe = newBoard(canvas, doc, { rect: { x: 0, y: 0, w: 10, h: 10 }, title: offer.title, purpose: offer.purpose })
  const { rect, fields } = gatherLayout(canvas.elements(), doc, offer, probe.frame.id)
  const frame = canvas.patch(probe.frame, { x: rect.x, y: rect.y, width: rect.w, height: rect.h })
  await systemUpdate(store, (d) => { (d as unknown as ProductionDocument).boards[probe.board.id] = probe.board }, 'gather into a board')
  canvas.transact((els) => [frame, ...withFields(canvas, els, fields)], { undoable: true })
  canvas.select(offer.ids)
  return frame.id
}

/** Move the offer's pictures onto its existing board, each key or role in its row (nothing there moves). */
export function moveIntoBoard(canvas: CanvasAdapter, doc: ProductionDocument, offer: GatherOffer): boolean {
  const frameId = offer.existing
  if (!frameId) return false
  let fit: ReturnType<typeof placeOnBoard> | null = null
  canvas.transact((els) => {
    fit = placeOnBoard(els, doc, frameId, offer.ids)
    return withFields(canvas, els, fit.fields)
  }, { undoable: true })
  if (fit) tellFull(frameId, fit)
  canvas.select(offer.ids)
  return true
}

/** Tidy a board: its members lined up by its purpose, as one undo step. False when nothing moves. */
export function tidyBoard(canvas: CanvasAdapter, doc: ProductionDocument, frameId: string): boolean {
  const fields = tidyFields(canvas.elements(), doc, frameId)
  if (!fields.size) return false
  canvas.transact((els) => withFields(canvas, els, fields), { undoable: true })
  return true
}
