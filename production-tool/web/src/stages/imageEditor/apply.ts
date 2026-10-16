// Apply as new version (ui-behaviour 3.12; features/image-editor.clan): the composed picture saved
// as v(n+1), kind edited, with the edits that made it; v(n) is left as it was; v(n+1) becomes the
// shot's frame on the storyboard and the shot's clip is marked out of date. The caller runs this in
// one updateDoc, so it is one undo step. A canvas picture's Apply is below.

import { newUlidId } from '../../../../clan-store/src'
import type { Frame, Mime, ProductionDocument } from '../../contracts/types'
import { idbLocation } from '../../lib/blobs'
import { currentPictureFrame, framesOf, pictureVersions, refsList } from '../../model/selectors'
import { markStale } from '../../doc/remove'
import { nameOf } from '../../lib/names'
import { refreshClipStale } from '../../jobs/stale'
import { systemUpdate, updateDoc } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'

export interface Edited { sha: string; bytes: number; w: number; h: number; edits: Frame['edits'] }

export function applyEdited(d: ProductionDocument, shotId: string, parentId: string, out: Edited): Frame | undefined {
  const shot = d.shots[shotId]
  const parent = d.frames[parentId]
  if (!shot || !parent) return undefined
  if (!d.assets[out.sha]) {
    d.assets[out.sha] = { sha256: out.sha, kind: 'image', mime: 'image/png' as Mime, bytes: out.bytes, w: out.w, h: out.h,
      origin: 'edited', locations: [idbLocation(out.sha)] }
  }
  const frame: Frame = {
    id: newUlidId('frame'),
    v: 1,
    field_v: {},
    shot_id: shotId,
    version: Math.max(0, ...framesOf(d, shotId).map((f) => f.version)) + 1,
    parent_id: parentId,
    kind: 'edited',
    asset: out.sha,
    crew: 'rhea',
    ...(out.edits?.length ? { edits: out.edits } : {}),
  }
  d.frames[frame.id] = frame
  const alternates = shot.pick?.alternates?.filter((a) => a !== frame.id) ?? [] // as selectFrame keeps them
  shot.pick = { current: frame.id, ...(alternates.length ? { alternates } : {}) }
  refreshClipStale(d, shotId)
  return frame
}

/** Apply as one undo step: "apply edits as v4". */
export async function applyEditedStep(store: DocumentStore, shotId: string, parentId: string, out: Edited): Promise<Frame | undefined> {
  let made: Frame | undefined
  const next = Math.max(0, ...framesOf(store.get(), shotId).map((f) => f.version)) + 1
  await updateDoc(store, (d) => { made = applyEdited(d, shotId, parentId, out) }, `apply edits as v${next}`)
  return made
}

// ── A canvas picture's versions (features/edit-canvas-pictures.clan) ──
// The picture's versions are frames owned by its canvas node (Frame.node). v1, kind original, is the
// picture as it was before its first edit, written with the first Apply. The picture shows the version
// with the latest picked_at; the canvas element mirrors it (CanvasController.syncPictureVersions). A
// ref on the node follows the version shown, and what was made from the picture it showed is marked to
// check, as when a name moves. Each is one updateDoc, so one undo step takes all of it back.

/** The picture on the canvas as it is now: its node, its picture and size. */
export interface CanvasPicture { nodeId: string; sha: string; w?: number; h?: number }

/** An ISO time after `after` (the picture's latest pick), so a new pick is always the latest. */
function pickTime(now: string, after: string | undefined): string {
  if (!after || now > after) return now
  return new Date(Date.parse(after) + 1).toISOString()
}

/** The ref on the node follows the picture it now shows; what was made from the old one is marked. */
function followPicture(d: ProductionDocument, nodeId: string, from: string, to: Frame, now: string) {
  if (from === to.asset) return
  const ref = refsList(d).find((r) => r.node === nodeId)
  if (ref) {
    ref.asset = to.asset
    markStale(d, from, { kind: 'ref', id: ref.id }, `@${nameOf(ref)} now shows v${to.version} of its picture.`, now)
  } else {
    markStale(d, from, { kind: 'frame', id: to.id }, `The picture it was made from now shows v${to.version}.`, now)
  }
}

/** v1: the picture as it was on the canvas before its first edit, kept so it can be picked again. */
function keepOriginal(d: ProductionDocument, pic: CanvasPicture, now: string): Frame {
  const shown = currentPictureFrame(d, pic.nodeId)
  if (shown) return shown
  const f: Frame = { id: newUlidId('frame'), v: 1, field_v: {}, node: pic.nodeId, picked_at: now, version: 1, kind: 'original', asset: pic.sha }
  d.frames[f.id] = f
  return f
}

export function applyPictureEdited(d: ProductionDocument, pic: CanvasPicture, out: Edited, now = new Date().toISOString()): Frame | undefined {
  if (!d.assets[out.sha]) {
    d.assets[out.sha] = { sha256: out.sha, kind: 'image', mime: 'image/png' as Mime, bytes: out.bytes, w: out.w, h: out.h,
      origin: 'edited', locations: [idbLocation(out.sha)] }
  }
  const parent = keepOriginal(d, pic, now)
  const versions = pictureVersions(d, pic.nodeId)
  const frame: Frame = {
    id: newUlidId('frame'),
    v: 1,
    field_v: {},
    node: pic.nodeId,
    picked_at: pickTime(now, versions.map((f) => f.picked_at ?? '').sort().at(-1)),
    version: Math.max(0, ...versions.map((f) => f.version)) + 1,
    parent_id: parent.id,
    kind: 'edited',
    asset: out.sha,
    crew: 'rhea',
    ...(out.edits?.length ? { edits: out.edits } : {}),
  }
  d.frames[frame.id] = frame
  followPicture(d, pic.nodeId, parent.asset, frame, now)
  return frame
}

/** Apply on a canvas picture as one undo step: "apply edits to the picture as v2". Its v1 is kept first, as
 *  the app's own write (not a step): the undo takes v2 back to v1, which the canvas then shows again, after
 *  a reload too (the canvas keeps only the picture it shows). */
export async function applyPictureEditedStep(store: DocumentStore, pic: CanvasPicture, out: Edited): Promise<Frame | undefined> {
  if (!currentPictureFrame(store.get(), pic.nodeId)) await systemUpdate(store, (d) => { keepOriginal(d, pic, new Date().toISOString()) }, 'keep the picture as it was')
  let made: Frame | undefined
  const next = Math.max(1, ...pictureVersions(store.get(), pic.nodeId).map((f) => f.version)) + 1
  await updateDoc(store, (d) => { made = applyPictureEdited(d, pic, out) }, `apply edits to the picture as v${next}`)
  return made
}

/** Show an earlier (or later) version of a canvas picture again: it becomes the latest picked. */
export function pickPictureVersion(d: ProductionDocument, frameId: string, now = new Date().toISOString()): boolean {
  const f = d.frames[frameId]
  if (!f?.node) return false
  const shown = currentPictureFrame(d, f.node)
  if (!shown || shown.id === f.id) return false
  f.picked_at = pickTime(now, shown.picked_at)
  followPicture(d, f.node, shown.asset, f, now)
  return true
}

export function pickPictureVersionStep(store: DocumentStore, frameId: string) {
  const f = store.get().frames[frameId]
  return updateDoc(store, (d) => { pickPictureVersion(d, frameId) }, `show v${f?.version ?? ''} of the picture`)
}
