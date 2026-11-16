// Putting a take into a video's cut (video.timeline V1, features/make-and-edit.clan) the way the Video editor
// did before the rooms: one clip per shot, in shot order, end to end, each the shot's length of its take
// (its window of a box made together), held on its last frame when the take is shorter. With the rooms on,
// nothing calls these: a new take never touches the cut there, and the Edit room places clips itself.

import { newUlidId } from '../../../clan-store/src'
import type { Generation, Id, ProductionDocument, TimelineItem } from '../contracts/types'
import { cutItemFor, cutOf, shotSegment, shotsOf, storyboardOfVideo } from '../model/selectors'

const r3 = (x: number) => Math.round(x * 1000) / 1000
const FRAME_S = 1 / 24

/** A clip's length on the timeline: its window at its speed, then its held last frame. */
export const itemLen = (i: Pick<TimelineItem, 'source' | 'speed' | 'hold_s'>) => (i.source ? (i.source.out_s - i.source.in_s) / (i.speed ?? 1) + (i.hold_s ?? 0) : 0)

/** A shot's window of a take, fitted to the shot's length: the source window, and the hold when the take is
 *  shorter. An end-framed take is used up to its landing frame, whole, retimed into its slot (within 0.75-1.33x). */
export function shotSlot(g: Generation, shotId: Id, slotS: number): { in_s: number; out_s: number; hold_s?: number; speed?: number } {
  const seg = shotSegment(g, shotId)
  const len = g.duration_s ?? 0
  const landed = g.end?.at_s !== undefined ? r3(g.end.at_s + FRAME_S) : undefined
  const inS = seg?.in_s ?? 0
  const end = Math.min(seg?.out_s ?? landed ?? len, len || Infinity)
  const avail = Math.max(0, end - inS)
  const factor = slotS > 0 ? avail / slotS : 0
  if (g.end?.kind === 'next_storyboard' && factor >= 0.75 && factor <= 1.33) {
    return { in_s: r3(inS), out_s: r3(end), ...(Math.abs(factor - 1) > 1e-6 ? { speed: Math.round(factor * 1e6) / 1e6 } : {}) }
  }
  if (avail >= slotS - 1e-9) return { in_s: r3(inS), out_s: r3(inS + slotS) }
  const hold = r3(slotS - avail)
  return { in_s: r3(inS), out_s: r3(Math.max(inS + 0.04, end)), ...(hold > 0.001 ? { hold_s: Math.min(10, hold) } : {}) }
}

/** V1 laid end to end in shot order, from 0 (the Video editor's cut is the shots in order). */
export function repackByShots(d: ProductionDocument, videoId: Id) {
  const v = d.videos[videoId]
  if (!v) return
  const sb = storyboardOfVideo(d, videoId)
  const order = new Map((sb ? shotsOf(d, sb.id) : []).map((s, i) => [s.id, i]))
  const items = cutOf(d, videoId).sort((a, b) => (order.get(a.follows?.shot_id ?? '') ?? 1e9) - (order.get(b.follows?.shot_id ?? '') ?? 1e9) || (a.start_s ?? 0) - (b.start_s ?? 0))
  let at = 0
  for (const it of items) {
    const want = r3(at)
    if (v.timeline[it.id] && v.timeline[it.id].start_s !== want) v.timeline[it.id].start_s = want
    at += itemLen(it)
  }
}

/**
 * Take `genId` as shot `shotId`'s clip in the video's cut: its V1 clip plays it (its fades and transition
 * stay), or one is made for the shot. V1 is laid out again in shot order.
 */
export function pickInCut(d: ProductionDocument, videoId: Id, shotId: Id, genId: Id) {
  const v = d.videos[videoId]
  const g = d.generations[genId]
  const shot = d.shots[shotId]
  if (!v || !g || !shot) return
  const slot = shotSlot(g, shotId, shot.duration_s)
  const item = cutItemFor(d, shotId, videoId)
  if (item) {
    const it = v.timeline[item.id]
    it.source = { generation_id: genId, in_s: slot.in_s, out_s: slot.out_s }
    if (slot.hold_s) it.hold_s = slot.hold_s
    else delete it.hold_s
    if (slot.speed) it.speed = slot.speed
    else delete it.speed
    it.follows = { ...(g.box_id ? { box_id: g.box_id } : {}), shot_id: shotId }
  } else {
    v.timeline[newUlidId('item')] = {
      track: 'V1', start_s: 0, source: { generation_id: genId, in_s: slot.in_s, out_s: slot.out_s },
      follows: { ...(g.box_id ? { box_id: g.box_id } : {}), shot_id: shotId }, ...(slot.hold_s ? { hold_s: slot.hold_s } : {}),
      ...(slot.speed ? { speed: slot.speed } : {}),
    }
  }
  repackByShots(d, videoId)
}

/** Take a shot out of the cut (its V1 clip goes; the rest close up in shot order). */
export function dropFromCut(d: ProductionDocument, videoId: Id, shotId: Id) {
  const v = d.videos[videoId]
  const item = v ? cutItemFor(d, shotId, videoId) : undefined
  if (!v || !item) return
  delete v.timeline[item.id]
  repackByShots(d, videoId)
}
