// Helpers over the canvas scene: reading our customData, making the tool's
// own elements (drawn frames, gen placeholders, curved provenance arrows) and
// pictures' bytes. Every element the tool owns carries customData per
// customdata.schema.json; elements without it are the user's own drawing.
// The engine's calls go through CanvasAdapter v2 over the engine-neutral
// CanvasElement (features/canvas-core.clan, features/engine-adapter.clan);
// the pure readers live in sceneRead.ts and are re-exported here.

import type { CustomData, GenOp, View } from '../contracts/types'
import type { CanvasAdapter, CanvasAsset, CanvasElement } from './core/canvasAdapter'
import { elementBounds } from './core/geometry'
import { bendAway, curvePoints } from './curve'
import { alive, cd } from './sceneRead'

export { alive, byOwnId, cd, childrenOf, idOf, imageOf, isText, isUserDrawing, textOf } from './sceneRead'

export type El = CanvasElement
/** The canvas as the tool uses it: whichever engine is mounted, behind CanvasAdapter v2. */
export type Canvas = CanvasAdapter
export const ACCENT = '#FF4F2E'

export function bounds(els: readonly El[]) {
  return elementBounds(els)
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function dataURLToBlob(dataURL: string): Promise<Blob> {
  const res = await fetch(dataURL)
  return await res.blob()
}

/** A picture's bytes for the canvas, keyed by its sha256. */
export async function assetData(sha: string, blob: Blob): Promise<CanvasAsset> {
  return { sha256: sha, dataURL: await blobToDataURL(blob), mimeType: blob.type || 'image/png' }
}

export { downscale } from '../lib/fitImage'

/** Export some elements to a PNG, without the tool's labels and arrows. */
export async function exportElements(canvas: Canvas, els: readonly El[]): Promise<Blob> {
  const drawn = els.filter((e) => !e.isDeleted && e.type !== 'arrow' && e.type !== 'text' && cd(e)?.kind !== 'provenance')
  return await canvas.exportPng(drawn, { padding: 24, background: '#ffffff' })
}

/** `shape`: a resize's shape chip ("9:16"), shown on the result (features/resize-selection.clan). */
export function makeGenPlaceholder(canvas: Canvas, jobId: string, op: GenOp, parentIds: string[], at: { x: number; y: number }, size = { w: 300, h: 400 }, view?: View, shape?: string): El {
  const customData: CustomData = { kind: 'gen', id: jobId, op, parentIds, state: 'queued' }
  if (view) customData.view = view
  if (shape) customData.shape = shape
  return canvas.imageNode({ id: jobId, x: at.x, y: at.y, width: size.w, height: size.h, assetSha: null, customData, status: 'pending', keepIds: true })
}

/**
 * A curved provenance arrow from one element to another, bound at both ends so it follows them.
 * `over`: leave and arrive on the top edges and arc above, for a row of results made from one
 * source (the views), so the arrow never crosses the nodes between them.
 */
export function makeArrow(canvas: Canvas, from: El, to: El, fromId: string, toId: string, index = 0, over = false): El {
  const fb = bounds([from])
  const tb = bounds([to])
  let start: { x: number; y: number }
  let end: { x: number; y: number }
  let bend: number
  if (over) {
    start = { x: fb.minX + fb.w / 2, y: fb.minY - 8 }
    end = { x: tb.minX + tb.w / 2, y: tb.minY - 8 }
    bend = end.x >= start.x ? -0.22 : 0.22 // the middle point goes up
  } else {
    // Leave from the side facing the target, arrive on the side facing the source.
    const rightward = tb.minX >= fb.maxX
    start = { x: rightward ? fb.maxX + 8 : fb.minX - 8, y: fb.minY + fb.h / 2 }
    end = { x: rightward ? tb.minX - 8 : tb.maxX + 8, y: tb.minY + tb.h / 2 }
    bend = bendAway(end.x - start.x, fb.minY + fb.h / 2 - (tb.minY + tb.h / 2), index)
  }
  return canvas.provenanceArrow({
    origin: start, points: curvePoints(start, end, bend), fromElId: from.id, toElId: to.id, color: ACCENT,
    customData: { kind: 'provenance', from: fromId, to: toId },
  })
}

/** Where the next output beside `anchor` goes: right of anything already in that row. */
export function nextSlot(els: readonly El[], anchor: { maxX: number; minY: number }, size: { w: number; h: number }, gap = 80) {
  const y = anchor.minY
  const inRow = alive(els).filter((e) => e.type !== 'arrow' && e.y < y + size.h && e.y + e.height > y && e.x + e.width > anchor.maxX)
  const x = Math.max(anchor.maxX, ...inRow.map((e) => e.x + e.width)) + gap
  return { x, y, w: size.w, h: size.h }
}
