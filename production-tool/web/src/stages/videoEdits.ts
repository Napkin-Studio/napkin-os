// The Video panel's writes on a contract-3 draft (run each inside one updateDoc): which take is in the
// cut for a shot (the main video's edl item pick), and a note on a take (a review with its window).

import { noteWindow, rankBetween } from '../../../clan-store/src'
import type { ProductionDocument, Region, Review } from '../contracts/types'
import { newId } from '../lib/ulid'
import { edlItemFor, edlOf, mainVideo } from '../model/selectors'

type Doc = ProductionDocument

/** Put take `takeId` in the main video's cut for its shot: the shot's item's pick (the item is made, after
 *  the others, when the shot is not in the cut yet). The take it replaces stays an alternate. */
export function pickTake(d: Doc, shotId: string, takeId: string) {
  const v = mainVideo(d)
  if (!v || !d.takes[takeId]) return
  const video = d.videos[v.id]
  const item = edlItemFor(d, shotId, v.id)
  if (!item) {
    const last = edlOf(d, v.id).at(-1)
    video.edl[newId('edl')] = { rank: rankBetween(last?.rank ?? null, null), kind: 'shot', shot_id: shotId, pick: { current: takeId } }
    return
  }
  const was = item.pick
  if (was?.current === takeId) return
  const alternates = [...(was?.alternates ?? []), ...(was ? [was.current] : [])].filter((id, i, all) => id !== takeId && all.indexOf(id) === i)
  video.edl[item.id].pick = { current: takeId, ...(alternates.length ? { alternates } : {}) }
}

/** A note at `atS` on a take of a shot, with its window (whole seconds around the moment, inside the
 *  shot: clan-store noteWindow) and the box drawn on the paused clip. Its id. */
export function addTakeNote(d: Doc, note: { takeId: string; shotId: string; shotS: number; atS: number; text: string; region?: Region | null; by: string; now?: string }): string {
  const id = newId('rev')
  const window = noteWindow(note.atS, note.shotS)
  const video = mainVideo(d)
  const r: Review = {
    id, v: 1, field_v: {},
    target: { kind: 'take', id: note.takeId },
    ...(video ? { video_id: video.id } : {}),
    shot_id: note.shotId,
    at_s: note.atS,
    ...(window ? { window } : {}),
    ...(note.region ? { region: note.region } : {}),
    by: note.by,
    state: 'open',
    text: note.text,
    created_at: note.now ?? new Date().toISOString(),
  }
  d.reviews[id] = r
  return id
}
