// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brand Clan section's pure parts (docs/contracts/brand-clan.md): the
// edits a person makes to a Brand Bible in place, how the host's changes mark
// the draft, and the words the section uses for people, times and versions.
// Nothing here calls the host.

import type { BrandBible, BrandChange, BrandClanData, BrandColour, BrandExample, BrandFace, BrandHistoryEntry, BrandLogo, BrandRule } from '../../../host/types'

/** The candidate a person edits: the published bible, without `kit`. */
export function bibleOf(data: BrandClanData | BrandBible): BrandBible {
  const { kit: _kit, ...rest } = data as BrandClanData
  return structuredClone(rest) as BrandBible
}

/** A key for a new list item that no other item holds: `mint`, `mint-2`. */
export function newId(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'item'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

const edit = <T,>(c: BrandBible, f: (n: BrandBible) => T): BrandBible => { const n = structuredClone(c); f(n); return n }

export const setName = (c: BrandBible, name: string) => edit(c, n => { n.name = name })
export const setNote = (c: BrandBible, note: string) => edit(c, n => { n.note = note })
export const setLogoNote = (c: BrandBible, text: string) => edit(c, n => { (n.visual ??= {}).logo_note = text })
export const setTone = (c: BrandBible, text: string) => edit(c, n => { (n.voice ??= {}).tone = text })
export const setImageryStyle = (c: BrandBible, text: string) => edit(c, n => { (n.imagery ??= {}).style = text })
export const setBans = (c: BrandBible, bans: string[]) => edit(c, n => { (n.imagery ??= {}).bans = bans })

export const colours = (c: BrandBible): BrandColour[] => c.visual?.colours ?? []
export const faces = (c: BrandBible): BrandFace[] => c.visual?.typography ?? []
export const logos = (c: BrandBible): BrandLogo[] => c.visual?.logos ?? []
export const rules = (c: BrandBible): BrandRule[] => c.voice?.rules ?? []
export const examples = (c: BrandBible): BrandExample[] => c.imagery?.examples ?? []

export function setColour(c: BrandBible, id: string, patch: Partial<BrandColour>) {
  return edit(c, n => { n.visual!.colours = colours(n).map(x => (x.id === id ? { ...x, ...patch, id } : x)) })
}
export function addColour(c: BrandBible, name = 'New colour', hex = '#888888') {
  return edit(c, n => { (n.visual ??= {}).colours = [...colours(n), { id: newId(name, colours(n).map(x => x.id)), name, hex, role: 'other' }] })
}
export function removeColour(c: BrandBible, id: string) {
  return edit(c, n => { n.visual!.colours = colours(n).filter(x => x.id !== id) })
}
export function setFace(c: BrandBible, id: string, patch: Partial<BrandFace>) {
  return edit(c, n => { n.visual!.typography = faces(n).map(x => (x.id === id ? { ...x, ...patch, id } : x)) })
}
export function addFace(c: BrandBible, family = 'New typeface') {
  return edit(c, n => { (n.visual ??= {}).typography = [...faces(n), { id: newId(family, faces(n).map(x => x.id)), family, role: 'other' }] })
}
export function removeFace(c: BrandBible, id: string) {
  return edit(c, n => { n.visual!.typography = faces(n).filter(x => x.id !== id) })
}
export function setRule(c: BrandBible, id: string, text: string) {
  return edit(c, n => { n.voice!.rules = rules(n).map(x => (x.id === id ? { ...x, text } : x)) })
}
export function addRule(c: BrandBible, text = 'New rule') {
  return edit(c, n => { (n.voice ??= {}).rules = [...rules(n), { id: newId(text, rules(n).map(x => x.id)), text, kind: 'do' }] })
}
export function removeRule(c: BrandBible, id: string) {
  return edit(c, n => { n.voice!.rules = rules(n).filter(x => x.id !== id) })
}
/** Replace a logo's picture, or add a logo (`id` absent) holding `asset`. */
export function putLogo(c: BrandBible, asset: string, label: string, id?: string) {
  return edit(c, n => {
    const v = (n.visual ??= {})
    const list = logos(n)
    if (id) { v.logos = list.map(x => (x.id === id ? { ...x, asset } : x)); return }
    v.logos = [...list, { id: newId(label, list.map(x => x.id)), label, variant: 'other', asset }]
  })
}
export function addExample(c: BrandBible, asset: string) {
  return edit(c, n => { (n.imagery ??= {}).examples = [...examples(n), { id: newId('example', examples(n).map(x => x.id)), asset }] })
}
export function removeExample(c: BrandBible, id: string) {
  return edit(c, n => { n.imagery!.examples = examples(n).filter(x => x.id !== id) })
}

/** The file name of an asset path (`human/assets/<name>`). */
export const assetName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

// ── Marks on a draft ──────────────────────────────────────────────────────────

/** `colour:mint` → 'changed' | 'new' | 'removed', for the little marks beside a draft's items. */
export function marks(changes: readonly Pick<BrandChange, 'id' | 'kind'>[]): ReadonlyMap<string, 'changed' | 'new' | 'removed'> {
  return new Map(changes.map(c => [c.id, c.kind === 'added' ? 'new' : c.kind === 'removed' ? 'removed' : 'changed'] as const))
}

// ── Words ─────────────────────────────────────────────────────────────────────

/** `human:aoife@javelin` → "Aoife"; a process is "Napkin". */
export function who(actor: string | null | undefined): string {
  if (!actor) return 'Someone'
  if (actor.startsWith('process:')) return 'Napkin'
  const name = actor.replace(/^human:/, '').split('@')[0].replace(/[._-]+/g, ' ').trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Someone'
}

/** "just now", "5m ago", "3h ago", "12 Nov": the mock's way. */
export function when(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The area a change belongs to, as the review and the confirm name it. */
export const AREA_WORD: Record<string, string> = {
  name: 'Name', note: 'Note', logo: 'Logo', logo_note: 'Logo', colour: 'Colour', typography: 'Typography', tone: 'Tone',
  rule: 'Rule', imagery_style: 'Imagery', imagery_ban: 'Imagery', example: 'Imagery', source: 'Source',
}

/** A change as the publish confirm lists it: its area word in bold, unless its text already starts with it ("Logo Wordmark added",
 *  "Colour Copper #B8733A added", "Imagery ban added: …" name their area; "Silver #9AA7B1 becomes #A0ADB6" does not). A34. */
export function changeLine(ch: Pick<BrandChange, 'area' | 'text'>): { area: string | null; text: string } {
  const area = AREA_WORD[ch.area] ?? ch.area
  const first = ch.text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const says = first === area.toLowerCase() || (area === 'Typography' && first === 'typeface')
  return { area: says ? null : area, text: ch.text }
}

/** What the Update chip's list shows: the changes of every published version after the one a work document holds. */
export function changesSince(history: readonly BrandHistoryEntry[], held: number): { version: number; summary: string; changes: BrandChange[] }[] {
  return history
    .filter(h => h.state === 'published' && h.version > held)
    .sort((a, b) => a.version - b.version)
    .map(h => ({ version: h.version, summary: h.summary, changes: h.changes }))
}

/** Which version a source file arrived with (the first published entry that names it). */
export function sourceVersion(data: BrandClanData): number {
  const file = data.source?.file
  return data.kit.changelog?.find(e => e.from?.file === file)?.version ?? 1
}

// ── Competitors found by research (Brand Clan phase 2; owner 2026-11-24: "Research can discover players in the same category
// right? And update the brand clan accordingly") ─────────────────────────────────────────────────────────────────────────────

/** What one Research document found: the category's players it proposed (campaign.competitor_set, origin proposed). */
export interface ResearchFound {
  document_id: string
  title: string
  items: { id: string; name: string; fact_ids: string[] }[]
}

/** The players a research document proposed, not yet in the Brand Clan (by name). Empty: nothing new to offer. */
export function researchFound(doc: { document_id: string; title: string; data: unknown }, bible: BrandBible | null): ResearchFound | null {
  const d = doc.data as { campaign?: { competitor_set?: { origin?: string; value?: { ref?: string; name?: string }[]; item_provenance?: Record<string, { fact_ids?: string[] }> } } } | null
  const cs = d?.campaign?.competitor_set
  if (!cs || cs.origin !== 'proposed' || !Array.isArray(cs.value)) return null
  const have = new Set((bible?.competitors ?? []).map(c => c.name.trim().toLowerCase()))
  const items = cs.value
    .filter((v): v is { ref?: string; name: string } => !!v && typeof v.name === 'string' && !!v.name.trim())
    .filter(v => !have.has(v.name.trim().toLowerCase()))
    .map(v => ({ id: (v.ref ?? v.name).replace(/^brand\//, ''), name: v.name.trim(), fact_ids: (v.ref && cs.item_provenance?.[v.ref]?.fact_ids) || [] }))
  return items.length ? { document_id: doc.document_id, title: doc.title, items } : null
}

/** The bible with these found players added (a new list item each, keyed clear of the others). */
export function withCompetitors(bible: BrandBible, found: ResearchFound): BrandBible {
  const out = structuredClone(bible)
  const list = out.competitors ?? []
  for (const it of found.items) {
    if (list.some(c => c.name.trim().toLowerCase() === it.name.toLowerCase())) continue
    list.push({ id: newId(it.id || it.name, list.map(c => c.id)), name: it.name, from: { kind: 'research', document_id: found.document_id, title: found.title, ...(it.fact_ids.length ? { fact_ids: it.fact_ids.slice(0, 24) } : {}) } })
  }
  out.competitors = list
  return out
}
