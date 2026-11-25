// Pictures onto a canvas that has no picture tool of its own (our own engine; ui-behaviour 3.6, 3.18):
// the Picture tool's file picker, a dropped file and a pasted image all land here. Each picture is
// downscaled to at most 1536 px, kept by its sha256, given to the engine and placed as a `pic` node
// (as the controller's intake makes them on Excalidraw), all of them as one undoable step, and
// selected, so the selection bar offers naming it (@name and its role). Many at once land as a grid, not a row. Dropped on a board (or placed
// with a board in the middle of the view), they go into it: its next free slots, the board growing to
// hold them, or just outside when it cannot grow (boards/fitting; owner decision 2026-10-15).

import type { Mime } from '../../contracts/types'
import { systemUpdate } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'
import { putBlob } from '../../lib/blobs'
import { downscale } from '../../lib/fitImage'
import { newId } from '../../lib/ulid'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { assetData } from '../scene'
import { boardAt, clearOffset, fitInto, tellFull, withFields } from '../boards/fitting'
import { bringIntoView } from '../boards/boards'
import { cardOf } from './nodes'

/** A picture node's width on the canvas (the controller's NODE). */
export const PICTURE_W = 300
const GAP = 40

/** The image files among dropped or pasted ones. */
export const imageFiles = (files: Iterable<File | Blob> | null | undefined): Blob[] =>
  [...(files ?? [])].filter((f) => /^image\//.test(f.type))

/** Room under each row of a grid for a picture's @name. */
const NAME_ROOM = 24
/** Room above pictures for a key group's label ("Ruby · 3 views") once they are named. */
const LABEL_ROOM = 40

/** The boxes as they need room once named: the @name under each, a key group's label over them (UAT round 3, IMG-22
 *  leftover: three uploads landed flush on the row below; named, their group's names lay over that row's captions). */
export function withLabelRoom<T extends { x: number; y: number; w: number; h: number }>(boxes: readonly T[]): T[] {
  // A name and a label sit between any two rows, whichever is above: the same room on both sides.
  const room = LABEL_ROOM
  return boxes.map((b) => ({ ...b, y: b.y - room, h: b.h + 2 * room }))
}

/** How many pictures go across: up to 4 in one row, more in a grid about half again as wide as it is tall (UAT round
 *  1 IMG-14: 13 uploads landed in one 4400 px row, most of them out of view). */
export function gridColumns(n: number): number {
  return n <= 4 ? Math.max(1, n) : Math.min(6, Math.ceil(Math.sqrt(n * 1.5)))
}

/** Where `n` pictures of these sizes go: a grid (gridColumns across, in order) centred on `at`. Pure. */
export function pictureGrid(at: Pt, sizes: readonly { w: number; h: number }[]): { x: number; y: number; w: number; h: number }[] {
  const boxes = sizes.map((s) => ({ w: PICTURE_W, h: Math.round((PICTURE_W * s.h) / Math.max(1, s.w)) }))
  const cols = gridColumns(boxes.length)
  const rows: (typeof boxes)[] = []
  for (let i = 0; i < boxes.length; i += cols) rows.push(boxes.slice(i, i + cols))
  const rowH = rows.map((r) => Math.max(...r.map((b) => b.h)))
  const width = Math.min(cols, boxes.length) * PICTURE_W + GAP * (Math.min(cols, boxes.length) - 1)
  const height = rowH.reduce((a, h) => a + h, 0) + (GAP + NAME_ROOM) * (rows.length - 1)
  const out: { x: number; y: number; w: number; h: number }[] = []
  let y = at.y - height / 2
  rows.forEach((r, k) => {
    let x = at.x - width / 2
    for (const b of r) {
      // One row alone keeps each picture centred on the line, as before; a grid's rows line up at the top.
      out.push({ x: Math.round(x), y: Math.round(rows.length === 1 ? at.y - b.h / 2 : y), ...b })
      x += b.w + GAP
    }
    y += rowH[k] + GAP + NAME_ROOM
  })
  return out
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
      d.assets[g.sha] = { sha256: g.sha, kind: 'image', mime: (g.blob.type || 'image/png') as Mime, bytes: g.blob.size, w: g.w, h: g.h, origin: 'uploaded', rights: 'unknown' }
    }
  }, 'add picture')
  const v = canvas.visibleBounds()
  // Picked (not dropped) with one board selected, the pictures go on that board (UAT round 4 gate: a logo picked for the
  // Brand board landed next to it, and had to be dragged on).
  const chosen = at ? undefined : selectedBoard(canvas)
  const centre = at ?? (chosen ? { x: chosen.x + chosen.width / 2, y: chosen.y + chosen.height / 2 } : { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 })
  let row = pictureGrid(centre, got)
  // Pasted or picked (no point given) with no board under the middle of the view: clear of everything,
  // so pastes never pile on one spot or straddle a board's edge (board-autolayout).
  if (!at && !boardAt(canvas.elements(), centre)) {
    const { dx, dy } = clearOffset(canvas.elements(), withLabelRoom(row))
    row = row.map((r) => ({ ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) }))
  }
  // Dropped over a node (Script, Storyboard, Video): the card would hide the picture and take its clicks,
  // so it moves to the nearest clear spot; anywhere else a drop lands where it was let go (2026-10-16).
  if (at && !boardAt(canvas.elements(), centre)) {
    const cards = canvas.elements().filter((e) => !e.isDeleted && !!cardOf(e))
    const covers = (r: { x: number; y: number; w: number; h: number }, e: CanvasElement) =>
      r.x < e.x + e.width && e.x < r.x + r.w && r.y < e.y + e.height && e.y < r.y + r.h
    if (row.some((r) => cards.some((c) => covers(r, c)))) {
      const { dx, dy } = clearOffset(cards, row)
      row = row.map((r) => ({ ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) }))
    }
  }
  const els = got.map((g, i) => canvas.imageNode({
    x: row[i].x, y: row[i].y, width: row[i].w, height: row[i].h, assetSha: g.sha, status: 'saved',
    customData: { kind: 'pic', id: newId('node'), asset: g.sha },
  }))
  const board = boardAt(canvas.elements(), centre)
  let fit: ReturnType<typeof fitInto> | null = null
  canvas.transact((all) => {
    const next = [...all, ...els]
    if (!board) return next
    fit = fitInto(next, board.id, els.map((e) => [e.id]))
    return withFields(canvas, next, fit.fields)
  }, { undoable: true })
  if (board && fit) tellFull(board.id, fit)
  const ids = new Set(els.map((e) => e.id))
  const placed = canvas.elements().filter((e) => ids.has(e.id))
  canvas.select(placed.map((e) => e.id))
  // Many at once: all of them in view (a pan, or a zoom out only when they do not fit).
  if (placed.length > 1 && canvas.engine === 'own') {
    const b = { minX: Math.min(...placed.map((e) => e.x)), minY: Math.min(...placed.map((e) => e.y)), maxX: Math.max(...placed.map((e) => e.x + e.width)), maxY: Math.max(...placed.map((e) => e.y + e.height)) }
    bringIntoView(canvas, b, 0, !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches))
  }
  return placed
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

/** The board that is the whole selection, if one is. */
function selectedBoard(canvas: CanvasAdapter): CanvasElement | undefined {
  const ids = canvas.view().selectedIds
  if (ids.length !== 1) return undefined
  const e = canvas.elements().find((x) => x.id === ids[0] && !x.isDeleted)
  return e && (e.customData as { kind?: string } | undefined)?.kind === 'board' ? e : undefined
}
