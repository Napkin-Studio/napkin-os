// JobInput.context (features/pt-dex-context.clan; relay-api input.context): what the project holds for Dex besides
// pictures and the person's words. Before this nothing filled it, so the Brand board's rules never reached Dex
// (namedInput sends a palette, typography or rule ref as a picture only, its swatches, font and rule dropped).
//
// - The project's brand: every named ref with a brand role, as brandKit (campaign/layout.ts) reads it for the
//   sizes, so Dex and the layout read one brand: a palette's swatches, a typography ref's font and use, a brand
//   rule's do, don't or tone.
// - The documents linked into the node (and, for a shot, into its storyboard and the videos it renders), by their
//   excerpt: background only.
// Linked notes are already the person's words (linkedText.ts) and the brief is input.brief (brief/model.ts), so
// neither is repeated here. The relay cuts this to each op's kinds and budget (relay/job_context.py) before Dex
// reads it; this side only keeps the request small.

import type { Id, JobContext, JobInput, JobInputRow, LinkEndpoint, NamedRef, Op, ProductionDocument } from '../contracts/types'
import { scopeOf } from '../model/scope'
import { refName, refsList } from '../model/selectors'
import { readers } from './linkedText'

type Doc = ProductionDocument

/** The ops whose director reads input.context: the relay cuts it for exactly these (relay/job_context.py BUDGET; a
 *  relay test compares the lists). A view (the same character turned) reads none. */
export const CONTEXT_OPS: readonly Op[] = ['shot_list', 'generate', 'frame', 'frame_edit', 'region_edit', 'clip', 'clip_edit', 'clip_patch']

/** At most this many items (the contract allows 16), each text at most TEXT_MAX, all of them at most TOTAL_MAX. */
export const ITEMS_MAX = 16
export const TEXT_MAX = 600
export const TOTAL_MAX = 3000

interface Item { ctx: JobContext; row: JobInputRow }

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`)
const hex = (x: string) => (x.startsWith('#') ? x : `#${x}`).toUpperCase()
const RULE_WORD = { do: 'Do', dont: "Don't", tone: 'Tone' } as const

/** A brand ref's words: "Navy #0A1F44, Sand #E8DCC4"; "Inter Bold (headlines)"; "Don't: …". Undefined: it holds none. */
export function brandWords(r: NamedRef): { kind: JobContext['kind']; text: string } | undefined {
  if (r.role === 'palette' && r.swatches?.length) {
    return { kind: 'palette', text: r.swatches.map((s) => (s.name?.trim() ? `${s.name.trim()} ${hex(s.hex)}` : hex(s.hex))).join(', ') }
  }
  if (r.role === 'typography' && r.font?.family?.trim()) {
    return { kind: 'typography', text: `${r.font.family.trim()}${r.font.use?.trim() ? ` (${r.font.use.trim()})` : ''}` }
  }
  if (r.role === 'brand_rule' && r.rule?.text?.trim()) return { kind: 'brand_rule', text: `${RULE_WORD[r.rule.kind] ?? 'Rule'}: ${r.rule.text.trim()}` }
  return undefined
}

const USED_AS: Record<JobContext['kind'], string> = { brand_rule: 'brand rule', palette: 'brand palette', typography: 'brand typography', document: 'background document', note: 'note' }

/** The project's brand rules, palette and type, rules first. */
function brandItems(d: Doc): Item[] {
  const order: JobContext['kind'][] = ['brand_rule', 'palette', 'typography']
  const out: Item[] = []
  for (const r of refsList(d)) {
    const w = brandWords(r)
    if (!w) continue
    const title = cut(r.label?.trim() || `@${refName(r)}`, 200)
    const text = cut(w.text, TEXT_MAX)
    out.push({ ctx: { kind: w.kind, title, text }, row: { kind: 'brand', ref: r.id, used_as: USED_AS[w.kind], included: true, text: cut(text, 200) } })
  }
  return out.sort((a, b) => order.indexOf(a.ctx.kind) - order.indexOf(b.ctx.kind))
}

/** The documents linked into the node (and up a shot's chain), once each, that have an excerpt to read. */
function documentItems(d: Doc, node: LinkEndpoint): Item[] {
  const seen = new Set<Id>()
  const out: Item[] = []
  for (const n of readers(d, node)) {
    for (const it of scopeOf(d, n)) {
      if (it.kind !== 'document' || it.via === 'mention' || seen.has(it.id)) continue
      seen.add(it.id)
      const doc = d.documents?.[it.id]
      const excerpt = doc?.excerpt?.trim()
      if (!doc || !excerpt) continue
      out.push({
        ctx: { kind: 'document', title: cut(doc.title, 200), text: cut(excerpt, TEXT_MAX) },
        row: { kind: 'document', ref: doc.id, ...(it.linkId ? { link_id: it.linkId } : {}), used_as: USED_AS.document, included: true, text: cut(doc.title, 200) },
      })
    }
  }
  return out
}

/** The input with the project's context added (on the director ops), and a row for each item. Nothing to add, or
 *  another op: the input as it was. */
export function withContext(d: Doc, op: Op, node: LinkEndpoint, input: JobInput): { input: JobInput; rows: JobInputRow[] } {
  if (!CONTEXT_OPS.includes(op) || input.context?.length) return { input, rows: [] }
  const kept: Item[] = []
  let total = 0
  for (const it of [...brandItems(d), ...documentItems(d, node)]) {
    const size = (it.ctx.title?.length ?? 0) + it.ctx.text.length
    if (kept.length >= ITEMS_MAX || total + size > TOTAL_MAX) continue
    kept.push(it)
    total += size
  }
  if (!kept.length) return { input, rows: [] }
  return { input: { ...input, context: kept.map((k) => k.ctx) }, rows: kept.map((k) => k.row) }
}
