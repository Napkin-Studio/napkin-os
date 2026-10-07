// Helpers over the Excalidraw scene: reading our customData, making the tool's
// own elements (drawn frames, gen placeholders, curved provenance arrows) and
// image files. Every element the tool owns carries customData per
// customdata.schema.json; elements without it are the user's own drawing.

import { convertToExcalidrawElements, exportToBlob, getCommonBounds, newElementWith } from '@excalidraw/excalidraw'
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { CustomData, GenOp, Sha256, View } from '../contracts/types'
import { hexOf } from '../lib/hash'
import { bendAway, curvePoints } from './curve'
import { fitSize } from './fit'

export type El = ExcalidrawElement
export const ACCENT = '#FF4F2E'

export function cd(el: El | undefined): CustomData | undefined {
  const c = el?.customData as CustomData | undefined
  return c && typeof c === 'object' && 'kind' in c ? c : undefined
}

export function idOf(el: El): string | undefined {
  const c = cd(el)
  if (!c || c.kind === 'provenance') return undefined
  return c.id
}

export const alive = (els: readonly El[]) => els.filter((e) => !e.isDeleted)

export function byOwnId(els: readonly El[], id: string): El | undefined {
  return els.find((e) => !e.isDeleted && (e.id === id || idOf(e) === id))
}

/** An image node (picture, drawing frame or generated image) and its picture, when it has one yet. */
export function imageOf(el: El | undefined): { id: string; asset?: Sha256; kind: 'pic' | 'drawn' | 'gen' } | undefined {
  const c = cd(el)
  if (c?.kind === 'pic' || c?.kind === 'drawn') return { id: c.id, asset: c.asset, kind: c.kind }
  if (c?.kind === 'gen') return { id: c.id, asset: c.asset, kind: 'gen' }
  return undefined
}

export function childrenOf(els: readonly El[], frameId: string): El[] {
  return els.filter((e) => !e.isDeleted && e.frameId === frameId)
}

/** The user's own marks (not the tool's, not text): strokes and shapes. */
export function isUserDrawing(e: El): boolean {
  return !e.isDeleted && !cd(e) && e.type !== 'image' && e.type !== 'frame' && e.type !== 'magicframe' && e.type !== 'text' && e.type !== 'arrow'
}

/** Words on the canvas: a text element, loose or used as a note. */
export function isText(e: El): boolean {
  return !e.isDeleted && e.type === 'text' && (!cd(e) || cd(e)?.kind === 'note')
}

export function textOf(e: El): string {
  const t = e as El & { originalText?: string; text?: string }
  return (t.originalText ?? t.text ?? '').trim()
}

export function bounds(els: readonly El[]) {
  const [minX, minY, maxX, maxY] = getCommonBounds(els)
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

export function fileIdFor(sha: string): FileId {
  return hexOf(sha).slice(0, 40) as FileId
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

export async function fileData(sha: string, blob: Blob): Promise<BinaryFileData> {
  return {
    id: fileIdFor(sha),
    dataURL: (await blobToDataURL(blob)) as BinaryFileData['dataURL'],
    mimeType: (blob.type || 'image/png') as BinaryFileData['mimeType'],
    created: Date.now(),
  }
}

/**
 * Fit a picture for providers (fit.ts): short side ≥ 512 px, long side ≤ 1536 px, aspect within
 * 2.5:1, padded with white. The result is the artifact that gets hashed and sent.
 */
export async function downscale(blob: Blob): Promise<{ blob: Blob; w: number; h: number; changed: boolean }> {
  const bmp = await createImageBitmap(blob)
  const f = fitSize(bmp.width, bmp.height)
  const okType = blob.type === 'image/png' || blob.type === 'image/jpeg' || blob.type === 'image/webp'
  if (f.same && okType) {
    bmp.close?.()
    return { blob, w: f.w, h: f.h, changed: false }
  }
  const c = document.createElement('canvas')
  c.width = f.canvasW
  c.height = f.canvasH
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, Math.round((f.canvasW - f.w) / 2), Math.round((f.canvasH - f.h) / 2), f.w, f.h)
  bmp.close?.()
  const type = blob.type === 'image/jpeg' && f.canvasW === f.w && f.canvasH === f.h ? 'image/jpeg' : 'image/png'
  const out = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not resize the picture.'))), type, 0.9))
  return { blob: out, w: f.canvasW, h: f.canvasH, changed: true }
}

/** Export some elements to a PNG, without the tool's labels and arrows. */
export async function exportElements(els: readonly El[], files: BinaryFiles): Promise<Blob> {
  const drawn = els.filter((e) => !e.isDeleted && e.type !== 'arrow' && e.type !== 'text' && cd(e)?.kind !== 'provenance')
  return await exportToBlob({
    elements: drawn,
    files,
    mimeType: 'image/png',
    exportPadding: 24,
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
  })
}

export function makeGenPlaceholder(jobId: string, op: GenOp, parentIds: string[], at: { x: number; y: number }, size = { w: 300, h: 400 }, view?: View): El {
  const customData: CustomData = { kind: 'gen', id: jobId, op, parentIds, state: 'queued' }
  if (view) customData.view = view
  const [el] = convertToExcalidrawElements(
    [{ type: 'image', id: jobId, x: at.x, y: at.y, width: size.w, height: size.h, fileId: null as unknown as FileId, customData }],
    { regenerateIds: false },
  )
  return newElementWith(el as ExcalidrawImageElement, { status: 'pending', fileId: null })
}

/**
 * A curved provenance arrow from one element to another, bound at both ends so it follows them.
 * `over`: leave and arrive on the top edges and arc above, for a row of results made from one
 * source (the views), so the arrow never crosses the nodes between them.
 */
export function makeArrow(from: El, to: El, fromId: string, toId: string, index = 0, over = false): El {
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
  const points = curvePoints(start, end, bend)
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const [arrow] = convertToExcalidrawElements(
    [{
      type: 'arrow', x: start.x, y: start.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      points: points as never, roundness: { type: 2 },
      strokeColor: ACCENT, strokeWidth: 2, strokeStyle: 'dashed', roughness: 0, endArrowhead: 'arrow',
      customData: { kind: 'provenance', from: fromId, to: toId },
    } as never],
  )
  return newElementWith(arrow, {
    startBinding: { elementId: from.id, focus: 0, gap: 8 },
    endBinding: { elementId: to.id, focus: 0, gap: 8 },
  } as never)
}

/** Add an arrow to its endpoints' boundElements so Excalidraw moves it with them. */
export function bindArrow(els: El[], arrow: El): El[] {
  const a = arrow as El & { startBinding?: { elementId: string }; endBinding?: { elementId: string } }
  const ids = [a.startBinding?.elementId, a.endBinding?.elementId]
  return els.map((e) =>
    ids.includes(e.id) ? newElementWith(e, { boundElements: [...(e.boundElements ?? []), { id: arrow.id, type: 'arrow' }] }) : e,
  )
}

/** Where the next output beside `anchor` goes: right of anything already in that row. */
export function nextSlot(els: readonly El[], anchor: { maxX: number; minY: number }, size: { w: number; h: number }, gap = 80) {
  const y = anchor.minY
  const inRow = alive(els).filter((e) => e.type !== 'arrow' && e.y < y + size.h && e.y + e.height > y && e.x + e.width > anchor.maxX)
  const x = Math.max(anchor.maxX, ...inRow.map((e) => e.x + e.width)) + gap
  return { x, y, w: size.w, h: size.h }
}
