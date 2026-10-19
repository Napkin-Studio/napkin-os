// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brand Clan chip's states and every sentence the person reads about it,
// as pure functions: the chip, the popover and the harvest panel only draw
// what these say (Contract 6 §4.6, §6). Plain short sentences, no jargon.

import type { AttachedEntry, AttachTarget } from '../../host'

/** The one source app a Brand Clan comes from. */
export const BRAND_APP = 'ie.napkin.brand'

/** Shown wherever naming a brand needs a middleware this build does not have. */
export const NAMING_UNAVAILABLE = 'Making a Brand Clan from a name is not available in this build yet.'

export type ChipKind = 'hidden' | 'empty' | 'set' | 'behind' | 'missing'

export interface ChipInput {
  /** The open document's app's `attach.accepts`; empty or absent attaches nothing. */
  accepts: readonly string[] | undefined
  /** `GET /upstream`'s `attached[]` (absent from an older host). */
  attached: readonly AttachedEntry[] | undefined
  /** The document is locked: nothing about its Brand Clan may change. */
  locked: boolean
}

export interface ChipState {
  kind: ChipKind
  /** The chip's own words. */
  label: string
  /** The brand's name, when one is attached ("" when none). */
  brand: string
  /** The Brand Clan's version as the document holds it ("v5"), or "". */
  version: string
  /** The newer version in the Brand Clan ("v6"), when behind. */
  versionNow: string
  /** The attached one. */
  entry: AttachedEntry | null
  /** Read-only: the document is locked. */
  readOnly: boolean
  /** The tooltip and what a screen reader hears. */
  title: string
}

const v = (n: number | null | undefined) => (typeof n === 'number' ? `v${n}` : '')

/** The attached Brand Clan among the document's attached records, when the app takes one. */
export function brandEntry(accepts: readonly string[] | undefined, attached: readonly AttachedEntry[] | undefined): AttachedEntry | null {
  if (!accepts?.length) return null
  return (attached ?? []).find(a => accepts.includes(a.app_id)) ?? null
}

/** What the chip shows, from what the host said. Every state, one function. */
export function chipState({ accepts, attached, locked }: ChipInput): ChipState {
  const base: ChipState = { kind: 'hidden', label: '', brand: '', version: '', versionNow: '', entry: null, readOnly: locked, title: '' }
  if (!accepts?.length) return base
  const entry = brandEntry(accepts, attached)
  const lockedWords = locked ? ' This document is locked, so its Brand Clan can’t change.' : ''
  if (!entry) {
    return { ...base, kind: 'empty', label: 'Set the Brand Clan', title: `No Brand Clan is set for this document.${lockedWords}` }
  }
  const brand = entry.title?.trim() || 'The Brand Clan'
  const version = v(entry.version)
  if (entry.status === 'unknown' || entry.in_store === false) {
    return {
      ...base, kind: 'missing', entry, brand, version,
      label: `${brand} · not found`,
      title: `${brand} isn’t in your studio any more. Its copy in this document is kept.${lockedWords}`,
    }
  }
  if (entry.status === 'changed') {
    const now = v(entry.version_now)
    return {
      ...base, kind: 'behind', entry, brand, version, versionNow: now,
      label: now ? `${now} in the Brand Clan · Update` : 'Newer in the Brand Clan · Update',
      title: `${brand} ${version || ''}: ${now ? `${now} is in the Brand Clan` : 'the Brand Clan has changed'}.${lockedWords}`.replace('  ', ' '),
    }
  }
  return {
    ...base, kind: 'set', entry, brand, version,
    label: version ? `${brand} · ${version}` : brand,
    title: `The Brand Clan for this document: ${brand}${version ? `, ${version}` : ''}.${lockedWords}`,
  }
}

/** A refusal in the host's own words; a plain line when it gave none. */
export function errorWords(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e ?? '')).trim()
  if (!raw) return 'That didn’t work. Try again.'
  if (/no middleware is configured/i.test(raw)) return NAMING_UNAVAILABLE
  return raw
}

/** "Lumen Water" ↔ "lumen   water": how a typed name is compared with a title. */
export const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

/** The Brand Clans a typed name finds: any whose title holds the words. All of them when nothing is typed. */
export function findTargets(targets: readonly AttachTarget[], query: string): AttachTarget[] {
  const q = query.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!q) return [...targets]
  return targets.filter(t => t.title.toLowerCase().includes(q))
}

/** "Make a Brand Clan for X" is offered only for a name the agency has no Brand Clan for. */
export function canOfferMake(targets: readonly AttachTarget[], query: string): boolean {
  const q = query.trim()
  return q.length > 0 && !targets.some(t => same(t.title, q))
}

export const detachSentence = (brand: string) =>
  `Detach ${brand}? Its pins stay in this document; the copy and the fields it filled in go.`

/** A field's address as a person reads it: "tone_and_world" is "tone and world". */
export function fieldWords(address: string, labels?: Readonly<Record<string, string>>): string {
  const known = labels?.[address]
  if (known) return known
  return address.replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean).map(s => s.replace(/_/g, ' ')).join(' ') || address
}

/** What an Update left alone: "Kept your wording in: client, tone and world." Empty when nothing was kept. */
export function keptWords(kept: readonly string[] | undefined): string {
  const names = [...new Set((kept ?? []).map(k => fieldWords(k.replace(/\.value$/, ''))))]
  return names.length ? `Kept your wording in: ${names.join(', ')}.` : ''
}

/** The sentence after an attach, update or replace. */
export function doneWords(verb: 'attached' | 'updated' | 'replaced' | string, brand: string, kept: readonly string[] | undefined): string {
  const head = verb === 'updated' ? `${brand} is up to date.` : verb === 'replaced' ? `${brand} is now this document’s Brand Clan.` : `${brand} is now this document’s Brand Clan.`
  const k = keptWords(kept)
  return k ? `${head} ${k}` : head
}
