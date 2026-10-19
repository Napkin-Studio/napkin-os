// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Harvest (Contract 6 §6): the rules of the "Add to the Brand Clan" panel, as
// pure functions. What is ticked by default is exactly what the host's offer
// says is `selected`; an item the Brand Clan already holds can't be ticked.

import type { ClientAnswerKind, HarvestApplyBody, HarvestOffer, HarvestStatus } from '../../host'

export interface Ticks {
  work: boolean
  /** By the field's `from`. */
  fields: Record<string, boolean>
}

/** Offered after an answer the client gave that is not a rejection. */
export function harvestable(answer: ClientAnswerKind | undefined | null): boolean {
  return answer === 'accepted' || answer === 'accepted_with_changes'
}

/** The ticks the panel opens with: the offer's own `selected`, never a same row. */
export function initialTicks(offer: HarvestOffer): Ticks {
  const fields: Record<string, boolean> = {}
  for (const f of offer.fields) fields[f.from] = f.selected && f.status !== 'same'
  return { work: offer.work.selected && offer.work.status !== 'same', fields }
}

/** Whether a row can be ticked: not when the Brand Clan has it already. */
export const tickable = (status: HarvestStatus) => status !== 'same'

export function anyTicked(t: Ticks): boolean {
  return t.work || Object.values(t.fields).some(Boolean)
}

/** The body of `POST /harvest/apply`: only the ticks and the summary; the host reads nothing else. */
export function applyBody(offer: HarvestOffer, ticks: Ticks, summary: string): HarvestApplyBody {
  const fields = offer.fields.filter(f => tickable(f.status) && ticks.fields[f.from]).map(f => f.from)
  const body: HarvestApplyBody = {}
  if (ticks.work && tickable(offer.work.status)) body.work = true
  if (fields.length) body.fields = fields
  const s = summary.trim()
  if (s && body.work) body.summary = s
  return body
}

/** One row's tag. */
export function statusWords(status: HarvestStatus): string {
  return status === 'new' ? 'New' : status === 'changed' ? 'Changed' : 'Already the Brand Clan’s'
}

/** What a value looks like in a cell: its words, or an envelope's value. */
export function valueText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join('\n')
  if (typeof v === 'object' && 'value' in (v as object)) return valueText((v as { value: unknown }).value)
  return JSON.stringify(v)
}

export const offerButton = (brand: string) => (brand.trim() ? `Add to ${brand.trim()}’s Brand Clan` : 'Add to the Brand Clan')
export const doneLine = (brand: string, published: number) => `${brand} Brand Clan is now v${published}.`
