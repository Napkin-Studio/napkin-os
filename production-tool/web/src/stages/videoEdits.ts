// The Video panel's writes on a draft (run each inside one updateDoc): which take is in the cut for a shot (its
// V1 clip in the video's timeline, features/make-and-edit.clan), and a note on a take (a review with its window).

import { noteWindow } from '../../../clan-store/src'
import type { ProductionDocument, Region, Review } from '../contracts/types'
import { pickInCut } from '../doc/cutWrites'
import { newId } from '../lib/ulid'
import { mainVideo, videoOfShot } from '../model/selectors'

type Doc = ProductionDocument

/** Put take `takeId` in the cut for its shot, of `videoId` (absent: the video the shot lands in, else the main
 *  one): the shot's V1 clip plays it, keeping its place, fades and transition (a clip is made for a shot not in
 *  the cut yet). The take it replaces stays in the Bin. */
export function pickTake(d: Doc, shotId: string, takeId: string, videoId?: string) {
  const v = videoOfShot(d, shotId, videoId) ?? mainVideo(d)
  if (!v || !d.generations[takeId]) return
  pickInCut(d, v.id, shotId, takeId)
}

/** A note at `atS` on a take of a shot, with its window (whole seconds around the moment, inside the
 *  shot: clan-store noteWindow) and the box drawn on the paused clip. Its id. */
export function addTakeNote(d: Doc, note: { takeId: string; shotId: string; shotS: number; atS: number; text: string; region?: Region | null; by: string; now?: string; videoId?: string }): string {
  const id = newId('rev')
  const window = noteWindow(note.atS, note.shotS)
  const video = videoOfShot(d, note.shotId, note.videoId) ?? mainVideo(d)
  const r: Review = {
    id, v: 1, field_v: {},
    target: { kind: 'generation', id: note.takeId },
    ...(video ? { video_id: video.id } : {}),
    shot_id: note.shotId,
    // A moment needs its window (the schema ties at_s to it); a shot too short to hold one (under 2 s) gets a
    // note on the whole shot, which a box still fixes from the shot's frame (2026-10-19: every note on a 1.5 s
    // shot was refused and undone).
    ...(window ? { at_s: note.atS, window } : {}),
    ...(note.region ? { region: note.region } : {}),
    by: note.by,
    state: 'open',
    text: note.text,
    created_at: note.now ?? new Date().toISOString(),
  }
  d.reviews[id] = r
  return id
}
