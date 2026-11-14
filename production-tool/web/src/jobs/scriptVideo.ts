// A video straight from a script (ui-behaviour 3.5, 3.17; features/production-ui.clan, prompt-start.clan).
//
// A Video that a Script drives and no Storyboard renders asks Dex's nudge before anything is spent:
// "Plan a storyboard first?", with Plan the storyboard first (Recommended) and Make clips straight from
// the script, "You can always switch later." and Later. The question is derived from the video's links;
// the person's answer is stored as an ask on the video (asks[id], node {kind: 'video'}), so it is in
// History, Change works, and the Video editor reads it: straight from the script, Make clips makes each
// shot's clip from its words when it has no frame yet (jobs/clips.ts), through the send tray.
//
// Straight from the script makes no Storyboard node (decided 2026-10-15): the video gets its own shot list
// (an implicit storyboard owned by the video, contracts storyboard.implicit and video_id), Dex plans into
// it, and the Video editor shows and edits the shots on its timeline. Plan the storyboard first links the
// storyboard its script drives (made beside the script on the canvas when there is none), or turns the
// video's own shot list into a node (Make a storyboard from these shots). Planning is free; no clip starts.

import type { Id, ProductionDocument, Question } from '../contracts/types'
import { PLAN_FIRST, STRAIGHT, scriptVideoAsk } from './clipMode'

import { canvasActions } from '../canvas/chrome/actions'
import { systemUpdate, updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { newId } from '../lib/ulid'
import { scriptText, shotsOf, storyboardOfScript } from '../model/selectors'
import type { FrameDeps } from './frames'
import { planOrJoin, runningPlan } from './plan'
import { linkInto, ownShotList, scriptOf, storyboardOfVideo } from './prompt'
import { liveGet } from '../model/live'

export { clipMode, isScriptVideoAsk, PLAN_FIRST, scriptVideoAsk, STRAIGHT, type ClipMode } from './clipMode'

type Doc = ProductionDocument

/** About how long a shot runs when Dex has not planned yet: 15 s is about 6 shots (mock Asks). */
const SHOT_S = 2.5

/** How many shots a script makes: the storyboard's when it is planned, else about one per 2.5 s of its length. */
export function shotCount(d: Doc, scriptId: Id): { n: number; exact: boolean } {
  const sb = storyboardOfScript(d, scriptId)
  const planned = sb ? shotsOf(d, sb.id).filter((s) => s.kind !== 'end_card').length : 0
  if (planned) return { n: planned, exact: true }
  const target = d.scripts[scriptId]?.target_s || sb?.target_s || 15
  return { n: Math.max(1, Math.min(12, Math.round(target / SHOT_S))), exact: false }
}

/** "6 shots" when planned, "about 6 shots" when estimated. */
export function countWords(c: { n: number; exact: boolean }, noun: 'shot' | 'clip'): string {
  return `${c.exact ? '' : 'about '}${c.n} ${noun}${c.n === 1 ? '' : 's'}`
}

/** Dex's nudge on a video a script drives (3.5, artboard 4c). `id`: the ask's, once it is stored. */
export function scriptVideoQuestion(count: { n: number; exact: boolean }, id = newId('q')): Question {
  const shots = countWords(count, 'shot')
  return {
    id,
    kind: 'nudge',
    text: 'Plan a storyboard first?',
    why: 'Clips come out better from frames you\'ve checked.',
    options: [
      { id: PLAN_FIRST, label: 'Plan the storyboard first', detail: `${shots[0].toUpperCase()}${shots.slice(1)}, with frames you check first`, value: { route: PLAN_FIRST } },
      { id: STRAIGHT, label: 'Make clips straight from the script', detail: (() => { const c = countWords(count, 'clip'); return c[0].toUpperCase() + c.slice(1) })(), value: { route: STRAIGHT } },
    ],
    allow_text: false,
    recommended_option_id: PLAN_FIRST,
  }
}

/** The script that drives this video (its `drives` link), if any. */
export function scriptOfVideo(d: Doc, videoId: Id): Id | undefined {
  const l = Object.values(d.links ?? {}).find((x) => x.role === 'drives' && x.from.kind === 'script' && x.to.kind === 'video' && x.to.id === videoId)
  return l && d.scripts[l.from.id] ? l.from.id : undefined
}

/**
 * Does this video wait on Dex's question, and from which script: a script drives it and no storyboard
 * renders it yet (3.5, a Script alone); or the storyboard that renders it has no shots and nothing
 * planning, and its script has words (a project's own video, before anything is planned: the same
 * choice, frames first or clips straight from the script).
 */
export function waitsOnScriptAsk(d: Doc, videoId: Id): Id | null {
  if (!d.videos[videoId]) return null
  // Answered once, never asked again (owner, 2026-10-21): a plan that then could not go or failed shows
  // its own state (the Make room, the node's Plan shots), with Change in ClipChoice for a new answer.
  if (scriptVideoAsk(d, videoId)?.answers.length) return null
  const sb = storyboardOfVideo(d, videoId)
  if (!sb) return scriptOfVideo(d, videoId) ?? null
  if (shotsOf(d, sb.id).length || runningPlan(d, sb.id)) return null
  const scriptId = scriptOf(d, sb.id)
  return scriptId && scriptText(d, scriptId).trim() ? scriptId : null
}

/** Write the person's answer on the video (one step, theirs): the ask is made on the first answer. */
export async function recordScriptVideoAnswer(store: DocumentStore, videoId: Id, optionId: string, by: string, now = new Date().toISOString()): Promise<void> {
  const d = store.get()
  const sb = storyboardOfVideo(d, videoId)
  const scriptId = scriptOfVideo(d, videoId) ?? (sb ? scriptOf(d, sb.id) : undefined)
  const was = scriptVideoAsk(d, videoId)
  const question = was?.question ?? scriptVideoQuestion(scriptId ? shotCount(d, scriptId) : { n: 6, exact: false })
  if (!question.options.some((o) => o.id === optionId)) throw new Error('That is not one of the choices.')
  const label = question.options.find((o) => o.id === optionId)!.label
  await updateDoc(store, (x) => {
    const row = { option_id: optionId, by, at: now }
    const there = was && x.asks[was.id]
    if (there) {
      there.state = 'answered'
      there.answers = [...there.answers, row].slice(-16)
    } else {
      x.asks[question.id] = { id: question.id, v: 1, field_v: {}, question, node: { kind: 'video', id: videoId }, crew: 'dex', state: 'answered', answers: [row] }
    }
  }, `answer: ${label.toLowerCase()}`)
}

/**
 * The storyboard a script drives, made when it has none: on the canvas beside the script (one undo step)
 * when a canvas is mounted, else in the document only, with its `drives` link.
 */
export async function storyboardForScript(store: DocumentStore, scriptId: Id): Promise<{ storyboardId: Id; made: boolean }> {
  const onCanvas = canvasActions.storyboardFor(scriptId)
  if (onCanvas) return onCanvas
  const d = store.get()
  if (!d.scripts[scriptId]) throw new Error('This script is gone.')
  const there = storyboardOfScript(d, scriptId)
  if (there) return { storyboardId: there.id, made: false }
  const sbId = newId('storyboard')
  const linkId = newId('link')
  await systemUpdate(store, (x) => {
    const n = Object.keys(x.storyboards).length
    x.storyboards[sbId] = { id: sbId, v: 1, field_v: {}, title: n ? `Storyboard ${n + 1}` : 'Storyboard', ratio: '16:9', target_s: x.scripts[scriptId].target_s || 15 }
    x.links[linkId] = { id: linkId, v: 1, field_v: {}, from: { kind: 'script', id: scriptId }, to: { kind: 'storyboard', id: sbId }, role: 'drives' }
  }, `add a storyboard for scripts[${scriptId}]`)
  return { storyboardId: sbId, made: true }
}

/** Why Plan shots cannot run on a script now, in words, or null. */
export function planShotsBlocked(d: Doc, scriptId: Id): string | null {
  if (!d.scripts[scriptId]) return 'This script is gone.'
  return scriptText(d, scriptId).trim() ? null : 'Write the script first'
}

/**
 * Plan shots from a script (3.10): on the storyboard it drives, made beside it when it has none. A
 * plan already running there is joined.
 */
export async function planFromScript(deps: FrameDeps, scriptId: Id): Promise<{ storyboardId: Id; made: boolean; joined: boolean }> {
  const blocked = planShotsBlocked(liveGet(deps.doc), scriptId)
  if (blocked) throw new Error(blocked === 'Write the script first' ? 'Write the script first: Plan shots reads its words.' : blocked)
  const { storyboardId, made } = await storyboardForScript(deps.doc, scriptId)
  const r = await planOrJoin(deps, { storyboardId })
  return { storyboardId, made, joined: r.joined }
}

/**
 * Make a storyboard from these shots (ui-behaviour 3.13, decided 2026-10-15): a video's own shot list becomes
 * a Storyboard node on the canvas beside the video, driven by the video's script, with the shots, frames and
 * clips as they are. One canvas step: Undo takes the node away and the shots are the video's again.
 */
export async function storyboardFromShots(videoId: Id): Promise<{ storyboardId: Id }> {
  const made = canvasActions.storyboardFromShots(videoId)
  if (!made) throw new Error('Make a storyboard from these shots on the canvas: open this project with the canvas.')
  return made
}

/**
 * The person's answer to "Plan a storyboard first?" (either option), stored on the video, then:
 *   - Make clips straight from the script: the video gets its own shot list when it has no storyboard (no
 *     node on the canvas, decided 2026-10-15) and Dex plans the shots into it;
 *   - Plan the storyboard first: a video's own shot list becomes a Storyboard node (storyboardFromShots);
 *     with no storyboard, the one its script drives (made beside the script when there is none) is linked.
 * Dex plans when there are no shots yet. Free: no clip starts. The script is checked before anything is written.
 */
export async function answerScriptVideo(deps: FrameDeps, videoId: Id, optionId: string, by: string): Promise<{ storyboardId: Id }> {
  const d = liveGet(deps.doc)
  if (!d.videos[videoId]) throw new Error('This video is gone.')
  const had = storyboardOfVideo(d, videoId)
  const scriptId = scriptOfVideo(d, videoId) ?? (had ? scriptOf(d, had.id) : undefined)
  if (!had || !shotsOf(d, had.id).length) {
    if (!scriptId) throw new Error('Link a script to this video first.')
    if (!scriptText(d, scriptId).trim()) throw new Error('Write the script first: Dex plans the shots from its words.')
  }
  if (optionId !== STRAIGHT && had?.implicit && !canvasActions.canMake()) throw new Error('Make a storyboard from these shots on the canvas: open this project with the canvas.')
  await recordScriptVideoAnswer(deps.doc, videoId, optionId, by)
  let sbId = had?.id
  if (optionId === STRAIGHT) {
    sbId ??= await ownShotList(deps.doc, videoId)
  } else if (had?.implicit) {
    await storyboardFromShots(videoId)
  } else if (!sbId) {
    sbId = (await storyboardForScript(deps.doc, scriptId!)).storyboardId
    await linkInto(deps.doc, { kind: 'storyboard', id: sbId }, { kind: 'video', id: videoId })
  }
  const now = liveGet(deps.doc)
  if (!shotsOf(now, sbId!).length && !runningPlan(now, sbId)) await planOrJoin(deps, { storyboardId: sbId })
  return { storyboardId: sbId! }
}
