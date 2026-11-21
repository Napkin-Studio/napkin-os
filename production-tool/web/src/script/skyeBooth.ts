// Skye in the Booth (features/script-freeform.clan; mock script-freeform-v1 states draft, selection, asks,
// part): what the box applies to, and how her drafts and edits read as cards. Pure, so it can be tested.
// The flows are skye.ts's, unchanged: draft from a brief, revise, and the free 'instruct' on a selection.

import { flatText, type PMNode, type Prose } from '../../../clan-store/src'
import type { Id, ProductionDocument, Suggestion, WriteInput, WriteTarget } from '../contracts/types'
import { roughLines, roughSeconds, roughText, type ComposedScript } from './compose'
import { refNames } from './extensions'

type RefNames = ReturnType<typeof refNames>
import { SKYE_OPTIONS, sceneShotSeconds, wordDiff } from './skye'

type Doc = ProductionDocument

/** A stretch of an item's words, in its fragment's positions (ProseMirror's), as the write's selection. */
export interface Span { from: number; to: number; text: string }

/** What Skye's box applies to: the whole script, a part (one paragraph or shot) or the person's selection. */
export type SkyeScope =
  | { kind: 'whole'; target: WriteTarget | null; label: string }
  | { kind: 'part'; target: WriteTarget; block: number; label: string; text: string; span: Span }
  | { kind: 'selection'; target: WriteTarget; span: Span }

const LEAF_INLINE = new Set(['mention', 'hardBreak', 'image'])

/** A node's size in ProseMirror positions. */
export function nodeSize(n: PMNode): number {
  if (n.type === 'text') return n.text?.length ?? 0
  if (!n.content?.length) return LEAF_INLINE.has(n.type) ? 1 : 2
  return 2 + n.content.reduce((a, c) => a + nodeSize(c), 0)
}

/** The span of a fragment's top-level block `index`: its words, from just inside it to its end. */
export function blockSpan(prose: Prose | undefined, index: number, refs: RefNames = {}): Span | null {
  const blocks = prose?.content ?? []
  if (index < 0 || index >= blocks.length) return null
  let pos = 0
  for (let i = 0; i < index; i++) pos += nodeSize(blocks[i])
  const b = blocks[index]
  const size = nodeSize(b)
  return { from: pos + 1, to: pos + size - 1, text: blockText(b, refs) }
}

function blockText(b: PMNode, refs: RefNames): string {
  if (!b.content?.length) return ''
  if (b.content.every((c) => c.type === 'text' || LEAF_INLINE.has(c.type))) return flatText(b.content, refs)
  return b.content.map((c) => blockText(c, refs)).filter(Boolean).join('\n')
}

/** Each paragraph with words on the page, in script order, numbered as the outline numbers them (¶1…). */
export function paragraphs(d: Doc, composed: ComposedScript, proseOf: (kind: 'scene', id: Id) => Prose | undefined): { target: WriteTarget; block: number; n: number; text: string }[] {
  const refs = refNames(d)
  const out: { target: WriteTarget; block: number; n: number; text: string }[] = []
  for (const r of composed.rows) {
    if (r.kind !== 'scene') continue
    const blocks = proseOf('scene', r.id)?.content ?? []
    blocks.forEach((b, i) => {
      const text = blockText(b, refs)
      if (text.trim()) out.push({ target: { kind: 'scene', id: r.id }, block: i, n: out.length + 1, text })
    })
  }
  return out
}

/** The paragraph or shot a click on the page lands on, as a part of the script. */
export function partAt(d: Doc, composed: ComposedScript, target: WriteTarget, block: number, proseOf: (kind: 'scene' | 'shot' | 'beat', id: Id) => Prose | undefined): Extract<SkyeScope, { kind: 'part' }> | null {
  const refs = refNames(d)
  if (target.kind === 'scene') {
    const ps = paragraphs(d, composed, (k, id) => proseOf(k, id))
    const p = ps.find((x) => x.target.id === target.id && x.block === block) ?? ps.find((x) => x.target.id === target.id)
    if (!p) return null
    const span = blockSpan(proseOf('scene', target.id), p.block, refs)
    return span ? { kind: 'part', target, block: p.block, label: `¶${p.n}`, text: p.text, span } : null
  }
  const shotId = target.kind === 'beat' ? d.beats[target.id]?.shot_id : target.id
  const n = composed.shots.findIndex((s) => s.id === shotId) + 1
  if (!shotId || n < 1) return null
  const prose = proseOf('shot', shotId)
  const text = (prose?.content ?? []).map((b) => blockText(b, refs)).filter(Boolean).join('\n')
  const last = Math.max(0, (prose?.content?.length ?? 1) - 1)
  const first = blockSpan(prose, 0, refs)
  const end = blockSpan(prose, last, refs)
  const span = first && end ? { from: first.from, to: end.to, text } : { from: 1, to: 1, text }
  return { kind: 'part', target: { kind: 'shot', id: shotId }, block: 0, label: `Shot ${n}`, text, span }
}

/** What 'Whole script' asks about: an empty script's first scene (a draft), else the one scene with words, else
 *  the scene the caret is in or the first with words. Its chip says which when the script has several. */
export function wholeScope(d: Doc, composed: ComposedScript, proseOf: (kind: 'scene', id: Id) => Prose | undefined, caretScene?: Id): Extract<SkyeScope, { kind: 'whole' }> {
  const scenes = composed.rows.filter((r) => r.kind === 'scene').map((r) => r.id)
  // A scene Plan shots made into shots has words still, in its shots (UAT round 4, R4-F3: with no heading, an ask after
  // Plan shots had no target and went as a new draft of the script).
  const planned = new Set(composed.rows.flatMap((r) => (r.kind === 'shot' && r.sceneId ? [r.sceneId] : [])))
  const worded = scenes.filter((id) => (proseOf('scene', id)?.content ?? []).some((b) => blockText(b, refNames(d)).trim()) || !!d.scenes[id]?.heading.trim() || planned.has(id))
  if (worded.length <= 1) return { kind: 'whole', target: worded[0] ? { kind: 'scene', id: worded[0] } : null, label: 'Whole script' }
  const id = caretScene && worded.includes(caretScene) ? caretScene : worded[0]
  return { kind: 'whole', target: { kind: 'scene', id }, label: `Scene ${scenes.indexOf(id) + 1}` }
}

/** 'Make it N s' on a paragraph: its fair share of the target by its words, in half seconds. */
export function shareSeconds(targetS: number, partText: string, allText: string): number {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length
  const all = Math.max(1, words(allText))
  return Math.max(1, Math.round((targetS * words(partText) / all) * 2) / 2)
}

/** One line of a draft, as the card shows it. */
export interface DraftLine { kind: string; text: string }

const HEADING = /^(?:INT|EXT|INT\.?\/EXT|I\/E|EST)[. ]/i
const SCREENPLAY = new Set(['character', 'dialogue', 'parenthetical', 'transition'])

/** A draft's words as lines with their kinds; `screenplay` when it reads as one (a heading, a character). */
export function draftLines(d: Doc, sug: Suggestion): { lines: DraftLine[]; screenplay: boolean } {
  const refs = refNames(d)
  const blocks = (sug.proposed.prose as unknown as Prose | undefined)?.content
  const lines: DraftLine[] = blocks?.length
    ? blocks.map((b) => ({ kind: b.type, text: blockText(b, refs) }))
    : sug.proposed.text.split('\n').map((t) => ({ kind: 'action', text: t }))
  const shaped = lines.map((l) => (HEADING.test(l.text.trim()) ? { ...l, kind: 'heading' } : l))
  return { lines: shaped.filter((l) => l.text.trim()), screenplay: shaped.some((l) => l.kind === 'heading' || SCREENPLAY.has(l.kind)) }
}

/** A page draft's rough length, by the band's rule (compose.roughSeconds): what Keep would make the band say. */
export function draftSeconds(d: Doc, sug: Suggestion): number {
  const text = draftLines(d, sug).lines.map((l) => (l.kind === 'character' ? l.text.toUpperCase() : l.kind === 'parenthetical' && !/^\(.*\)$/.test(l.text.trim()) ? `(${l.text})` : l.text)).join('\n')
  return roughSeconds(text)
}

/** How a card names what Skye was asked: 'From your words: “…”', 'On your selection: “…”', 'On ¶3: Tighten'. */
export function askedWords(write: WriteInput | undefined, sug: Suggestion, part?: string): { lead: string; quote?: string } {
  const verb = write ? SKYE_OPTIONS.find((o) => o.intent === write.intent)?.label(write.seconds ?? 0) : undefined
  const where = write?.selection ? (part ? `On ${part}` : 'On your selection') : sug.mode === 'draft' ? 'From your words' : 'The whole script, from'
  if (write?.instruction) return { lead: where, quote: write.instruction }
  if (verb && write?.intent !== 'draft' && write?.intent !== 'instruct') return { lead: `${where}: ${verb}` }
  return { lead: sug.note }
}

/** Where a kept card lands, said beside Keep. */
export function landsWhere(sug: Suggestion, write: WriteInput | undefined, emptyPage: boolean, sceneNo: (id: Id) => number, shotNo: (id: Id) => number): string {
  if (sug.mode === 'draft') return emptyPage ? 'Lands on the empty page' : sug.target.kind === 'scene' ? `Lands in scene ${sceneNo(sug.target.id)}` : 'Lands in the script'
  if (write?.selection) return 'Replaces your selection'
  if (sug.target.kind === 'shot') return `Replaces shot ${shotNo(sug.target.id)}’s words`
  if (sug.target.kind === 'beat') return 'Replaces the line'
  return 'Replaces the page'
}

/** Skye's suggestions on this script's items, open or gone stale. */
export function scriptSuggestions(d: Doc, composed: ComposedScript): Suggestion[] {
  const shots = new Set(composed.shots.map((s) => s.id))
  const mine = (t: WriteTarget) => t.kind === 'scene' ? d.scenes[t.id]?.script_id === composed.script.id
    : t.kind === 'shot' ? shots.has(t.id) : shots.has(d.beats[t.id]?.shot_id ?? '')
  return Object.values(d.suggestions).filter((s) => (s.state === 'open' || s.state === 'stale') && mine(s.target))
    .sort((a, b) => (a.id < b.id ? 1 : -1))
}

/** The meter's segments: each planned shot, else each written paragraph, by its rough seconds. */
export function meterSegments(doc: ProductionDocument, composed: ComposedScript): { id: string; s: number }[] {
  if (composed.shots.length) return composed.shots.map((s) => ({ id: s.id, s: s.duration_s }))
  return roughLines(roughText(doc, composed.script.id)).map((s, i) => ({ id: `p${i}`, s: Math.round(s * 10) / 10 })).filter((x) => x.s > 0)
}

/** One row of an edit card in screenplay layout: its element (cue, parenthetical, dialogue, action…) and its
 *  words, changed word by word where the line was rewritten, whole where it is new or gone. */
export interface DiffRow { kind: string; parts: ReturnType<typeof wordDiff>; change: 'same' | 'changed' | 'new' | 'gone' }

/**
 * An edit as the page reads it (UAT 2026-11-21, script UX 1: the card flattened cues and parentheticals into one
 * struck-through paragraph): the lines matched as lines first, each kept in its element's layout, and only a line
 * that was rewritten shown word by word. Pure.
 */
export function lineDiff(before: { kind: string; text: string }[], after: { kind: string; text: string }[]): DiffRow[] {
  const a = before.filter((l) => l.text.trim())
  const b = after.filter((l) => l.text.trim())
  const n = a.length
  const m = b.length
  const same = (i: number, j: number) => a[i].text.trim() === b[j].text.trim()
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = same(i, j) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const raw: { op: 'same' | 'gone' | 'new'; i?: number; j?: number }[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && same(i, j)) { raw.push({ op: 'same', i, j }); i++; j++ }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) raw.push({ op: 'new', j: j++ })
    else raw.push({ op: 'gone', i: i++ })
  }
  // Within each run of changes, a line gone and a line new of the same element are one line rewritten, shown word by
  // word where the new line stands; what is left of the run is new or gone. The rows follow the new text's order.
  const out: DiffRow[] = []
  let k = 0
  while (k < raw.length) {
    const r = raw[k]
    if (r.op === 'same') { out.push({ kind: b[r.j!].kind, parts: [{ kind: 'same', text: b[r.j!].text }], change: 'same' }); k++; continue }
    const run: typeof raw = []
    while (k < raw.length && raw[k].op !== 'same') run.push(raw[k++])
    const gones = run.filter((x) => x.op === 'gone').map((x) => a[x.i!])
    const used = new Set<number>()
    for (const x of run.filter((y) => y.op === 'new')) {
      const w = b[x.j!]
      const g = gones.findIndex((l, q) => !used.has(q) && l.kind === w.kind)
      if (g >= 0) { used.add(g); out.push({ kind: w.kind, parts: wordDiff(gones[g].text, w.text), change: 'changed' }) }
      else out.push({ kind: w.kind, parts: [{ kind: 'new', text: w.text }], change: 'new' })
    }
    gones.forEach((l, q) => { if (!used.has(q)) out.push({ kind: l.kind, parts: [{ kind: 'gone', text: l.text }], change: 'gone' }) })
  }
  return out
}

/** One line as an edit card draws it: a line kept, new or gone whole, or one side of a rewritten line. */
export interface CardLine { kind: string; change: DiffRow['change']; side?: 'was' | 'now'; parts: ReturnType<typeof wordDiff> }

/**
 * An edit card's lines (UAT round 3, R3-F7: the old and new words of a rewritten line ran together, "socks anda
 * dressing gown creepsflips…"): a rewritten line is two lines, the old one with its cut words struck and then the
 * new one with its new words marked, each read whole. Words are marked only inside a rewritten line; a space
 * between two marked words is marked with them, so a phrase reads as one. Pure.
 */
export function cardLines(rows: DiffRow[]): CardLine[] {
  const side = (parts: DiffRow['parts'], drop: 'new' | 'gone') => {
    const kept = parts.filter((p) => p.kind !== drop)
    const out: DiffRow['parts'] = []
    kept.forEach((p, i) => {
      const marked = (q: DiffRow['parts'][number] | undefined) => !!q && q.kind !== 'same'
      const kind = p.kind === 'same' && !p.text.trim() && marked(kept[i - 1]) && marked(kept[i + 1]) ? kept[i - 1].kind : p.kind
      const last = out.at(-1)
      if (last && last.kind === kind) last.text += p.text
      else out.push({ kind, text: p.text })
    })
    return out
  }
  return rows.flatMap((r): CardLine[] => r.change !== 'changed' ? [{ kind: r.kind, change: r.change, parts: r.parts }] : [
    { kind: r.kind, change: r.change, side: 'was', parts: side(r.parts, 'new') },
    { kind: r.kind, change: r.change, side: 'now', parts: side(r.parts, 'gone') },
  ])
}

/** The part's length now, by the band's rule (or the shot's length), for "about 12 s → 9 s" on an edit card. */
export function secondsNow(d: Doc, sug: Suggestion, lines: { kind: string; text: string }[], fromShots = false): number {
  if (sug.target.kind === 'shot') return d.shots[sug.target.id]?.duration_s ?? 0
  // A scene Plan shots made into shots: its shots' seconds, not its empty words (R4-F3: "about 0 s -> 8 s").
  const scene = sug.target.kind === 'scene' ? d.scenes[sug.target.id] : undefined
  const planned = scene ? sceneShotSeconds(d, scene.script_id, scene.id) : undefined
  if (planned !== undefined && (fromShots || !lines.some((l) => l.text.trim()))) return planned
  const text = lines.map((l) => (l.kind === 'character' ? l.text.toUpperCase() : l.kind === 'parenthetical' && !/^\(.*\)$/.test(l.text.trim()) ? `(${l.text})` : l.text)).join('\n')
  return roughSeconds(text)
}
