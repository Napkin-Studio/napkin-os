// What is out of date, and why (decided 2026-10-07, "Change anything later").
//
// The chain:  view → frames · frame k → frame k+1 · frame → its shot's clip ·
// clip → ad · a shot added or deleted → the next shot's frame and the ad.
//
// Frames and clips carry `stale[]` marks (target / caused_by / reason). A mark
// is lifted when the item is made again from what is upstream now, or when the
// user goes back to the version it was made from: each check below compares the
// item's job inputs (`input_hashes`) with the upstream picture selected now.
//
// The ad has no mark: the contract's targets are view, frame, take and shot, and
// adding one would change it. It is worked out instead, the same way: the latest
// ad is out of date when its job did not take in every shot's selected clip.
// Nothing here regenerates anything.

import type { ExportEntry, ProductionDocument, StaleMark } from '../contracts/types'
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
  return { ad, stale: false }
}

/** Anything at all out of date: a selected frame or clip, or the ad. */
export function anythingStale(d: ProductionDocument): boolean {
  return (d.shots ?? []).some((s) => frameStale(d, s.id) || takeStale(d, s.id)) || adStatus(d).stale
}
