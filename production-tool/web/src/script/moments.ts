// Moments and audio rows (ui-behaviour 3.10, review item 7; features/script-editor.clan).
// A moment is a beat at a time in its shot ("at 0:02"); a Line, VO, Music or Sound row is
// a beat too, its time relative to the shot. Time is shot time in whole or half seconds
// (document.schema.json: beat at_s multipleOf 0.5) and lies inside the shot. A Line tied to
// a moment (moment_id) moves with it: one batch, one undo step.

import type { Beat, BeatKind, ProductionDocument } from '../contracts/types'
import { beatsOf } from '../model/selectors'

type Doc = ProductionDocument

export const UNPLANNED_MOMENT = 'Moments live in shots. Plan shots first, or insert a shot.'

/** To the nearest half second (the contract's multipleOf 0.5): 3.2 → 3.0, 3.3 → 3.5. */
export function snapTime(s: number): number {
  return Math.max(0, Math.round(s * 2) / 2)
}

/** '0:03.2', '3.2', '0:05', '1:02' → seconds, or null when it is not a time. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(/^at\s+/i, '').replace(/s$/i, '').trim()
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t)
  if (!m) return null
  const s = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])
  return Number.isFinite(s) ? s : null
}

/** 'at 0:02', 'at 0:02.5'. */
export function timeLabel(s: number): string {
  const whole = Math.floor(s)
  const half = s - whole >= 0.5
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${half ? '.5' : ''}`
}

/** Why a time cannot be kept in a shot of `duration` seconds, or null. */
export function timeProblem(at: number, duration: number): string | null {
  if (at > duration) return `${timeLabel(at)} is past the end of this ${Math.round(duration * 10) / 10} s shot`
  return null
}

/** Where a new moment goes in a shot: half a second after its last beat, kept inside the shot. */
export function nextMomentTime(d: Doc, shotId: string): number {
  const shot = d.shots[shotId]
  if (!shot) return 0
  const last = beatsOf(d, shotId).at(-1)
  const end = Math.floor(shot.duration_s * 2) / 2
  return Math.min(last ? last.at_s + 0.5 : 0, end)
}

/** The beats that move with one: a moment's tied lines, or a tied line's moment and its other lines. */
export function movesWith(d: Doc, beatId: string): Beat[] {
  const b = d.beats[beatId]
  if (!b) return []
  const moment = b.kind === 'moment' ? b : b.moment_id ? d.beats[b.moment_id] : undefined
  if (!moment) return [b]
  return [moment, ...Object.values(d.beats).filter((x) => x.moment_id === moment.id)]
}

/**
 * Set a beat's time (snapped), and the beats tied to it by the same amount, inside a draft (run it
 * in one updateDoc: one step). Throws the person's words when it would leave the shot.
 */
export function setBeatTime(d: Doc, beatId: string, at: number) {
  const b = d.beats[beatId]
  if (!b) throw new Error('That beat is gone.')
  const shot = d.shots[b.shot_id]
  const t = snapTime(at)
  const problem = shot ? timeProblem(t, shot.duration_s) : null
  if (problem) throw new Error(problem)
  const by = t - b.at_s
  for (const x of movesWith(d, beatId)) {
    const next = snapTime(x.at_s + by)
    const p = shot ? timeProblem(next, shot.duration_s) : null
    if (p) throw new Error(p)
    d.beats[x.id].at_s = next
  }
}

/** Tie a line to a moment (or untie it with null): its time becomes the moment's. */
export function tieLine(d: Doc, lineId: string, momentId: string | null) {
  const line = d.beats[lineId]
  if (!line || line.kind !== 'line') return
  if (!momentId) {
    delete line.moment_id
    return
  }
  const m = d.beats[momentId]
  if (!m || m.kind !== 'moment' || m.shot_id !== line.shot_id) throw new Error('A line ties to a moment in its own shot.')
  line.moment_id = momentId
  line.at_s = m.at_s
}

/** A shot shortened: beats past its new end come back to it, so the shot never loses them. */
export function keepBeatsInside(d: Doc, shotId: string) {
  const shot = d.shots[shotId]
  if (!shot) return
  const end = Math.floor(shot.duration_s * 2) / 2
  for (const b of Object.values(d.beats)) if (b.shot_id === shotId && b.at_s > shot.duration_s) b.at_s = end
}

/** The audio rows' kinds and their buttons' words. */
export const AUDIO_KINDS: { kind: BeatKind; add: string; label: string }[] = [
  { kind: 'vo', add: '+ VO', label: 'VO' },
  { kind: 'line', add: '+ Line', label: 'Line' },
  { kind: 'music', add: '+ Music', label: 'Music' },
  { kind: 'sound', add: '+ Sound', label: 'Sound' },
]
