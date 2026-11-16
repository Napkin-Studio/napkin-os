// Fix this moment (features/clip-moment-edit.clan, review item 8), on generations (features/make-and-edit.clan):
// the pure arithmetic of a clip_patch, shared by the relay's Python twin (relay/time_rules.py) and pinned
// by contracts/examples/patches.json.
//
//   noteToTakeWindow       a note's window (its generation's time for a note on a generation, shot time
//                          otherwise) on the generation
//   momentWindow           a marked stretch (Change → A moment) snapped to whole seconds, at least 2 s
//   patchPlan              what is cut from the generation, and the keyframe the model gets
//   patchedStretches       a patched generation's `patched`: where each stretch was made again
//   patchedRanges          the "patched 0:02-0:04" marks a generation carries
//   applyPatchGeneration   a finished clip_patch job as a new generation beside its parent (never swapped
//                          into the cut: the Edit room offers it as New take ready)
//
// The video-editor and server-job-landing call these; they never redo the arithmetic.

import { newUlidId } from './store'
import { MIN_WINDOW_S, type NoteWindow } from './time'

const EPS = 1e-9
/** A keyframe sits this far inside the end of its range (end exclusive). */
export const KEYFRAME_EPS_S = 0.05
/** A generation keeps at most this many patched stretches (document.schema generation.patched maxItems). */
export const MAX_PATCHED = 16

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
 * A note's window on its generation. A note on a generation (target.kind 'generation', written from the
 * take player) is in the generation's own time and passes through unchanged; any other note (the
 * timeline: shot time) moves by the clip's source in_s, widened to whole seconds. Either way the window is fitted inside the take,
 * at least 2 s, shifting inward rather than shrinking. null when the note has no moment or window, or
 * the take is too short to hold 2 whole seconds.
 */
export function noteToTakeWindow(note: NoteLike, take: { duration_s: number }, item?: CutItemLike | null): TakeWindow | null {
  if (note.at_s == null || !note.window) return null
  const end = Math.floor(take.duration_s + EPS)
  if (end < MIN_WINDOW_S) return null
  const inS = item?.in_s ?? 0
  const shotTime = note.target.kind !== 'generation'
  let lo = shotTime ? Math.floor(note.window.from_s + inS + EPS) : note.window.from_s
  let hi = shotTime ? Math.ceil(note.window.to_s + inS - EPS) : note.window.to_s
  const width = Math.min(Math.max(MIN_WINDOW_S, hi - lo), end)
  lo = Math.min(Math.max(lo, 0), end - width)
  hi = lo + width
  const at = r3(Math.min(Math.max(note.at_s + (shotTime ? inS : 0), lo), hi))
  const cutEnd = item?.out_s ?? take.duration_s
  return { window: { from_s: lo, to_s: hi }, atS: at, inCut: lo < cutEnd - EPS && hi > inS + EPS }
}

/**
 * A marked stretch of a generation (Change → A moment, in its own time) as the window a clip_patch makes
 * again: whole seconds around inS..outS, at least 2 s, inside the generation, shifting inward rather than
 * shrinking; atS is the middle of the mark. null when the generation is too short to hold 2 whole
 * seconds. The relay snaps the same way (time_rules.moment_window) and returns what it snapped.
 */
export function momentWindow(inS: number, outS: number, takeS: number): TakeWindow | null {
  const lo = Math.min(inS, outS)
  const hi = Math.max(inS, outS)
  return noteToTakeWindow(
    { target: { kind: 'generation' }, at_s: r3((lo + hi) / 2), window: { from_s: Math.floor(lo + EPS), to_s: Math.ceil(hi - EPS) } },
    { duration_s: takeS },
  )
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

/** One stretch of a generation made again by a clip_patch (document.schema generation.patched). */
export interface Patched { in_s: number; out_s: number; job_id: string; generation_id?: string }

/**
 * The patched stretches of a generation patched over `window` by `jobId`, making `genId`: the parent's
 * stretches cut back where the window covers them, then the window itself, in time order. Past 16 the
 * oldest stretches (the smallest job id: ULIDs sort by time) go, so the list always fits the document.
 */
export function patchedStretches(parent: { patched?: Patched[] }, genId: string, window: NoteWindow, jobId: string): Patched[] {
  const a = window.from_s
  const b = window.to_s
  const kept: Patched[] = []
  for (const s of parent.patched ?? []) {
    if (s.out_s <= a + EPS || s.in_s >= b - EPS) kept.push({ ...s })
    else {
      if (s.in_s < a - EPS) kept.push({ ...s, out_s: a })
      if (s.out_s > b + EPS) kept.push({ ...s, in_s: b })
    }
  }
  let out = [...kept, { in_s: a, out_s: b, job_id: jobId, generation_id: genId }].sort((x, y) => x.in_s - y.in_s)
  while (out.length > MAX_PATCHED) {
    const oldest = out.filter((s) => s.job_id !== jobId).map((s) => s.job_id).sort()[0]
    if (!oldest) break
    const i = out.findIndex((s) => s.job_id === oldest)
    out = [...out.slice(0, i), ...out.slice(i + 1)]
  }
  return out
}

const mss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** A generation's patched stretches, each with its timeline label ("patched 0:02-0:04"), in order. */
export function patchedRanges(g: { patched?: Patched[] }): { from_s: number; to_s: number; job_id: string; label: string }[] {
  return (g.patched ?? []).map((s) => ({ from_s: s.in_s, to_s: s.out_s, job_id: s.job_id, label: `patched ${mss(s.in_s)}-${mss(s.out_s)}` }))
}

// ── landing ─────────────────────────────────────────────────────────────────

/** The parts of a generation a patch landing reads and writes (document.schema.json#/$defs/generation). */
export interface PatchGeneration {
  id: string; v: number; field_v: Record<string, number>; kind: string; parent_id?: string
  delta?: { field: string; shot_id?: string; from?: unknown; to: unknown }[]; label?: string
  inputs?: Record<string, unknown>; box_id?: string; shot_ids: string[]
  segments?: { shot_id: string; in_s: number; out_s: number; by?: string }[]; patched?: Patched[]
  asset?: string; duration_s?: number; state: 'making' | 'ready' | 'failed'; job_id?: string; provider?: string; crew?: string
  mock?: true; created_at: string; by: string
}
export interface PatchDoc { generations: Record<string, PatchGeneration> }
export interface PatchJob {
  jobId: string
  kind?: 'generated' | 'mock'
  model?: string
  provider?: string
  outputs?: { sha256: string; durationS?: number }[]
  patch?: { window: NoteWindow; model: string }
  remake?: { parentId?: string; delta: { field: string; shotId?: string; from?: unknown; to: unknown }[] }
}

/**
 * A finished clip_patch as a new generation (kind patch) beside its parent: Edie's, the window's model, the
 * parent's length, shots, segments and box (a patch never changes length), with patchedStretches'
 * stretches and the moment as its delta. It is NOT put into the cut: the Edit room offers it on the
 * parent's clips (New take ready). The note stays open: Fix again makes the next, Resolve closes it.
 * Landing the same job twice changes nothing (undefined).
 */
export function applyPatchGeneration(
  d: PatchDoc, job: PatchJob,
  ctx: { parentId: string; by: string; now: string; note?: string; newId?: (prefix: string) => string },
): PatchGeneration | undefined {
  const out = job.outputs?.[0]
  const parent = d.generations[ctx.parentId]
  if (!out || !parent || !job.patch) return undefined
  if (Object.values(d.generations).some((g) => g.job_id === job.jobId)) return undefined
  const id = (ctx.newId ?? newUlidId)('gen')
  const w = job.patch.window
  const moment = job.remake?.delta.find((x) => x.field === 'moment')
  const g: PatchGeneration = {
    id, v: 1, field_v: {}, kind: 'patch', parent_id: parent.id,
    delta: [{ field: 'moment', to: moment?.to ?? { window: w, ...(ctx.note ? { note: ctx.note } : {}) } }],
    label: `${ctx.note ? `${ctx.note.slice(0, 80)} ` : 'Fixed '}${mss(w.from_s)}-${mss(w.to_s)}`,
    inputs: { model: job.patch.model, ...(parent.duration_s !== undefined ? { length_s: parent.duration_s } : {}) },
    ...(parent.box_id ? { box_id: parent.box_id } : {}),
    shot_ids: [...parent.shot_ids],
    ...(parent.segments?.length ? { segments: parent.segments.map((x) => ({ ...x })) } : {}),
    patched: patchedStretches(parent, id, w, job.jobId),
    asset: out.sha256, duration_s: parent.duration_s ?? out.durationS ?? 0,
    state: 'ready', job_id: job.jobId, provider: job.provider ?? 'mock', crew: 'edie',
    ...(job.kind === 'mock' ? { mock: true as const } : {}),
    created_at: ctx.now, by: ctx.by,
  }
  d.generations[id] = g
  return g
}
