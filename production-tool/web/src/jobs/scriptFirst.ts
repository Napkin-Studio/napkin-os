// "Draft a script from the brief, a script you check before shots are planned" (UAT round 5, S3-4): Dex asked on a
// brief storyboard with no script, the person picked that option, and the answer went back to Dex, who planned six
// shots straight away: there was no script to check. An option whose route writes a script now does what it says:
// the plan stops (a job waiting on a question is not charged), the storyboard gets a script of its own with the brief
// linked into it, the Script agent drafts it from the brief, and the person checks it before Plan shots.

import { canvasActions } from '../canvas/chrome/actions'
import type { Ask, Id, Link, ProductionDocument } from '../contracts/types'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { briefOf } from '../brief/model'
import { newId } from '../lib/ulid'
import { mainStoryboard, scriptOfStoryboard, scriptText } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { newEntity } from '../canvas/nodes/nodes'
import type { FrameDeps } from './frames'
import { scriptFromBrief } from './prompt'
import type { AnswerChoice } from './runner'

type Doc = ProductionDocument

/** The routes that mean "write the script first": the Storyboard nudge's own, and the ones Dex writes on a plan
 *  ("write_script", "draft_script", "write_the_script"). */
const SCRIPT_ROUTE = /^(?:(?:write|draft)_(?:a_|the_)?script(?:_first)?|script_first)$/

/** The storyboard whose plan this answer turns into a script first, or undefined: the answer is an option of a
 *  plan's ask (op shot_list) whose value routes to writing a script. */
export function scriptFirstPick(d: Doc, ask: Ask, answer: AnswerChoice): { storyboardId: Id } | undefined {
  if (!('optionId' in answer) || !ask.job_id) return undefined
  const job = d.jobs[ask.job_id]
  if (job?.op !== 'shot_list') return undefined
  const option = ask.question.options.find((o) => o.id === answer.optionId)
  const route = (option?.value as { route?: unknown } | undefined)?.route
  if (typeof route !== 'string' || !SCRIPT_ROUTE.test(route)) return undefined
  const node = job.node?.kind === 'storyboard' ? job.node : ask.node.kind === 'storyboard' ? ask.node : undefined
  return node && d.storyboards[node.id] ? { storyboardId: node.id } : undefined
}

/** The storyboard's own script, empty, to draft into: the one that drives it when it has no words yet, else a new
 *  one driving it (beside it on the canvas when a canvas is mounted). The project's main script is never taken for a
 *  storyboard that is not the main one. */
async function ownScript(store: DocumentStore, storyboardId: Id): Promise<Id> {
  const d = store.get() as Doc
  const there = scriptOfStoryboard(d, storyboardId)
  const isMain = mainStoryboard(d)?.id === storyboardId
  const drives = there && Object.values(d.links ?? {}).some((l) => l.role === 'drives' && l.from.id === there.id && l.to.id === storyboardId)
  if (there && (drives || isMain) && !scriptText(d, there.id).trim()) return there.id
  const onCanvas = canvasActions.scriptFor(storyboardId)
  if (onCanvas) return (await onCanvas).scriptId
  const made = newEntity(d, 'script')
  const link: Link = { id: newId('link'), v: 1, field_v: {}, from: { kind: 'script', id: made.entity.id }, to: { kind: 'storyboard', id: storyboardId }, role: 'drives' } as Link
  // A storyboard driven by another script keeps one driver: this one replaces it (the plan never read it).
  await updateDoc(store, (x) => {
    for (const l of Object.values(x.links)) if (l.role === 'drives' && l.to.kind === 'storyboard' && l.to.id === storyboardId) delete x.links[l.id]
    x.scripts[made.entity.id] = made.entity as Doc['scripts'][string]
    x.links[link.id] = link
  }, `add a script for storyboards[${storyboardId}]`)
  return made.entity.id
}

/** The brief linked into the script (role brief), so the Script agent's draft reads it (brief/model.ts withBrief). */
async function briefInto(store: DocumentStore, briefId: Id, scriptId: Id): Promise<void> {
  const d = store.get() as Doc
  if (briefOf(d, scriptId)?.brief.id === briefId) return
  const id = newId('link')
  await updateDoc(store, (x) => {
    x.links[id] = { id, v: 1, field_v: {}, from: { kind: 'brief', id: briefId }, to: { kind: 'script', id: scriptId }, role: 'brief' } as Link
  }, 'link brief to script')
}

/**
 * Do what the option said: keep the person's answer on the ask, stop the plan (it waits on the question, uncharged),
 * give the storyboard a script of its own with the brief in it, and start the Script agent's draft from the brief.
 * Returns the script to open.
 */
export async function scriptFirst(deps: FrameDeps, store: ModelStore, ask: Ask, answer: AnswerChoice, by: string, storyboardId: Id, now = new Date().toISOString()): Promise<{ scriptId: Id; jobId?: string }> {
  const d = deps.doc.get() as Doc
  const brief = briefOf(d, storyboardId)
  if (!('optionId' in answer)) throw new Error('Pick one of the choices.')
  await updateDoc(deps.doc, (x) => {
    const a = x.asks[ask.id]
    if (!a) return
    a.answers = [...a.answers, { option_id: answer.optionId, by, at: now }].slice(-16)
    a.state = 'answered'
  }, 'answer')
  if (ask.job_id) await deps.runner.cancel(ask.job_id)
  const scriptId = await ownScript(deps.doc, storyboardId)
  if (!brief) return { scriptId }
  await briefInto(deps.doc, brief.brief.id, scriptId)
  const r = await scriptFromBrief(deps, store, scriptId, brief.brief.title ?? '')
  return { scriptId, ...('jobId' in r && r.jobId ? { jobId: r.jobId } : {}) }
}
