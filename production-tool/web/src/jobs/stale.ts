// What is out of date, and why (decided 2026-10-07, "Change anything later"; one to one
// since 2026-10-09, features/one-to-one-updates.clan).
//
// Marks follow a shot to its own frame and clip only:  view → frames · a shot's action,
// composition or refs → its frame · its camera move or length → its clip · its frame → its
// clip · clip → ad. A new frame never marks the next frame: continuity (a frame drawn from an
// older frame before it, or an older frame 1) is the quiet "drawn from an older frame" note
// (frameDrift), never "out of date"; "Carry the look forward" redraws on request (jobs/follow.ts).
//
// Frames and clips carry `stale[]` marks (target / caused_by / reason). A new version carries
// no mark, so making an item again lifts it. A clip's frame mark is also lifted when the user
// goes back to the frame it was made from: the check compares the clip's job inputs
// (`input_hashes`) with the frame selected now.
//
// The ad has no mark: the contract's targets are view, frame, take and shot, and
// adding one would change it. It is worked out instead, the same way: the latest
// ad is out of date when its job did not take in every shot's selected clip.
// Nothing here regenerates anything.

import type { ExportEntry, ProductionDocument, Shot, StaleMark } from '../contracts/types'
import { selectedFrame } from './frames'

const takeOf = (d: ProductionDocument, shotId: string) => (d.takes ?? []).find((t) => t.shot_id === shotId && t.selected)

/**
 * Shot `shotId`'s selected clip is out of date when its job did not start from
 * the shot's selected frame. Lifts any earlier frame mark on the shot's clips.
 */
export function refreshClipStale(d: ProductionDocument, shotId: string, now = new Date().toISOString()) {
  const shots = d.shots ?? []
  const i = shots.findIndex((s) => s.id === shotId)
  if (i < 0) return
  const takeIds = new Set((d.takes ?? []).filter((t) => t.shot_id === shotId).map((t) => t.id))
  d.stale = (d.stale ?? []).filter((s) => !(s.target.kind === 'take' && takeIds.has(s.target.id) && s.caused_by.kind === 'frame'))
  const frame = selectedFrame(d, shotId)
  const take = takeOf(d, shotId)
  if (!frame || !take) return
  const job = d.jobs.find((j) => j.id === take.job_id)
  // No inputs on record (an older job): nothing to compare, so no mark.
  if (!job?.input_hashes || job.input_hashes.includes(frame.asset)) return
  const mark: StaleMark = { target: { kind: 'take', id: take.id }, caused_by: { kind: 'frame', id: frame.id }, reason: `Shot ${i + 1}'s frame changed`, marked_at: now }
  d.stale.push(mark)
}

/** What a shot edit changes, and which of the shot's own items it puts out of date. */
const SHOT_FIELDS: Partial<Record<keyof Shot, { what: string; on: 'frame' | 'take' }>> = {
  action: { what: 'words', on: 'frame' },
  composition: { what: 'composition', on: 'frame' },
  refs: { what: 'refs', on: 'frame' },
  camera_move: { what: 'camera move', on: 'take' },
  duration_s: { what: 'length', on: 'take' },
}

/**
 * A person changed `fields` of shot `shotId`: its selected frame (action, composition, refs) or
 * its selected clip (camera move, length) is out of date, and nothing else. Called inside the
 * same updateDoc as the edit, so undo takes both back. One mark per item and shot: one already
 * there is kept (only its reason follows the latest change), so typing does not pile marks up.
 */
export function markShotEdit(d: ProductionDocument, shotId: string, fields: readonly string[], now = new Date().toISOString()) {
  const shots = d.shots ?? []
  const i = shots.findIndex((s) => s.id === shotId)
  if (i < 0) return
  for (const on of ['frame', 'take'] as const) {
    const changed = fields.map((f) => SHOT_FIELDS[f as keyof Shot]).filter((x) => x?.on === on)
    if (!changed.length) continue
    const target = on === 'frame' ? selectedFrame(d, shotId) : takeOf(d, shotId)
    if (!target) continue
    const reason = `Shot ${i + 1}'s ${changed.at(-1)!.what} changed`
    d.stale ??= []
    const had = d.stale.find((s) => s.target.kind === on && s.target.id === target.id && s.caused_by.kind === 'shot' && s.caused_by.id === shotId)
    if (had) {
      if (had.reason !== reason) had.reason = reason
      continue
    }
    d.stale.push({ target: { kind: on, id: target.id }, caused_by: { kind: 'shot', id: shotId }, reason, marked_at: now })
  }
}

/** A person's edit of a shot (the Storyboard's shot list), with the marks it makes: run it inside one
 *  updateDoc. Only fields whose value really changed mark anything. */
export function editShot(d: ProductionDocument, shotId: string, patch: Partial<Shot>) {
  const s = d.shots?.find((x) => x.id === shotId)
  if (!s) return
  const changed = (Object.keys(patch) as (keyof Shot)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(patch[k]))
  Object.assign(s, patch)
  markShotEdit(d, shotId, changed)
}

/** What a mark from the item's own shot says changed ("words", "camera move"), read from its reason. */
export function shotChange(mark: Pick<StaleMark, 'reason'>): string | undefined {
  return /^Shot \d+'s (.+) changed$/.exec(mark.reason)?.[1]
}

/**
 * Continuity only, never "out of date": shot `shotId`'s selected frame was drawn from another
 * picture than the frame now before it (or than frame 1 now). The number of that shot, or
 * undefined. An older job with no inputs on record says nothing.
 */
export function frameDrift(d: ProductionDocument, shotId: string): number | undefined {
  const shots = d.shots ?? []
  const i = shots.findIndex((s) => s.id === shotId)
  if (i <= 0) return undefined
  const frame = selectedFrame(d, shotId)
  const job = frame && d.jobs.find((j) => j.id === frame.job_id)
  if (!job?.input_hashes) return undefined
  const prev = selectedFrame(d, shots[i - 1].id)
  if (prev && !job.input_hashes.includes(prev.asset)) return i
  const first = selectedFrame(d, shots[0].id)
  if (first && !job.input_hashes.includes(first.asset)) return 1
  return undefined
}

/** The selected frame of a shot is marked out of date. */
export function frameStale(d: ProductionDocument, shotId: string): StaleMark | undefined {
  const f = selectedFrame(d, shotId)
  return f ? (d.stale ?? []).find((s) => s.target.kind === 'frame' && s.target.id === f.id) : undefined
}

/** The selected clip of a shot is marked out of date. */
export function takeStale(d: ProductionDocument, shotId: string): StaleMark | undefined {
  const t = takeOf(d, shotId)
  return t ? (d.stale ?? []).find((s) => s.target.kind === 'take' && s.target.id === t.id) : undefined
}

export interface AdStatus {
  ad?: ExportEntry
  stale: boolean
  reason?: string
  /** The shot whose clip the ad is missing (for "Update what follows" on that shot). */
  shotId?: string
}

/** The latest ad, and whether it still matches the shots and their selected clips. */
export function adStatus(d: ProductionDocument): AdStatus {
  const ad = (d.exports ?? []).filter((e) => e.kind === 'ad_mp4').at(-1)
  if (!ad) return { stale: false }
  const job = d.jobs.find((j) => j.id === ad.job_id)
  if (!job?.input_hashes) return { ad, stale: false }
  const shots = d.shots ?? []
  for (const [i, s] of shots.entries()) {
    const t = takeOf(d, s.id)
    if (!t) return { ad, stale: true, reason: `Shot ${i + 1} has no clip in it`, shotId: s.id }
    if (!job.input_hashes.includes(t.asset)) return { ad, stale: true, reason: `Shot ${i + 1}'s clip changed`, shotId: s.id }
  }
  if (job.input_hashes.length > shots.length) return { ad, stale: true, reason: 'A shot was deleted' }
  // The same clips in another order are another ad: the job's input_hashes keep the clips' order
  // (the stitch request lists them shot by shot). It stayed "up to date" after a reorder (2026-10-09).
  const now = shots.map((s) => takeOf(d, s.id)!.asset).filter((h, i, all) => all.indexOf(h) === i)
  const sent = job.input_hashes.filter((h) => now.includes(h))
  if (sent.join() !== now.join()) return { ad, stale: true, reason: 'The shots were reordered' }
  return { ad, stale: false }
}

/** Anything at all out of date: a selected frame or clip, or the ad. */
export function anythingStale(d: ProductionDocument): boolean {
  return (d.shots ?? []).some((s) => frameStale(d, s.id) || takeStale(d, s.id)) || adStatus(d).stale
}
