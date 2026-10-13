// The Storyboard panel's writes on a contract-3 draft (run each inside one updateDoc): the script's
// words (the main script's scenes), the storyboard's ratio and length, a new shot, a shot's move, and
// the @names a shot shows, which live in its words (a shot's refs are what its text mentions).

import { rankBetween } from '../../../clan-store/src'
import type { Ratio, ProductionDocument, Shot } from '../contracts/types'
import { MENTION } from '../lib/names'
import { newId } from '../lib/ulid'
import { keyNamed, mainScript, mainStoryboard, mainVideo, refNamed, scenesOf, shotsOf } from '../model/selectors'

type Doc = ProductionDocument

/** The script's words go into its first scene (made, with a rank, when there is none); the other
 *  scenes' unplanned words fold into it, so the box shows exactly what the scenes hold. */
export function writeScript(d: Doc, text: string) {
  const script = mainScript(d)
  if (!script) throw new Error('This project has no script.')
  const scenes = scenesOf(d, script.id)
  if (!scenes.length) {
    if (!text) return
    const id = newId('scene')
    d.scenes[id] = { id, v: 1, field_v: {}, script_id: script.id, rank: rankBetween(null, null), heading: '', text }
    return
  }
  const [first, ...rest] = scenes
  d.scenes[first.id].text = text
  for (const sc of rest) if (sc.text) d.scenes[sc.id].text = ''
}

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
    duration_s: 5, camera: { size: 'medium', movement: 'static' }, status: 'planned', action: '',
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

/** The ids of the refs and keys some words mention (@maya_front, or a bare @maya). */
export function mentionedIds(d: Doc, text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(MENTION)) {
    const t = refNamed(d, m[1]) ?? (m[1].includes('_') ? undefined : keyNamed(d, m[1]))
    if (t && !ids.includes(t.id)) ids.push(t.id)
  }
  return ids
}

/** A shot's words as a patch for editShot: the refs follow the mentions (the CLAN store derives them
 *  from the live text itself; the snapshot store keeps them as written here). */
export function wordsPatch(d: Doc, shot: Shot, words: { action?: string; direction?: string }): Partial<Shot> {
  const action = words.action ?? shot.action ?? ''
  const direction = words.direction ?? shot.direction ?? ''
  return { ...words, refs: mentionedIds(d, `${action} ${direction}`) }
}

/** The shot's words with @name added at the end of its action. */
export function withMention(shot: Shot, name: string): string {
  const action = (shot.action ?? '').trimEnd()
  return action ? `${action} @${name}` : `@${name}`
}

/** The shot's words with every @name mention taken out. */
export function withoutMention(text: string, name: string): string {
  const esc = name.replace(/[-]/g, '\\-')
  return text.replace(new RegExp(`(?<![\\w@])@${esc}(?![a-z0-9_-])`, 'g'), '').replace(/ {2,}/g, ' ').trim()
}
