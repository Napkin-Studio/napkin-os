// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The clients' look, set by an admin per agency (owner, 9 Nov 2026): a
// reviewed config beside the agency registry (palette.ts). Each agency maps
// its clients, by client id or by the slug of the client's name, to a display
// name (which overrides the stored name wherever it shows) and two colours:
// `base` fills the client's disc, `accent` is its monogram's ink. A client
// with no entry takes a colour hashed from its id onto the mock's palette.
// The Brand Clan replaces this later: everything reads it through clientBrand.

import { agencyIdOf } from './palette'

export interface ClientColours { name?: string; base: string; accent: string }

/** Admin-maintained, like the roster: a change here is a reviewed change. Seeded from the approved mock. */
export const CLIENT_REGISTRY: Readonly<Record<string, Readonly<Record<string, ClientColours>>>> = {
  tbwa: {
    'mcdonalds-ireland': { base: '#DA291C', accent: '#FFC72C' },
    'ballymaloe-foods': { base: '#7A1E1E', accent: '#F3D9A4' },
    'diageo-guinness-0-0': { base: '#111111', accent: '#C9A86A' },
    'bord-bia-origin-green': { base: '#1F6B3A', accent: '#CDE8B5' },
  },
  wk: {
    'mcdonalds-ireland': { base: '#DA291C', accent: '#FFC72C' },
    'ballymaloe-foods': { base: '#7A1E1E', accent: '#F3D9A4' },
    'diageo-guinness-0-0': { base: '#111111', accent: '#C9A86A' },
    'bord-bia-origin-green': { base: '#1F6B3A', accent: '#CDE8B5' },
  },
}

/** "McDonald's Ireland" → "mcdonalds-ireland"; "Diageo · Guinness 0.0" → "diageo-guinness-0-0". */
export function slugOf(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

let agency: string | null = null

/** Whose registry applies: the signed-in person's agency (App.tsx sets it with the agency layer). */
export function setClientAgency(personId: string | null | undefined): void {
  agency = agencyIdOf(personId)
}

/** The admin's entry for a client in the current agency, by id, then by its name's slug; null when there is none. */
export function clientBrand(client: { id: string; name: string }, agencyId: string | null = agency): ClientColours | null {
  const reg = agencyId ? CLIENT_REGISTRY[agencyId] : undefined
  if (!reg) return null
  return reg[client.id] ?? reg[slugOf(client.name)] ?? null
}
