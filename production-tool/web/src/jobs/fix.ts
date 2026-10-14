// "Fix it in the shot" (decided 2026-10-07): a note with a box, drawn on the
// paused clip, is fixed in the storyboard frame the clip starts from, then the
// clip is made again from the fixed frame. A clip cannot lose something its
// first frame has (the FACET ad's "Dialogue" card), so editing the clip alone
// would never remove it.
//
//   1. region_edit on the shot's picked frame, with the box and the note
//      (the frame region-edit path: marked copy and paste-back on Runway);
//   2. when it lands, the new frame version is picked (applyFrame), and
//   3. a clip is made from it; the notes are resolved when that take lands.
//
// What a fix is for is in the document (the jobs' purposes: fixReviewIds on the
// frame edit, reviewIds on the clip); the clip model picked for step 3 is this
// browser's (JobLocal.fixModelChoice).
//
// It needs no video region support at the provider, only frame region edits.

import type { ModelChoice, ProductionDocument, Review } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { clipText as cutText } from '../lib/guard'
import { jobsList, shotsOf } from '../model/selectors'
import { assetRef } from './assets'
import { makeClip, selectedTake } from './clips'
import { continuity, ownAspect, selectedFrame, type FrameDeps } from './frames'
import { isActive, jobCtx } from './runner'

/** The notes' text for the clip: every note but the boxed one (that went into the frame). */
function clipText(notes: Review[], boxedId: string): string | undefined {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
  const rest = notes.filter((r) => r.id !== boxedId).map((r) => `At ${fmt(r.at_s ?? 0)}: ${r.text ?? ''}`)
  return rest.length ? cutText(rest.join('\n'), 1000) : undefined
}

/** Start the fix: the region edit on the shot's picked frame. `notes` are the open notes on the clip; one has a box.
 * `modelChoice`: the clip model picked in the menu, kept with the fix so step 3 uses it, after a reload too. */
export async function fixInShot(deps: FrameDeps, shotId: string, notes: Review[], modelChoice?: ModelChoice): Promise<string> {
  const boxed = notes.find((r) => r.region)
  if (!boxed?.region) throw new Error('Draw a box on the paused clip first.')
  const d = deps.doc.get()
  const index = shotsOf(d).findIndex((s) => s.id === shotId)
  const frame = selectedFrame(d, shotId)
  if (index < 0 || !frame) throw new Error('This shot has no frame to fix.')
  const image = await assetRef(deps.relay, frame.asset)
  // The box was drawn on a paused frame of the clip, not on the storyboard frame. The clip
  // starts from that frame with the same framing (image to video keeps the first frame), so
  // the 0-1 region maps across as it is, even when the paused moment is later in the clip.
  const region = boxed.region
  // Like any frame region edit, it keeps the frame in its sequence: shot 1's frame and the one before go too.
  const anchors = await continuity(deps.relay, d, index)
  const own = ownAspect(d, frame.asset)
  return deps.runner.submit(
    'region_edit',
    { image, region, text: cutText(boxed.text ?? '', 1000), ...anchors, ...(own ? { aspect: own } : {}) },
    frame.job_id ? [frame.job_id] : [],
    { for: 'frame', shotId, parentFrameId: frame.id, how: 'again', fixReviewIds: notes.map((r) => r.id) },
    undefined,
    undefined,
    modelChoice ? { local: { fixModelChoice: modelChoice } } : {},
  )
}

const ctxFor = (deps: FrameDeps, jobId: string) => jobCtx(deps.doc.get(), deps.ui.get(), jobId)

const open = (d: ProductionDocument, ids: string[]) => ids.map((id) => d.reviews[id]).filter((r): r is Review => !!r && r.state !== 'resolved')

/** A clip job was already started for any of these notes. */
function clipStarted(d: ProductionDocument, deps: FrameDeps, reviewIds: string[]): boolean {
  return jobsList(d).some((j) => {
    const c = ctxFor(deps, j.id)
    return c?.for === 'clip' && (c.reviewIds ?? []).some((id) => reviewIds.includes(id))
  })
}

/**
 * Step 3: a fix's frame landed (and is selected), so make the clip from it.
 * Called from the frame completion hook, and at boot for a fix whose frame landed
 * while the page was closed. Does nothing twice.
 */
export async function continueFix(deps: FrameDeps, jobId: string, ctx: JobCtx | undefined = ctxFor(deps, jobId)): Promise<string | null> {
  if (ctx?.for !== 'frame' || !ctx.fixReviewIds?.length) return null
  const d = deps.doc.get()
  if (!Object.values(d.frames).some((f) => f.job_id === jobId)) return null // the frame has not landed
  const notes = open(d, ctx.fixReviewIds)
  if (!notes.length || clipStarted(d, deps, ctx.fixReviewIds)) return null
  return fixClip(deps, ctx.shotId, notes, ctx.fixModelChoice)
}

/**
 * A fix whose frame landed (and is still the picked frame) but whose clip did not: the job id of that
 * frame, so pressing Fix again makes only the clip instead of editing the fixed frame a second time.
 */
export function fixFrameLanded(d: ProductionDocument, ctxOf: (id: string) => JobCtx | undefined, reviewIds: string[]): string | undefined {
  const jobs = jobsList(d)
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]
    const c = ctxOf(j.id)
    if (c?.for === 'clip' && (c.reviewIds ?? []).some((id) => reviewIds.includes(id))) {
      if (isActive(j.state) || j.state === 'completed') return undefined // the clip is under way or made
      continue // a failed or cancelled clip: look for its frame
    }
    if (c?.for === 'frame' && (c.fixReviewIds ?? []).some((id) => reviewIds.includes(id))) {
      return Object.values(d.frames).some((f) => f.job_id === j.id && f.shot_id && d.shots[f.shot_id]?.pick?.current === f.id) ? j.id : undefined
    }
  }
  return undefined
}

/** Make the fix's clip again from its landed frame (fixFrameLanded), on `modelChoice` or the fix's own pick. */
export async function remakeFixClip(deps: FrameDeps, frameJobId: string, modelChoice?: ModelChoice): Promise<string> {
  const ctx = ctxFor(deps, frameJobId)
  if (ctx?.for !== 'frame' || !ctx.fixReviewIds?.length) throw new Error('That fix is gone.')
  const d = deps.doc.get()
  const notes = open(d, ctx.fixReviewIds)
  if (!notes.length) throw new Error('Those notes are already addressed.')
  return fixClip(deps, ctx.shotId, notes, modelChoice ?? ctx.fixModelChoice)
}

/** Step 3's clip: from the shot's picked (fixed) frame, for these notes, as a new take of theirs. */
function fixClip(deps: FrameDeps, shotId: string, notes: Review[], modelChoice?: ModelChoice): Promise<string> {
  const d = deps.doc.get()
  const parentTake = (notes[0].target.kind === 'take' ? d.takes[notes[0].target.id] : undefined) ?? selectedTake(d, shotId)
  const boxed = notes.find((r) => r.region) ?? notes[0]
  return makeClip(deps, shotId, {
    text: clipText(notes, boxed.id), reviewIds: notes.map((r) => r.id), ...(parentTake ? { parentTake } : {}), modelChoice,
  })
}

/** At boot: finish fixes whose frame landed but whose clip was never started. */
export async function resumeFixes(deps: FrameDeps): Promise<void> {
  for (const j of jobsList(deps.doc.get())) {
    const ctx = ctxFor(deps, j.id)
    if (j.state === 'completed' && ctx?.for === 'frame' && ctx.fixReviewIds?.length) await continueFix(deps, j.id, ctx)
  }
}

/** Shots a fix is working on now (its frame edit or its clip is running): the fix will replace their clip,
 *  so they are not "out of date" and "Update what follows" leaves them alone. */
export function shotsBeingFixed(d: ProductionDocument, ctxOf: (id: string) => JobCtx | undefined): Set<string> {
  const out = new Set<string>()
  for (const j of jobsList(d)) {
    if (!isActive(j.state)) continue
    const c = ctxOf(j.id)
    if ((c?.for === 'frame' && c.fixReviewIds?.length) || (c?.for === 'clip' && c.reviewIds?.length)) out.add(c.shotId)
  }
  return out
}

export type FixStep = { step: 'frame' | 'clip'; jobId: string; running: boolean }

/** Where a fix for these notes is: its newest job, and whether it is the frame or the clip. */
export function fixProgress(d: ProductionDocument, ctxOf: (id: string) => JobCtx | undefined, reviewIds: string[]): FixStep | undefined {
  const jobs = jobsList(d)
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]
    const c = ctxOf(j.id)
    if (!c || c.dismissed) continue
    const hit = c.for === 'frame' ? (c.fixReviewIds ?? []).some((id) => reviewIds.includes(id))
      : c.for === 'clip' ? (c.reviewIds ?? []).some((id) => reviewIds.includes(id)) : false
    if (hit) return { step: c.for === 'frame' ? 'frame' : 'clip', jobId: j.id, running: isActive(j.state) }
  }
  return undefined
}
