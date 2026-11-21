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

// ── Which brand a job reads (UAT round 3 R3-2: every brand ref went on every op, and "use only these colours" turned
// a midday photo into a navy night with a flat coral sun) ──────────────────────────────────────────────────────────
//
// - A brand rule (do, don't, tone) goes with every op that reads the look: it is the client's rule wherever it is.
// - The palette and the type go only with brand work: a Brand board linked into the node (or into a note it reads), a
//   brief in its scope, a product, logo or brand picture in the job, or the person's words naming brand work (an ad, a
//   poster, a product, a logo). The palette goes as accents unless the person says strict.
// - An edit of a picture (a Fill, a Change this frame) reads no brand unless it is brand work.
// The Generate tray lists each item with its tick (BrandChoice), so a person can leave one out or put one in.

/** The person's call on the brand for one job (the Generate tray's ticks). */
export interface BrandChoice {
  /** Brand refs the person left out of this job. */
  leave?: readonly Id[]
  /** Brand refs the person put in although the op would leave them out. */
  add?: readonly Id[]
  /** The palette is the only colours ("Strict:"), not accents. */
  strict?: boolean
  /** The job is brand work for a reason the document alone cannot see (a selected note a Brand board links into). */
  work?: boolean
}

/** The ops that are edits of a picture: no brand unless the job is brand work. */
const EDIT_OPS: readonly Op[] = ['region_edit', 'frame_edit']
/** Words that make a job brand work. */
const BRAND_WORDS = /\b(brand(?:ed|ing)?|logos?|products?|pack(?:shot|aging|age)?s?|adverts?|advertising|ads?|posters?|billboards?|banners?|campaign|key ?visual|labels?|flyers?|hoardings?|mock-?ups?|social posts?)\b/i
const BRAND_REF_ROLES: readonly string[] = ['product', 'logo', 'palette', 'typography', 'brand_rule']

/** Is a Brand board linked into the node (or what it reads: its storyboard and films for a shot, a note it reads)? */
export function brandLinked(d: Doc, node: LinkEndpoint): boolean {
  const links = Object.values(d.links ?? {})
  const nodes = new Set(readers(d, node))
  // The texts these nodes read: a brand board linked into one of them means "use this brand" too.
  for (const l of links) if (nodes.has(l.to.id) && (['text', 'note', 'ink'] as string[]).includes(l.from.kind)) nodes.add(l.from.id)
  return links.some((l) => l.role === 'brand' && nodes.has(l.to.id))
}

/**
 * Is this job brand work, so the palette and the type go with it? A brief is another client's work unless a Brand board
 * is linked to it (UAT round 4 S2-6: the Quietboil brief took the Harbour palette and type, the project's only brand):
 * with a brief and no linked Brand board, nothing of the project's brand goes unless the person ticks it.
 */
export function brandWork(d: Doc, node: LinkEndpoint, input: Pick<JobInput, 'text' | 'brief' | 'refs'>): boolean {
  if (input.brief) return brandLinked(d, node)
  if (input.text && BRAND_WORDS.test(input.text)) return true
  if ((input.refs ?? []).some((r) => BRAND_REF_ROLES.includes(r.role))) return true
  return brandLinked(d, node)
}

export interface BrandRow {
  ref: Id
  kind: 'brand_rule' | 'palette' | 'typography'
  /** "@harbour_palette", or the ref's own label. */
  label: string
  /** "Navy #0A1F44, Sand #E8DCC4". */
  text: string
  /** Whether it goes with this job, after the person's ticks. */
  on: boolean
  /** Whether it would go without a tick. */
  byDefault: boolean
}

/** The project's brand refs as one job reads them: rules first, each with whether it goes (the tray's rows). */
export function brandRows(d: Doc, op: Op, node: LinkEndpoint, input: Pick<JobInput, 'text' | 'brief' | 'refs'>, choice: BrandChoice = {}): BrandRow[] {
  if (!CONTEXT_OPS.includes(op)) return []
  const order: BrandRow['kind'][] = ['brand_rule', 'palette', 'typography']
  const work = !!choice.work || brandWork(d, node, input)
  // A brief with no Brand board linked: none of the project's brand by default, not even its rules (they are another
  // client's); the tray's ticks still put one in (S2-6).
  const foreign = !!input.brief && !work
  const rows: BrandRow[] = []
  for (const r of refsList(d)) {
    const w = brandWords(r)
    if (!w || w.kind === 'note' || w.kind === 'document') continue
    const kind = w.kind as BrandRow['kind']
    const byDefault = foreign ? false : EDIT_OPS.includes(op) ? work : kind === 'brand_rule' || work
    const on = choice.add?.includes(r.id) ? true : choice.leave?.includes(r.id) ? false : byDefault
    rows.push({ ref: r.id, kind, label: r.label?.trim() || `@${refName(r)}`, text: w.text, on, byDefault })
  }
  return rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

/** The brand items a job sends: rules first; a palette says whether it is accents or strict. */
function brandItems(d: Doc, op: Op, node: LinkEndpoint, input: JobInput, choice: BrandChoice = {}): Item[] {
  return brandRows(d, op, node, input, choice).filter((b) => b.on).map((b) => {
    const title = cut(b.label, 200)
    const text = cut(b.kind === 'palette' ? `${choice.strict ? 'Strict' : 'Accents'}: ${b.text}` : b.text, TEXT_MAX)
    return { ctx: { kind: b.kind, title, text }, row: { kind: 'brand', ref: b.ref, used_as: USED_AS[b.kind], included: true, text: cut(text, 200) } }
  })
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
export function withContext(d: Doc, op: Op, node: LinkEndpoint, input: JobInput, choice?: BrandChoice): { input: JobInput; rows: JobInputRow[] } {
  if (!CONTEXT_OPS.includes(op) || input.context?.length) return { input, rows: [] }
  const kept: Item[] = []
  let total = 0
  for (const it of [...brandItems(d, op, node, input, choice), ...documentItems(d, node)]) {
    const size = (it.ctx.title?.length ?? 0) + it.ctx.text.length
    if (kept.length >= ITEMS_MAX || total + size > TOTAL_MAX) continue
    kept.push(it)
    total += size
  }
  if (!kept.length) return { input, rows: [] }
  return { input: { ...input, context: kept.map((k) => k.ctx) }, rows: kept.map((k) => k.row) }
}
