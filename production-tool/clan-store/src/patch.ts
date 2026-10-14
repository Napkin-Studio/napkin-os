// Fix this moment (features/clip-moment-edit.clan, review item 8): the pure arithmetic of a clip_patch,
// shared by the relay's Python twin (relay/time_rules.py) and pinned by contracts/examples/patches.json.
//
//   noteToTakeWindow  a note's window (take time for a note on a take, shot time otherwise) on the take
//   patchPlan         what is cut from the take, and the keyframe the model gets
//   spliceSegments    the patched take's segments: where each stretch of its frames came from
//   patchedRanges     the "patched 0:02-0:04" marks a take carries
//   applyPatchTake    a finished clip_patch job as the shot's new take (one landing; the web's landPatch)
//
// The video-editor and server-job-landing call these; they never redo the arithmetic.

import { rankBetween } from './rank'
import { newUlidId } from './store'
import { MIN_WINDOW_S, type NoteWindow } from './time'

const EPS = 1e-9
/** A keyframe sits this far inside the end of its range (end exclusive). */
export const KEYFRAME_EPS_S = 0.05
/** A take keeps at most this many segments (document.schema take.segments maxItems). */
export const MAX_SEGMENTS = 16
/** A pick keeps at most this many alternates (document.schema pick.alternates maxItems). */
export const MAX_ALTERNATES = 8

const r3 = (x: number) => Math.round(x * 1000) / 1000

export interface NoteLike {
  target: { kind: string; id?: string }
  at_s?: number
  window?: NoteWindow
}
export interface CutItemLike { in_s?: number; out_s?: number }
export interface TakeWindow {
  /** Whole seconds of take time, at least 2 s, inside the take. */
  window: NoteWindow
  /** The note's moment in take time, inside the window. */
  atS: number
  /** False when the window lies wholly outside what the cut plays of the take (its trimmed tail). */
  inCut: boolean
}

/**
 * A note's window on its take. A note on a take (target.kind 'take', written from the take player) is in
 * take time and passes through unchanged; any other note (the video editor's timeline: shot time) moves
 * by the cut item's in_s, widened to whole seconds. Either way the window is fitted inside the take,
 * at least 2 s, shifting inward rather than shrinking. null when the note has no moment or window, or
 * the take is too short to hold 2 whole seconds.
 */
export function noteToTakeWindow(note: NoteLike, take: { duration_s: number }, item?: CutItemLike | null): TakeWindow | null {
  if (note.at_s == null || !note.window) return null
  const end = Math.floor(take.duration_s + EPS)
  if (end < MIN_WINDOW_S) return null
  const inS = item?.in_s ?? 0
  const shotTime = note.target.kind !== 'take'
  let lo = shotTime ? Math.floor(note.window.from_s + inS + EPS) : note.window.from_s
  let hi = shotTime ? Math.ceil(note.window.to_s + inS - EPS) : note.window.to_s
  const width = Math.min(Math.max(MIN_WINDOW_S, hi - lo), end)
  lo = Math.min(Math.max(lo, 0), end - width)
  hi = lo + width
  const at = r3(Math.min(Math.max(note.at_s + (shotTime ? inS : 0), lo), hi))
  const cutEnd = item?.out_s ?? take.duration_s
  return { window: { from_s: lo, to_s: hi }, atS: at, inCut: lo < cutEnd - EPS && hi > inS + EPS }
}

export type KeyframeKind = 'none' | 'still' | 'edited'
/** range: the whole take goes with the window as the keyframe's range (Aleph edits and bills only the
 *  range: pathway tests 2026-10-13). cut: only the window (plus contextS) is cut out and sent. */
export type PatchSend = 'range' | 'cut'
/** Aleph 2 takes at most this long an input; a longer take is cut. */
export const MAX_INPUT_S = 30
export interface PatchPlan {
  send: PatchSend
  /** Take seconds sent to the model: the whole take (range), or the window plus contextS each side (cut). */
  cut: { from_s: number; to_s: number }
  /** The seconds Aleph 2 bills, before its 2 s minimum: the range (range send) or the cut. */
  seconds: number
  keyframe: KeyframeKind
  /** The keyframe's time inside the cut, when there is one. */
  keyframeS?: number
  /** The keyframe's whole-second range in what is sent (end exclusive): the window on a range send; on a cut
   *  send, only with contextS > 0. */
  range?: { start_s: number; end_s: number }
}

/**
 * What a clip_patch sends. The range send (the default) sends the whole take with one keyframe, the
 * edited still or the frame at t, whose whole-second range is the window: Aleph changes and bills only
 * the window and snaps back after it, so its own frames meet the take's. A take longer than
 * maxInputS is cut instead. The cut send at contextS 0 sends only the window and the whole cut is the
 * edit: no keyframe unless the person edited the still (an unedited frame would anchor "no change"),
 * and an edited still is one keyframe at t with no range. With contextS > 0 one keyframe carries the
 * window as its range inside the cut. A keyframe sits inside [range start, range end - 0.05] (Runway's
 * range is end exclusive).
 */
export function patchPlan(p: { window: NoteWindow; atS: number; takeS: number; contextS?: number; edited?: boolean; send?: PatchSend; maxInputS?: number }): PatchPlan {
  const a = p.window.from_s
  const b = p.window.to_s
  const send: PatchSend = (p.send ?? 'range') === 'range' && p.takeS <= (p.maxInputS ?? MAX_INPUT_S) + EPS ? 'range' : 'cut'
  if (send === 'range') {
    const hi = b - KEYFRAME_EPS_S
    return {
      send, cut: { from_s: 0, to_s: r3(p.takeS) }, seconds: b - a, keyframe: p.edited ? 'edited' : 'still',
      keyframeS: r3(Math.min(Math.max(p.atS, a), hi)), range: { start_s: a, end_s: b },
    }
  }
  const k = p.contextS ?? 0
  const from = Math.max(0, a - k)
  const to = r3(Math.min(p.takeS, b + k))
  const seconds = r3(to - from)
  const plan: PatchPlan = { send, cut: { from_s: from, to_s: to }, seconds, keyframe: 'none' }
  if (k > 0) {
    plan.range = { start_s: a - from, end_s: b - from }
    plan.keyframe = p.edited ? 'edited' : 'still'
  } else if (p.edited) {
    plan.keyframe = 'edited'
  }
  if (plan.keyframe !== 'none') {
    const lo = plan.range?.start_s ?? 0
    const hi = (plan.range?.end_s ?? seconds) - KEYFRAME_EPS_S
    plan.keyframeS = r3(Math.min(Math.max(p.atS - from, lo), hi))
  }
  return plan
}

export interface Segment { source_take: string; in_s: number; out_s: number; job_id?: string }

const sameSource = (x: Segment, y: Segment) => x.source_take === y.source_take && x.job_id === y.job_id

function merged(pieces: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const s of pieces) {
    if (s.out_s - s.in_s <= EPS) continue
    const last = out.at(-1)
    if (last && sameSource(last, s) && Math.abs(last.out_s - s.in_s) <= EPS) last.out_s = s.out_s
    else out.push({ ...s })
  }
  return out
}

/**
 * The segments of a take patched over `window`: the parent's pieces before it, {self, window, job}, the
 * parent's pieces after it (in this take's time, which is the parent's), adjacent pieces from one source
 * merged. An unpatched parent is one piece of itself. Past 16 pieces the oldest patched piece (the
 * smallest job id: ULIDs sort by time) folds with its neighbours into one piece of this take with no
 * job, so the list always fits the document.
 */
export function spliceSegments(parent: { id: string; duration_s: number; segments?: Segment[] }, takeId: string, window: NoteWindow, jobId: string): Segment[] {
  const own = parent.segments?.length ? parent.segments : [{ source_take: parent.id, in_s: 0, out_s: parent.duration_s }]
  const a = window.from_s
  const b = window.to_s
  const before = own.filter((s) => s.in_s < a - EPS).map((s) => ({ ...s, out_s: Math.min(s.out_s, a) }))
  const after = own.filter((s) => s.out_s > b + EPS).map((s) => ({ ...s, in_s: Math.max(s.in_s, b) }))
  let out = merged([...before, { source_take: takeId, in_s: a, out_s: b, job_id: jobId }, ...after])
  while (out.length > MAX_SEGMENTS) {
    const old = out
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.job_id && s.job_id !== jobId)
      .sort((x, y) => (x.s.job_id! < y.s.job_id! ? -1 : x.s.job_id! > y.s.job_id! ? 1 : x.i - y.i))[0]
    if (!old) break
    const i = old.i
    const lo = i > 0 && out[i - 1].job_id !== jobId ? i - 1 : i
    const hi = i < out.length - 1 && out[i + 1].job_id !== jobId ? i + 1 : i
    const piece: Segment = { source_take: takeId, in_s: out[lo].in_s, out_s: out[hi].out_s }
    out = merged([...out.slice(0, lo), piece, ...out.slice(hi + 1)])
  }
  return out
}

const mss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** A take's patched stretches, each with its timeline label ("patched 0:02-0:04"), in order. */
export function patchedRanges(take: { segments?: Segment[] }): { from_s: number; to_s: number; job_id: string; label: string }[] {
  return (take.segments ?? [])
    .filter((s): s is Segment & { job_id: string } => !!s.job_id)
    .map((s) => ({ from_s: s.in_s, to_s: s.out_s, job_id: s.job_id, label: `patched ${mss(s.in_s)}-${mss(s.out_s)}` }))
}

// ── landing ─────────────────────────────────────────────────────────────────

export interface PatchTake {
  id: string; v: number; field_v: Record<string, number>; shot_id: string; version: number; parent_id?: string
  asset: string; job_id: string; crew: string; kind: 'generated' | 'mock'; model: string; provider: string
  duration_s: number; segments: Segment[]
}
interface Pick { current: string; alternates?: string[] }
export interface PatchDoc {
  takes: Record<string, PatchTake>
  videos: Record<string, { edl: Record<string, { rank: string; kind: 'shot' | 'bridge'; shot_id?: string; pick?: Pick }> }>
}
export interface PatchJob {
  jobId: string
  kind?: 'generated' | 'mock'
  model?: string
  provider?: string
  outputs?: { sha256: string; durationS?: number }[]
  patch?: { window: NoteWindow; model: string }
}

/**
 * A finished clip_patch as the shot's new take: version n+1, parent the patched take, Edie's, the window's
 * model, with spliceSegments' segments. It becomes the cut's pick for the shot and the parent moves into
 * the alternates (Use's rule, never applyTake's pick = {current}). The note stays open: Fix again makes the
 * next version, and Resolve closes it. Landing the same job twice changes nothing (undefined).
 */
export function applyPatchTake(d: PatchDoc, job: PatchJob, ctx: { shotId: string; parentTakeId: string; videoId?: string; newId?: (prefix: string) => string }): PatchTake | undefined {
  const out = job.outputs?.[0]
  const parent = d.takes[ctx.parentTakeId]
  if (!out || !parent || !job.patch) return undefined
  if (Object.values(d.takes).some((t) => t.job_id === job.jobId)) return undefined
  const id = (ctx.newId ?? newUlidId)('take')
  const version = Math.max(0, ...Object.values(d.takes).filter((t) => t.shot_id === ctx.shotId).map((t) => t.version)) + 1
  const take: PatchTake = {
    id, v: 1, field_v: {}, shot_id: ctx.shotId, version, parent_id: parent.id,
    asset: out.sha256, job_id: job.jobId, crew: 'edie',
    kind: job.kind === 'mock' ? 'mock' : 'generated',
    model: job.patch.model, provider: job.provider ?? 'mock',
    duration_s: parent.duration_s,
    segments: spliceSegments(parent, id, job.patch.window, job.jobId),
  }
  d.takes[id] = take
  const video = ctx.videoId ? d.videos[ctx.videoId] : undefined
  if (video) {
    const entry = Object.entries(video.edl).find(([, i]) => i.kind === 'shot' && i.shot_id === ctx.shotId)
    if (entry) {
      const was = entry[1].pick
      const alternates = [...(was?.alternates ?? []), ...(was ? [was.current] : [])]
        .filter((x, i, all) => x !== id && all.indexOf(x) === i)
        .slice(-MAX_ALTERNATES)
      video.edl[entry[0]].pick = { current: id, ...(alternates.length ? { alternates } : {}) }
    } else {
      const last = Object.values(video.edl).map((i) => i.rank).sort().at(-1) ?? null
      video.edl[(ctx.newId ?? newUlidId)('edl')] = { rank: rankBetween(last, null), kind: 'shot', shot_id: ctx.shotId, pick: { current: id, alternates: [parent.id] } }
    }
  }
  return take
}
