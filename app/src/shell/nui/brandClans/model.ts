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
