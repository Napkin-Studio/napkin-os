// The Storyboard panel's writes on a contract-3 draft (run each inside one updateDoc): the storyboard's
// ratio and length, a new shot, a shot's move, and the answer to Dex's keep-or-remove question. The
// words (the script, a shot's action and direction, its @names) are live text, written by the editors
// and script/edits.ts, never here (features/script-editor.clan).

import { rankBetween } from '../../../clan-store/src'
import type { Ratio, ProductionDocument } from '../contracts/types'
import { newId } from '../lib/ulid'
import { mainStoryboard, mainVideo, shotsOf } from '../model/selectors'

type Doc = ProductionDocument

/** The storyboard's format; the video's follows it. */
export function setRatio(d: Doc, ratio: Ratio) {
  const sb = mainStoryboard(d)
  if (sb) d.storyboards[sb.id].ratio = ratio
  const v = mainVideo(d)
  if (v) d.videos[v.id].ratio = ratio
}

/** The storyboard's target length. */
export function setTarget(d: Doc, seconds: number) {
  const sb = mainStoryboard(d)
  if (sb) d.storyboards[sb.id].target_s = seconds
}

/** A new shot after the last one on the main storyboard. Its id. */
export function addShot(d: Doc): string {
  const sb = mainStoryboard(d)
  if (!sb) throw new Error('This project has no storyboard.')
  const last = shotsOf(d, sb.id).at(-1)
  const id = newId('shot')
  d.shots[id] = {
    id, v: 1, field_v: {}, storyboard_id: sb.id, rank: rankBetween(last?.rank ?? null, null), kind: 'shot',
    duration_s: 5, camera: { size: 'medium', movement: 'static' }, status: 'planned',
  }
  return id
}

/** Move a shot one place up (-1) or down (+1): one rank write. */
export function moveShot(d: Doc, shotId: string, by: -1 | 1) {
  const s = d.shots[shotId]
  if (!s) return
  const shots = shotsOf(d, s.storyboard_id)
  const i = shots.findIndex((x) => x.id === shotId)
  const j = i + by
  if (i < 0 || j < 0 || j >= shots.length) return
  const [a, b] = by < 0 ? [shots[j - 1]?.rank ?? null, shots[j].rank] : [shots[j].rank, shots[j + 1]?.rank ?? null]
  s.rank = rankBetween(a, b)
}

/** A person's answer to Dex's "Shot N no longer has a scene. Keep it or remove it?" (jobs/plan.ts): the ask
 *  is answered; with Remove, the caller removes the shot in the same write (doc/remove.ts removeShot). */
export function answerShotAsk(d: Doc, askId: string, optionId: 'keep' | 'remove', by: string, at = new Date().toISOString()) {
  const a = d.asks[askId]
  if (!a || a.state !== 'open') return
  a.answers = [...a.answers, { option_id: optionId, by, at }].slice(-16)
  a.state = 'answered'
}
