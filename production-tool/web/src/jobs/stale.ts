// What is out of date, and why (decided 2026-10-07, "Change anything later"; one to one
// since 2026-10-09, features/one-to-one-updates.clan; contract 3's stale map since 2026-10-13).
//
// Marks follow a shot to its own frame only: a shot's words, framing or refs → its frame. Takes are
// never marked (features/make-and-edit.clan): a take keeps what it was made from, and a change to a
// shot applies to its next take. A new frame never marks the next frame: continuity (a frame drawn
// from an older frame before it, or an older frame 1) is the quiet "drawn from an older frame" note
// (frameDrift), never "out of date"; "Carry the look forward" redraws on request (jobs/follow.ts).
//
// Marks are entities of `stale` (target / caused_by / reason). A new version carries no mark, so
// making an item again lifts it.
//
// The ad has no mark: it is worked out the same way. The picked render is out of date when its
// job did not take in every shot's clip in the cut, in order. Nothing here regenerates anything.

import { newUlidId } from '../../../clan-store/src'
import type { Camera, ProductionDocument, Render, Shot, StaleMark, Target } from '../contracts/types'
import { currentFrame, currentRender, currentTake, shotNumber, shotSegment, shotsOf, staleList } from '../model/selectors'

/** A new mark, with its id. */
function addMark(d: ProductionDocument, target: Target, causedBy: Target, reason: string, now: string): StaleMark {
  const id = newUlidId('stale')
  const mark: StaleMark = { id, v: 1, field_v: {}, target, caused_by: causedBy, reason, marked_at: now }
  d.stale[id] = mark
  return mark
}

/** What a shot edit changes in its frame (a camera move or a length changes only its next take). */
const SHOT_FIELDS: Record<string, { what: string; on: 'frame' }> = {
  action: { what: 'words', on: 'frame' },
  direction: { what: 'direction', on: 'frame' },
  refs: { what: 'refs', on: 'frame' },
  'camera/size': { what: 'framing', on: 'frame' },
  'camera/angle': { what: 'framing', on: 'frame' },
  'camera/lens_mm': { what: 'framing', on: 'frame' },
  'camera/macro': { what: 'framing', on: 'frame' },
}

/**
 * A person changed `fields` of shot `shotId` (field names, camera parts as camera/<part>): its picked
 * frame (words, direction, refs, framing) is out of date, and nothing else. Called inside the same updateDoc as the edit, so undo takes both back. One mark per
 * item and shot: one already there is kept (only its reason follows the latest change), so typing does
 * not pile marks up.
 */
export function markShotEdit(d: ProductionDocument, shotId: string, fields: readonly string[], now = new Date().toISOString()) {
  if (!d.shots[shotId]) return
  for (const on of ['frame'] as const) {
    const changed = fields.map((f) => SHOT_FIELDS[f]).filter((x) => x?.on === on)
    if (!changed.length) continue
    const target = currentFrame(d, shotId)
    if (!target) continue
    const reason = `Shot ${shotNumber(d, shotId)}'s ${changed.at(-1)!.what} changed`
    const had = staleList(d).find((s) => s.target.kind === on && s.target.id === target.id && s.caused_by.kind === 'shot' && s.caused_by.id === shotId)
    if (had) {
      if (had.reason !== reason) d.stale[had.id].reason = reason
      continue
    }
    addMark(d, { kind: on, id: target.id }, { kind: 'shot', id: shotId }, reason, now)
  }
}

/** The fields (camera parts as camera/<part>) that differ between a shot and a patch of it. */
function changedFields(s: Shot, patch: Partial<Shot>): string[] {
  const out: string[] = []
  for (const k of Object.keys(patch) as (keyof Shot)[]) {
    if (k === 'camera') {
      const a = s.camera as unknown as Record<string, unknown>
      const b = (patch.camera ?? {}) as Camera as unknown as Record<string, unknown>
      for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[p]) !== JSON.stringify(b[p])) out.push(`camera/${p}`)
    } else if (JSON.stringify(s[k] ?? null) !== JSON.stringify(patch[k] ?? null)) out.push(k)
  }
  return out
}

/** A person's edit of a shot (the Storyboard's shot list), with the marks it makes: run it inside one
 *  updateDoc. Only fields whose value really changed mark anything. A camera in `patch` is the whole camera. */
export function editShot(d: ProductionDocument, shotId: string, patch: Partial<Shot>) {
  const s = d.shots[shotId]
  if (!s) return
  const changed = changedFields(s, patch)
  Object.assign(s, patch)
  markShotEdit(d, shotId, changed)
}

/** What a mark from the item's own shot says changed ("words", "camera move"), read from its reason. */
export function shotChange(mark: Pick<StaleMark, 'reason'>): string | undefined {
  return /^Shot \d+'s (.+) changed$/.exec(mark.reason)?.[1]
}

/**
 * Continuity only, never "out of date": shot `shotId`'s picked frame was drawn from another
 * picture than the frame now before it (or than frame 1 now). The number of that shot, or
 * undefined. An older job with no inputs on record says nothing.
 */
export function frameDrift(d: ProductionDocument, shotId: string): number | undefined {
  const shot = d.shots[shotId]
  if (!shot) return undefined
  const shots = shotsOf(d, shot.storyboard_id)
  const i = shots.findIndex((s) => s.id === shotId)
  if (i <= 0) return undefined
  const frame = currentFrame(d, shotId)
  const job = frame?.job_id ? d.jobs[frame.job_id] : undefined
  if (!job?.input_hashes) return undefined
  const prev = currentFrame(d, shots[i - 1])
  if (prev && !job.input_hashes.includes(prev.asset)) return i
  const first = currentFrame(d, shots[0])
  if (first && !job.input_hashes.includes(first.asset)) return 1
  return undefined
}

/** The stale reason when the frame a clip lands on was changed (features/connected-video.clan). */
export const END_FRAME_CHANGED = 'end_frame_changed'

/**
 * Continuity only, never "out of date" (the one-to-one rule): shot `shotId`'s clip in the cut ends on the next
 * shot's storyboard frame, and that frame has changed since (a new version picked, or the shots moved).
 * The number of the shot it lands on, with the reason end_frame_changed; nothing is marked and nothing
 * cascades. Remaking the clip (it lands on the frame picked now) lifts it.
 */
export function endFrameDrift(d: ProductionDocument, shotId: string, videoId?: string): { reason: typeof END_FRAME_CHANGED; shot: number } | undefined {
  const take = currentTake(d, shotId, videoId)
  if (take?.end?.kind !== 'next_storyboard' || !take.end.frame_id) return undefined
  const shot = d.shots[shotId]
  const shots = shot ? shotsOf(d, shot.storyboard_id) : []
  const next = shots[shots.findIndex((s) => s.id === shotId) + 1]
  const landedOn = d.frames[take.end.frame_id]
  if (next && currentFrame(d, next)?.id === take.end.frame_id) return undefined
  // The shot it landed on: the next one now, or (moved away) the one whose frame it was.
  const n = next ? shotNumber(d, next.id) : landedOn?.shot_id ? shotNumber(d, landedOn.shot_id) : 0
  return { reason: END_FRAME_CHANGED, shot: n }
}

/**
 * Said, never marked (features/make-and-edit.clan: takes are never marked out of date): shot `shotId`'s clip in
 * the cut was made from another frame than the one picked now. A window guided by its frame inside a box made
 * together is never behind it (only the box's first, pinned, shot is checked). An older job with no inputs on
 * record says nothing. "Update what follows" reads this to offer the clip again; nothing else does.
 */
export function clipBehind(d: ProductionDocument, shotId: string): { reason: string } | undefined {
  const frame = currentFrame(d, shotId)
  const take = currentTake(d, shotId)
  if (!frame || !take?.job_id) return undefined
  if (shotSegment(take, shotId) && take.segments![0].shot_id !== shotId) return undefined
  const job = d.jobs[take.job_id]
  if (!job?.input_hashes || job.input_hashes.includes(frame.asset)) return undefined
  return { reason: `Shot ${shotNumber(d, shotId)}'s frame changed` }
}

/** The picked frame of a shot is marked out of date. */
export function frameStale(d: ProductionDocument, shotId: string): StaleMark | undefined {
  const f = currentFrame(d, shotId)
  return f ? staleList(d).find((s) => s.target.kind === 'frame' && s.target.id === f.id) : undefined
}

export interface AdStatus {
  /** The ad render picked now (the main video's pick, else its newest). */
  ad?: Render
  stale: boolean
  reason?: string
  /** The shot whose clip the ad is missing (for "Update what follows" on that shot). */
  shotId?: string
}

/** The picked ad render, and whether it still matches the shots and their clips in the cut. */
export function adStatus(d: ProductionDocument): AdStatus {
  const ad = currentRender(d)
  if (!ad) return { stale: false }
  const job = d.jobs[ad.job_id]
  if (!job?.input_hashes) return { ad, stale: false }
  const shots = shotsOf(d)
  for (const [i, s] of shots.entries()) {
    const t = currentTake(d, s.id)
    if (!t?.asset) return { ad, stale: true, reason: `Shot ${i + 1} has no clip in it`, shotId: s.id }
    if (!job.input_hashes.includes(t.asset)) return { ad, stale: true, reason: `Shot ${i + 1}'s clip changed`, shotId: s.id }
  }
  if (job.input_hashes.length > shots.length) return { ad, stale: true, reason: 'A shot was deleted' }
  // The same clips in another order are another ad: the job's input_hashes keep the clips' order
  // (the stitch request lists them shot by shot). It stayed "up to date" after a reorder (2026-10-09).
  const now = shots.map((s) => currentTake(d, s.id)!.asset!).filter((h, i, all) => all.indexOf(h) === i)
  const sent = job.input_hashes.filter((h) => now.includes(h))
  if (sent.join() !== now.join()) return { ad, stale: true, reason: 'The shots were reordered' }
  return { ad, stale: false }
}

/** Anything at all out of date: a picked frame or clip, or the ad. */
export function anythingStale(d: ProductionDocument): boolean {
  return shotsOf(d).some((s) => frameStale(d, s.id)) || adStatus(d).stale
}
