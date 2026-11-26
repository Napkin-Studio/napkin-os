// Fountain export (features/script-editor.clan, P3): the script as a `.fountain` string, the inverse
// of fountain.ts' import, and the same screenplay as a print-ready HTML page (Save as PDF). Pure.
//
// Both outputs walk one ordered element list (scriptElements), built from the composed rows. Scenes
// and shots render from their prose, so transitions, centred text and dual dialogue survive; beats
// render by kind (a line or VO is a cue and dialogue; a moment, music, sound or camera beat is a note).

import { flatText, type PMNode, type Prose, type RefNames } from '../../../clan-store/src'
import type { Beat, Id, ProductionDocument } from '../contracts/types'
import { composeScript } from './compose'
import { refNames } from './extensions'

export type ScriptElement =
  | { el: 'heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'centered' | 'note'; text: string; dual?: boolean }

/** Whether a dialogue block's words carry the dual mark (the second, simultaneous speaker). */
const isDual = (b: PMNode): boolean =>
  (b.content ?? []).some((n) => Array.isArray(n.marks) && n.marks.some((m) => (m as { type?: string }).type === 'dual'))

/** A fragment's blocks as screenplay elements. A shot's direction reads as action (stage direction). */
function proseElements(prose: Prose | undefined, refs: RefNames): ScriptElement[] {
  const out: ScriptElement[] = []
  const blocks = prose?.content ?? []
  blocks.forEach((b, i) => {
    const text = flatText(b.content, refs)
    if (b.type === 'character') {
      const next = blocks.slice(i + 1).find((x) => x.type === 'dialogue' || x.type === 'character')
      out.push({ el: 'character', text: text.toUpperCase(), dual: !!(next && next.type === 'dialogue' && isDual(next)) })
    } else if (b.type === 'parenthetical') out.push({ el: 'parenthetical', text })
    else if (b.type === 'dialogue') out.push({ el: 'dialogue', text })
    else if (b.type === 'transition') out.push({ el: 'transition', text: text.toUpperCase() })
    else if (b.type === 'centered') out.push({ el: 'centered', text })
    else for (const line of text.split('\n')) out.push({ el: 'action', text: line })
  })
  return out
}

/** A beat as screenplay elements. */
function beatElements(b: Beat, refs: RefNames): ScriptElement[] {
  const text = (b.text ?? flatText(b.prose?.content?.[0]?.content as PMNode[] | undefined, refs)).trim()
  if (!text) return []
  if (b.kind === 'line' || b.kind === 'vo') {
    const cue = (b.speaker?.trim() || (b.kind === 'vo' ? 'NARRATOR' : 'SPEAKER')).toUpperCase() + (b.kind === 'vo' ? ' (V.O.)' : '')
    return [{ el: 'character', text: cue }, ...(b.parenthetical?.trim() ? [{ el: 'parenthetical' as const, text: b.parenthetical.trim() }] : []), { el: 'dialogue', text }]
  }
  return [{ el: 'note', text: `${b.kind}: ${text}` }]
}

/** The script as an ordered list of screenplay elements (scene heading, action, cue, dialogue, …). */
export function scriptElements(d: ProductionDocument, scriptId?: Id): { title?: string; elements: ScriptElement[] } {
  const c = composeScript(d, scriptId)
  if (!c) return { elements: [] }
  const refs = refNames(d)
  const elements: ScriptElement[] = []
  for (const row of c.rows) {
    if (row.kind === 'scene') {
      if (row.scene.heading.trim()) elements.push({ el: 'heading', text: row.scene.heading.trim().toUpperCase() })
      elements.push(...proseElements(row.scene.prose as unknown as Prose | undefined, refs))
    } else if (row.kind === 'shot' || row.kind === 'end_card') {
      elements.push(...proseElements(row.shot.prose as unknown as Prose | undefined, refs))
    } else {
      elements.push(...beatElements(row.beat, refs))
    }
  }
  return { ...(c.script.title?.trim() ? { title: c.script.title.trim() } : {}), elements }
}

/** One element as its Fountain line(s). */
function fountainOf(e: ScriptElement): string {
  switch (e.el) {
    case 'heading': return `\n${e.text}`
    case 'character': return `\n${e.text}${e.dual ? ' ^' : ''}`
    case 'parenthetical': return /^\(.*\)$/s.test(e.text.trim()) ? e.text.trim() : `(${e.text})`
    case 'dialogue': return e.text
    case 'transition': return `\n${/\bTO:$/.test(e.text) ? e.text : `> ${e.text}`}`
    case 'centered': return `\n> ${e.text} <`
    case 'note': return `\n[[${e.text}]]`
    default: return `\n${e.text}`
  }
}

/** The script as a Fountain string. Runs of blank lines are collapsed to one; an empty script is ''. */
export function fountainOut(d: ProductionDocument, scriptId?: Id): string {
  const { title, elements } = scriptElements(d, scriptId)
  if (!elements.length) return ''
  const parts: string[] = []
  if (title) parts.push(`Title: ${title}\n`)
  for (const e of elements) parts.push(fountainOf(e))
  const text = parts.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '')
  return text ? `${text}\n` : ''
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The script as a print-ready HTML page (courier, US-letter margins): the browser's Save as PDF. */
export function screenplayHtml(d: ProductionDocument, scriptId?: Id): string {
  const { title, elements } = scriptElements(d, scriptId)
  const body = elements.map((e) => {
    const cls = e.el + (e.el === 'character' && e.dual ? ' dual' : '')
    return `<p class="${cls}">${esc(e.text) || '&nbsp;'}</p>`
  }).join('\n')
  const name = title ? esc(title) : 'Script'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>
@page { size: letter; margin: 1in 1in 1in 1.5in; }
body { font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 1; color: #000; max-width: 6in; margin: 0 auto; }
h1 { font-size: 12pt; text-align: center; text-transform: uppercase; margin: 2in 0 0.5in; }
p { margin: 0 0 12pt; white-space: pre-wrap; }
.heading { text-transform: uppercase; font-weight: bold; margin-top: 24pt; }
.action { }
.character { margin: 12pt 0 0 2.2in; text-transform: uppercase; }
.parenthetical { margin-left: 1.6in; }
.dialogue { margin: 0 1in 12pt 1in; }
.transition { text-align: right; text-transform: uppercase; }
.centered { text-align: center; }
.note { font-style: italic; color: #555; }
</style></head><body>${title ? `<h1>${name}</h1>` : ''}${body}</body></html>`
}
