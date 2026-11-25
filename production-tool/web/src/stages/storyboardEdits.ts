// The Storyboard panel's writes on a contract-3 draft (run each inside one updateDoc): the storyboard's
// ratio and length, a new shot, a shot's move, and the answer to Dex's keep-or-remove question. The
// words (the script, a shot's action and direction, its @names) are live text, written by the editors
// and script/edits.ts, never here (features/script-editor.clan).

import { setScriptTarget } from '../script/length'
import { rankBetween } from '../../../clan-store/src'
import type { Ratio, ProductionDocument } from '../contracts/types'
import { newId } from '../lib/ulid'
import { mainStoryboard, mainVideo, scriptOfStoryboard, shotsOf } from '../model/selectors'

type Doc = ProductionDocument

/** The storyboard's format; the video's follows it. */
export function setRatio(d: Doc, ratio: Ratio) {
  const sb = mainStoryboard(d)
  if (sb) d.storyboards[sb.id].ratio = ratio
  const v = mainVideo(d)
  if (v) d.videos[v.id].ratio = ratio
}

/** The film's target length, set from the storyboard: one value along the chain, as the Script editor sets it
 *  (script/length.ts), so the script that drives it and its film say the same (UAT round 4 gate: 6 s vs 15 s). */
export function setTarget(d: Doc, seconds: number) {
  const sb = mainStoryboard(d)
  if (!sb) return
  const script = scriptOfStoryboard(d, sb.id)
  if (script) setScriptTarget(d, script.id, sb.id, seconds)
  else d.storyboards[sb.id].target_s = seconds
}

/** A new shot after the last one on `storyboardId` (absent: the main storyboard). Its id. */
export function addShot(d: Doc, storyboardId?: string): string {
  const sb = (storyboardId && d.storyboards[storyboardId]) || mainStoryboard(d)
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

/** The sheet's out-of-date line (features/production-new-ui.clan, mock "storyboard"): "2 clips out of date: frames 4
 *  and 5 changed after the clips were made." from the numbers of the shots whose clip is behind its frame. */
export function clipsBehindLine(ns: readonly number[]): string {
  if (!ns.length) return 'Clips up to date'
  const list = ns.length === 1 ? `frame ${ns[0]}` : `frames ${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`
  return `${ns.length} ${ns.length === 1 ? 'clip' : 'clips'} out of date: ${list} changed after the ${ns.length === 1 ? 'clip was' : 'clips were'} made.`
}
