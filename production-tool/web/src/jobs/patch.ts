// Fix this moment (ui-behaviour 3.13, review item 8; features/clip-moment-edit.clan). The relay's clip_patch
// makes a note's window of a take again and splices it back (on Runway, the whole take goes to Aleph 2 with
// the window as the edit's range). These are the two pieces the web owns; the arithmetic is clan-store's
// (noteToTakeWindow, patchPlan, applyPatchTake), never redone here:
//
//   fixRoute   which fix a note gets: Fix this moment for a note with a window on a take in the cut,
//              ahead of "fix it in the shot" (a boxed note, jobs/fix.ts), else remaking the whole clip
//   landPatch  a finished clip_patch as a new take beside its parent (clan-store applyPatchGeneration):
//              one landing by Edie (landUpdate), never put in the cut, the note left open (Fix again makes
//              the next version; Resolve closes it)
//
// The video-editor mounts these (its Fix this moment panel); today's Video stage is unchanged.
// No price is shown anywhere (owner decision 2026-10-13).

import { applyPatchGeneration, noteToTakeWindow, type PatchDoc, type PatchJob } from '../../../clan-store/src'
import type { Controls } from '../capabilities'
import type { Generation, Job, NoteWindow, ProductionDocument, Review } from '../contracts/types'
import { landUpdate } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { currentTake, cutItemFor, shotName, takesOf } from '../model/selectors'
import { landingWhy } from './landing'

export type FixRoute =
  /** clip_patch on `takeId`: `window` and `atS` in take time, ready for the job's input. */
  | { route: 'patch'; shotId: string; takeId: string; window: NoteWindow; atS: number }
  /** fixInShot: the boxed note fixed in the storyboard frame, then the clip made again. */
  | { route: 'in_shot'; shotId: string }
  /** The whole clip made again, with why the narrower fixes do not apply. */
  | { route: 'remake'; shotId?: string; why: string }

/** The take a note is on: its own take (a note from the take player), else the shot's take in the cut. */
function noteTake(d: ProductionDocument, note: Review): Generation | undefined {
  if (note.target.kind === 'generation') return d.generations[note.target.id]
  return note.shot_id ? currentTake(d, note.shot_id) : undefined
}

/**
 * Which fix a note gets. A note with a window on a take in the cut is fixed in that moment (Fix this
 * moment), even when it also has a box: the window is the narrower change. A boxed note without one is
 * fixed in the shot's frame. Anything else remakes the clip.
 */
export function fixRoute(d: ProductionDocument, note: Review, controls: Pick<Controls, 'fixMoment' | 'fixInShot'>): FixRoute {
  const take = noteTake(d, note)
  const shotId = note.shot_id ?? take?.shot_ids[0]
  if (controls.fixMoment && take && shotId && note.window && note.at_s != null) {
    const item = cutItemFor(d, shotId)?.source
    const tw = noteToTakeWindow(note, { duration_s: take.duration_s ?? 0 }, item ? { in_s: item.in_s, out_s: item.out_s } : null)
    if (tw?.inCut) return { route: 'patch', shotId, takeId: take.id, window: tw.window, atS: tw.atS }
  }
  if (controls.fixInShot && note.region && shotId) return { route: 'in_shot', shotId }
  const why = !controls.fixMoment ? 'Fix this moment is off'
    : !take ? 'the note is not on a clip'
    : !note.window || note.at_s == null ? 'the note has no moment'
    : 'the moment is outside what the cut plays'
  return { route: 'remake', ...(shotId ? { shotId } : {}), why }
}

/** Edie's landing of a finished clip_patch: "edit take v3 for shot 4", one decision, never an undo step.
 *  Landing the same job twice changes nothing. */
export function landPatch(store: DocumentStore, job: Job, ctx: { shotId: string; parentTakeId: string; note?: string }): Promise<ProductionDocument> {
  const d = store.get()
  if (!job.outputs?.length || !job.patch || Object.values(d.generations).some((g) => g.job_id === job.jobId)) return Promise.resolve(d)
  const what = `take v${takesOf(d, ctx.shotId).length + 1} for ${shotName(d, ctx.shotId)}`
  const by = d.jobs[job.jobId]?.started_by ?? d.project.created_by
  const now = d.jobs[job.jobId]?.created_at ?? new Date().toISOString()
  return landUpdate(store, (x) => {
    applyPatchGeneration(x as unknown as PatchDoc, job as unknown as PatchJob, { parentId: ctx.parentTakeId, by, now, ...(ctx.note ? { note: ctx.note } : {}) })
  }, landingWhy(store, job.jobId, what))
}
