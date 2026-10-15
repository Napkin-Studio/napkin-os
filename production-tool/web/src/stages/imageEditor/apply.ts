// Apply as new version (ui-behaviour 3.12; features/image-editor.clan): the composed picture saved
// as v(n+1), kind edited, with the edits that made it; v(n) is left as it was; v(n+1) becomes the
// shot's frame on the storyboard and the shot's clip is marked out of date. The caller runs this in
// one updateDoc, so it is one undo step.

import { newUlidId } from '../../../../clan-store/src'
import type { Frame, Mime, ProductionDocument } from '../../contracts/types'
import { idbLocation } from '../../lib/blobs'
import { framesOf } from '../../model/selectors'
import { refreshClipStale } from '../../jobs/stale'
import { updateDoc } from '../../doc/store'
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
