// Pictures onto a canvas that has no picture tool of its own (our own engine; ui-behaviour 3.6, 3.18):
// the Picture tool's file picker, a dropped file and a pasted image all land here. Each picture is
// downscaled to at most 1536 px, kept by its sha256, given to the engine and placed as a `pic` node
// (as the controller's intake makes them on Excalidraw), all of them as one undoable step, and
// selected, so the selection bar offers naming it (@name and its role).

import type { Mime } from '../../contracts/types'
import { systemUpdate } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'
import { idbLocation, putBlob } from '../../lib/blobs'
import { downscale } from '../../lib/fitImage'
import { newId } from '../../lib/ulid'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { assetData } from '../scene'

/** A picture node's width on the canvas (the controller's NODE). */
export const PICTURE_W = 300
const GAP = 40

/** The image files among dropped or pasted ones. */
export const imageFiles = (files: Iterable<File | Blob> | null | undefined): Blob[] =>
  [...(files ?? [])].filter((f) => /^image\//.test(f.type))

/** Where `n` pictures of these sizes go: a row centred on `at`. Pure. */
export function pictureRow(at: Pt, sizes: readonly { w: number; h: number }[]): { x: number; y: number; w: number; h: number }[] {
  const boxes = sizes.map((s) => ({ w: PICTURE_W, h: Math.round((PICTURE_W * s.h) / Math.max(1, s.w)) }))
  const total = boxes.reduce((a, b) => a + b.w, 0) + GAP * Math.max(0, boxes.length - 1)
  let x = at.x - total / 2
  return boxes.map((b) => {
    const out = { x: Math.round(x), y: Math.round(at.y - b.h / 2), ...b }
    x += b.w + GAP
    return out
  })
}

/**
 * Put pictures on the canvas, centred on `at` (else the middle of the view), as one undoable step, and
 * select them. Their assets go into the document (a system write). Returns the new elements.
 */
export async function placePictures(canvas: CanvasAdapter, doc: DocumentStore, files: readonly Blob[], at?: Pt): Promise<CanvasElement[]> {
  const got: { sha: string; blob: Blob; w: number; h: number }[] = []
  for (const f of files) {
    const { blob, w, h } = await downscale(f)
    const sha = await putBlob(blob)
    got.push({ sha, blob, w, h })
  }
  if (!got.length) return []
  canvas.addAssets(await Promise.all(got.map((g) => assetData(g.sha, g.blob))))
  await systemUpdate(doc, (d) => {
    for (const g of got) {
      if (d.assets[g.sha]) continue
      d.assets[g.sha] = { sha256: g.sha, kind: 'image', mime: (g.blob.type || 'image/png') as Mime, bytes: g.blob.size, w: g.w, h: g.h, origin: 'uploaded', locations: [idbLocation(g.sha)] }
    }
  }, 'add picture')
  const v = canvas.visibleBounds()
  const centre = at ?? { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 }
  const row = pictureRow(centre, got)
  const els = got.map((g, i) => canvas.imageNode({
    x: row[i].x, y: row[i].y, width: row[i].w, height: row[i].h, assetSha: g.sha, status: 'saved',
    customData: { kind: 'pic', id: newId('node'), asset: g.sha },
  }))
  canvas.transact((all) => [...all, ...els], { undoable: true })
  canvas.select(els.map((e) => e.id))
  return els
}

/** Ask the person for picture files (the Picture tool): resolves with what they picked, [] for none. */
export function pickPictureFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.style.display = 'none'
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])])
      input.remove()
    })
    input.addEventListener('cancel', () => {
      resolve([])
      input.remove()
    })
    document.body.appendChild(input)
    input.click()
  })
}
