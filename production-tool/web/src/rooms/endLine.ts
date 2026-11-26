// The brief's end line in the film (UAT round 4, R4-F6, UX 5): the brief says the film ends on a line ("End line must
// be "Quietboil. Let them sleep.""), the plan put it on the last shot as a voice-over no model voiced, and the film had
// it nowhere. When no clip voices it and no card or text says it, the one compiled plan (preview and render alike)
// shows it as a super over the last shot, and Review says so. Nothing is written to the document: the super goes the
// moment a clip voices the line or a card or text says it.

import type { Id, ProductionDocument } from '../contracts/types'
import { briefForJob, endLineOf } from '../brief/model'
import { shotsOf, storyboardOfVideo } from '../model/selectors'
import { lineFacts, type LineFact } from '../stages/soundFacts'
import { compileFor, MENTION_NOTE, PLACE, type Plan } from './timeline'

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
  // The card says it when one of its fields holds the whole line: "Refill" over "Not landfill. Logo top right…" does not
  // (UAT round 4 F34, local run: Review ticked "the end card shows it" for that card).
  if (e && [e.headline, e.line, e.cta].some((t) => !!t && words(t).includes(l))) return { line, how: 'card' }
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

const WHERE: Record<Exclude<EndLine['how'], 'voiced'>, string> = { card: 'the end card shows it', text: 'a text on the film shows it', super: 'it shows as a super over the last shot' }
const clip40 = (t: string) => (t.length > 40 ? `${t.slice(0, 39)}\u2026` : t)

/**
 * The Review agent's lines about what is not heard, before a render. The brief's end line that is only a voice-over no
 * clip says is said plainly, once, with where the film shows it instead (UAT round 4 F34: it read "Not heard … (shot 5)"
 * as if the line were lost, while the end card was meant to carry it). Every other unvoiced line stays a "Not heard".
 */
export function heardChecks(end: EndLine | undefined, unvoiced: readonly LineFact[]): { text: string; ok: boolean }[] {
  const out: { text: string; ok: boolean }[] = []
  const l = end ? words(end.line) : ''
  const said = end && end.how !== 'voiced' ? unvoiced.find((x) => words(x.text).includes(l)) : undefined
  if (end && end.how !== 'voiced') {
    out.push({
      text: said
        ? `The brief\u2019s end line \u201c${end.line}\u201d is only ${said.who ? `${said.who}\u2019s` : 'a'} voice-over on shot ${said.n}, which no clip says yet: ${WHERE[end.how]}`
        : `The brief\u2019s end line \u201c${end.line}\u201d is not voiced: ${WHERE[end.how]}`,
      ok: true,
    })
  }
  for (const x of unvoiced) {
    if (x === said) continue
    out.push({ text: `Not heard: ${x.who ? `${x.who}\u2019s ` : ''}\u201c${clip40(x.text)}\u201d (shot ${x.n}). ${x.why.split(':')[0]}.`, ok: false })
  }
  return out
}

/**
 * The Review agent's look at what the end card will print (UAT round 4 gate: its line read "@logo on a clean, quiet
 * field." twice, the shot's layout note, and nothing said so). A picture's @name or a placement direction in the headline
 * or the line, and a line that only repeats the headline, are said before the render.
 */
export function cardWordsChecks(card: Pick<NonNullable<Plan['endCard']>, 'headline' | 'line'> | undefined): { text: string; ok: boolean }[] {
  if (!card) return []
  const out: { text: string; ok: boolean }[] = []
  for (const [field, text] of [['headline', card.headline], ['line', card.line]] as const) {
    if (!text) continue
    if (MENTION_NOTE.test(text) || PLACE.test(text)) out.push({ text: `The end card\u2019s ${field} reads \u201c${clip40(text)}\u201d: that is a note on how the card looks, not words for it`, ok: false })
  }
  if (card.headline && card.line && words(card.line).includes(words(card.headline)) && words(card.line) !== '') out.push({ text: 'The end card says its headline again in its line', ok: false })
  return out
}
