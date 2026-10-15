// A video straight from a script (ui-behaviour 3.5, 3.17; features/production-ui.clan, prompt-start.clan).
//
// A Video that a Script drives and no Storyboard renders asks Dex's nudge before anything is spent:
// "Plan a storyboard first?", with Plan the storyboard first (Recommended) and Make clips straight from
// the script, "You can always switch later." and Later. The question is derived from the video's links;
// the person's answer is stored as an ask on the video (asks[id], node {kind: 'video'}), so it is in
// History, Change works, and the Video editor reads it: straight from the script, Make clips makes each
// shot's clip from its words when it has no frame yet (jobs/clips.ts), through the send tray.
//
// Either answer gives the video the storyboard its script drives (made beside the script on the canvas
// when there is none) with a `renders` link, and Dex plans its shots there: nothing is hidden, and the
// shots are what Make clips makes clips of. Planning is free; no clip starts here.

import type { Ask, Id, ProductionDocument, Question } from '../contracts/types'
import { canvasActions } from '../canvas/chrome/actions'
import { systemUpdate, updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { newId } from '../lib/ulid'
import { scriptText, shotsOf, storyboardOfScript } from '../model/selectors'
import type { FrameDeps } from './frames'
import { planOrJoin, runningPlan } from './plan'
import { linkInto, scriptOf, storyboardOfVideo } from './prompt'

type Doc = ProductionDocument

/** The answers' option ids (and their routes). */
export const PLAN_FIRST = 'plan_first'
export const STRAIGHT = 'straight'

/** How the video's clips are made: from frames you check (the default), or straight from the script. */
export type ClipMode = 'frames' | 'straight'

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

/** Is this ask Dex's "Plan a storyboard first?" (found by its options' routes)? */
export function isScriptVideoAsk(a: Ask): boolean {
  return a.question.options.some((o) => (o.value as { route?: string } | undefined)?.route === STRAIGHT)
}

/** The person's stored answer about this video, if they gave one. */
export function scriptVideoAsk(d: Doc, videoId: Id): Ask | undefined {
  return Object.values(d.asks ?? {}).find((a) => a.node.kind === 'video' && a.node.id === videoId && isScriptVideoAsk(a))
}

/** How this video's clips are made: straight from the script once that was chosen (and not changed back). */
export function clipMode(d: Doc, videoId: Id | undefined): ClipMode {
  if (!videoId) return 'frames'
  const a = scriptVideoAsk(d, videoId)
  return a?.answers.at(-1)?.option_id === STRAIGHT ? 'straight' : 'frames'
}

/**
 * Does this video wait on Dex's question, and from which script: a script drives it and no storyboard
 * renders it yet (3.5, a Script alone); or the storyboard that renders it has no shots and nothing
 * planning, and its script has words (a project's own video, before anything is planned: the same
 * choice, frames first or clips straight from the script).
 */
export function waitsOnScriptAsk(d: Doc, videoId: Id): Id | null {
  if (!d.videos[videoId]) return null
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
  const blocked = planShotsBlocked(deps.doc.get(), scriptId)
  if (blocked) throw new Error(blocked === 'Write the script first' ? 'Write the script first: Plan shots reads its words.' : blocked)
  const { storyboardId, made } = await storyboardForScript(deps.doc, scriptId)
  const r = await planOrJoin(deps, { storyboardId })
  return { storyboardId, made, joined: r.joined }
}

/**
 * The person's answer to "Plan a storyboard first?" (either option): stored on the video, then the
 * video gets the storyboard its script drives (made when there is none) with a `renders` link, and
 * Dex plans the shots there when it has none. Free: no clip starts.
 */
export async function answerScriptVideo(deps: FrameDeps, videoId: Id, optionId: string, by: string): Promise<{ storyboardId: Id }> {
  const d = deps.doc.get()
  if (!d.videos[videoId]) throw new Error('This video is gone.')
  await recordScriptVideoAnswer(deps.doc, videoId, optionId, by)
  let sbId = storyboardOfVideo(deps.doc.get(), videoId)?.id
  if (!sbId) {
    const scriptId = scriptOfVideo(deps.doc.get(), videoId)
    if (!scriptId) throw new Error('Link a script to this video first.')
    if (!scriptText(deps.doc.get(), scriptId).trim()) throw new Error('Write the script first: Dex plans the shots from its words.')
    sbId = (await storyboardForScript(deps.doc, scriptId)).storyboardId
    await linkInto(deps.doc, { kind: 'storyboard', id: sbId }, { kind: 'video', id: videoId })
  }
  const now = deps.doc.get()
  if (!shotsOf(now, sbId).length && !runningPlan(now, sbId)) await planOrJoin(deps, { storyboardId: sbId })
  return { storyboardId: sbId }
}
