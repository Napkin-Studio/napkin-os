// The brief's end line in the film (UAT round 4, R4-F6, UX 5): the brief says the film ends on a line ("End line must
// be "Quietboil. Let them sleep.""), the plan put it on the last shot as a voice-over no model voiced, and the film had
// it nowhere. When no clip voices it and no card or text says it, the one compiled plan (preview and render alike)
// shows it as a super over the last shot, and Review says so. Nothing is written to the document: the super goes the
// moment a clip voices the line or a card or text says it.

import type { Id, ProductionDocument } from '../contracts/types'
import { briefForJob, endLineOf } from '../brief/model'
import { shotsOf, storyboardOfVideo } from '../model/selectors'
import { lineFacts } from '../stages/soundFacts'
import { compileFor, type Plan } from './timeline'

/** How long the super holds over the last shot, at most. */
export const END_LINE_S = 2.5
export const END_LINE_ID = 'auto-end-line'

const words = (x: string | undefined) => (x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export interface EndLine { line: string; how: 'voiced' | 'card' | 'text' | 'super' }

/** Where the brief's end line is in a plan: voiced in a clip, on the end card, in a text, or nowhere (then a super). */
export function endLineIn(plan: Pick<Plan, 'texts' | 'endCard'>, line: string, voiced: readonly string[]): EndLine {
  const l = words(line)
  if (voiced.some((t) => words(t).includes(l))) return { line, how: 'voiced' }
  const e = plan.endCard
  if (e && [e.headline, e.line, e.cta, `${e.headline ?? ''} ${e.line}`].some((t) => words(t).includes(l))) return { line, how: 'card' }
  if (plan.texts.some((t) => t.item_id !== END_LINE_ID && words(t.words).includes(l))) return { line, how: 'text' }
  return { line, how: 'super' }
}

/** The plan with the end line as a super over the last shot when nothing else says it (pure). */
export function withEndLineSuper(plan: Plan, end: EndLine | undefined): Plan {
  const last = plan.clips.at(-1)
  if (!end || end.how !== 'super' || !last) return plan
  const toS = Math.round((last.startS + last.durS) * 1000) / 1000
  const fromS = Math.round(Math.max(last.startS, toS - END_LINE_S) * 1000) / 1000
  return { ...plan, texts: [...plan.texts, { item_id: END_LINE_ID, words: end.line, style: 'super', fromS, toS, fadeInS: 0.3 }] }
}

/** The brief's end line for a video's film and where it is now; undefined when the brief names none. */
export function endLineOfVideo(d: ProductionDocument, videoId: Id, plan: Pick<Plan, 'texts' | 'endCard'>): EndLine | undefined {
  const line = endLineOf(briefForJob(d, { kind: 'video', id: videoId })?.brief.spine)
  if (!line) return undefined
  const sb = storyboardOfVideo(d, videoId)
  const voiced = lineFacts(d, videoId, sb ? shotsOf(d, sb.id).map((s) => s.id) : []).filter((f) => f.voiced).map((f) => f.text)
  return endLineIn(plan, line, voiced)
}

/** compileFor with the brief's end line as a super when nothing says it: what the preview plays and Render ad sends. */
export function compileWithEndLine(d: ProductionDocument, videoId: Id): Plan & { endLine?: EndLine } {
  const plan = compileFor(d, videoId)
  const end = endLineOfVideo(d, videoId, plan)
  return { ...withEndLineSuper(plan, end), ...(end ? { endLine: end } : {}) }
}
