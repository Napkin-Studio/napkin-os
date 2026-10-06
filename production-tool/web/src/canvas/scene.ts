// Helpers over the Excalidraw scene: reading our customData, making the tool's
// own elements (sketch frame, gen placeholders, provenance arrows) and image
// files. Every element the tool owns carries customData per
// customdata.schema.json; elements without it are the user's own drawing.

import { convertToExcalidrawElements, exportToBlob, getCommonBounds, newElementWith } from '@excalidraw/excalidraw'
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { CustomData, View } from '../contracts/types'
import { hexOf } from '../lib/hash'

export type El = ExcalidrawElement
export const ACCENT = '#FF4F2E'
export const MAX_SIDE = 1536

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

export function sketchFrame(els: readonly El[]): El | undefined {
  return els.find((e) => !e.isDeleted && cd(e)?.kind === 'sketch')
}

export function childrenOf(els: readonly El[], frameId: string): El[] {
  return els.filter((e) => !e.isDeleted && e.frameId === frameId)
}

/** The user's own marks (not the tool's), for "Use as reference" and the empty-canvas hint. */
export function isUserDrawing(e: El): boolean {
  return !e.isDeleted && !cd(e) && e.type !== 'image' && e.type !== 'frame' && e.type !== 'magicframe'
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

/** Downscale to ≤1536 px on the long side; the result is the artifact that gets hashed. */
export async function downscale(blob: Blob, max = MAX_SIDE): Promise<{ blob: Blob; w: number; h: number; changed: boolean }> {
  const bmp = await createImageBitmap(blob)
  const { width, height } = bmp
  const scale = Math.min(1, max / Math.max(width, height))
  const okType = blob.type === 'image/png' || blob.type === 'image/jpeg' || blob.type === 'image/webp'
  if (scale === 1 && okType) {
    bmp.close?.()
    return { blob, w: width, h: height, changed: false }
  }
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const type = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const out = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not resize the picture.'))), type, 0.9))
  return { blob: out, w, h, changed: true }
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

export function makeSketchFrame(id: string): El[] {
  return convertToExcalidrawElements(
    [{ type: 'frame', id: `el_${id}`, x: 0, y: 0, width: 600, height: 800, name: 'Draw your character here', children: [], customData: { kind: 'sketch', id, template: 'character-3x4' } }],
    { regenerateIds: false },
  )
}

export function makeGenPlaceholder(jobId: string, op: 'generate' | 'combine' | 'view' | 'region_edit', parentIds: string[], at: { x: number; y: number }, size = { w: 300, h: 400 }, view?: View): El {
  const customData: CustomData = { kind: 'gen', id: jobId, op, parentIds, state: 'queued' }
  if (view) customData.view = view
  const [el] = convertToExcalidrawElements(
    [{ type: 'image', id: jobId, x: at.x, y: at.y, width: size.w, height: size.h, fileId: null as unknown as FileId, customData }],
    { regenerateIds: false },
  )
  return newElementWith(el as ExcalidrawImageElement, { status: 'pending', fileId: null })
}

/** A provenance arrow from one element to another, bound at both ends so it follows them. */
export function makeArrow(from: El, to: El, fromId: string, toId: string): El {
  const fb = bounds([from])
  const tb = bounds([to])
  const start = { x: fb.maxX + 8, y: fb.minY + fb.h / 2 }
  const end = { x: tb.minX - 8, y: tb.minY + tb.h / 2 }
  const [arrow] = convertToExcalidrawElements(
    [{
      type: 'arrow', x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y,
      points: [[0, 0], [end.x - start.x, end.y - start.y]] as never,
      strokeColor: ACCENT, strokeWidth: 2, strokeStyle: 'dashed', roughness: 0, endArrowhead: 'arrow',
      customData: { kind: 'provenance', from: fromId, to: toId },
    }],
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
