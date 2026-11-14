// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The People page's rules, pure (features/people-admin.clan): who may open it,
// how an agency is recognised from what is typed, the sign-in name made from a
// name and an agency, a new agency's look, and the page's own look (Napkin's,
// whatever agency is signed in). The server (crates/napkin-web/src/people.rs)
// decides; these say the same thing on the page as someone types.

import {
  NAPKIN_COLOURS, agencyCss, canonicalAgencyId, coloursOf, paletteOf, pillOf, surfaceCss,
  type AgencyColours,
} from '../agency/palette'
import type { AgencyAdminRow } from './agencies/model'

/** Who may open the People page: napkin-web's PEOPLE_ADMINS (tests/peopleAdmin.test.ts keeps them the same). */
export const PEOPLE_ADMINS: readonly string[] = ['engineer@napkin']

/** Whether the signed-in person may manage people. The server refuses everyone else with 403 regardless. */
export function isPeopleAdmin(user: string | null | undefined): boolean {
  return !!user && PEOPLE_ADMINS.includes(user.trim().toLowerCase())
}

/** The account menu's People entry: for an admin only; undefined hides it. */
export function peopleEntryFor(user: string | null | undefined, open: () => void): (() => void) | undefined {
  return isPeopleAdmin(user) ? open : undefined
}

/** A person as the server lists them. */
export interface PersonRow {
  id: string
  name?: string
  agency: string
  admin: boolean
  added_by: string
  added_at: string
  removed_at?: string
}

/** An agency as the server lists it (agencies/model.ts AgencyAdminRow): in code or basic, with how many people are in it. */
export type AgencyRow = AgencyAdminRow

/** The agency id `text` means: an id, a name or an alias (any case), of the listed agencies or the look registry. */
export function recogniseAgency(text: string, agencies: readonly AgencyRow[]): string | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const hit = agencies.find(a => a.id === t || a.name.toLowerCase() === t || a.aliases.some(x => x.toLowerCase() === t))
  return hit?.id ?? canonicalAgencyId(t)
}

/** An agency id made from a name, as the server makes it: lower case, `+` and `&` read as "and", only letters and digits. */
export function agencySlug(name: string): string {
  return name.trim().toLowerCase().replace(/[+&]/g, 'and').replace(/[^a-z0-9]/g, '').slice(0, 40)
}

/** The user part made from a person's name: their first name, lower case. */
export function firstNameUser(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '')
}

/** The sign-in name made from a name and an agency id: `firstname@agency`. */
export function signInNameOf(name: string, agencyId: string | null): string {
  return `${firstNameUser(name) || 'name'}@${agencyId || 'agency'}`
}

/** What typing `name@agency` in the sign-in name sets the Agency field to: the agency's name when known, else what was typed. */
export function agencyFieldFromSignInName(typed: string, agencies: readonly AgencyRow[]): string | null {
  const at = typed.indexOf('@')
  if (at < 0) return null
  const part = typed.slice(at + 1).trim()
  if (!part) return null
  const id = recogniseAgency(part, agencies)
  if (!id) return part
  return agencies.find(a => a.id === id)?.name ?? coloursOf(id)?.name ?? part
}

/** The colours an agency id wears on the page: the listed ones, else the look registry's. */
export function agencyColours(id: string, agencies: readonly AgencyRow[]): AgencyColours | null {
  return coloursOf(id) ?? (() => {
    const a = agencies.find(x => x.id === id)
    return a?.kind === 'basic' ? { name: a.name, base: a.base, accent: a.accent } : null
  })()
}

/** A new agency's look from its name and two colours; every other token is derived as for any agency (paletteOf). */
export function newAgencyLook(name: string, base: string, accent: string): AgencyColours {
  return { name: name.trim() || 'New agency', base: base.toUpperCase(), accent: accent.toUpperCase() }
}

/** The pill an agency's look draws (its ground, ink and rim), for the recognised-agency card. */
export function pillStyle(c: AgencyColours): { background: string; color: string; boxShadow?: string } {
  const p = pillOf(c)
  return { background: p.bg, color: p.ink, ...(p.line ? { boxShadow: `inset 0 0 0 1.5px ${p.line}` } : {}) }
}

/** The page's selector: its look applies inside it alone. */
export const PAGE_CLASS = 'pa-page'

/**
 * The page's own look: Napkin's palette (base #515BFF, accent #C8CBFF) through
 * the same code as any agency (surfaceCss, paletteOf), scoped to the page, so
 * it is never the signed-in agency's look (owner, 2026-11-12).
 */
export function napkinPageCss(selector = `.${PAGE_CLASS}`): string {
  const scope = (css: string) => css
    .replaceAll(":root, :root[data-theme='light']", selector)
    .replaceAll(":root[data-theme='dark']", `:root[data-theme='dark'] ${selector}`)
  return `${scope(surfaceCss(NAPKIN_COLOURS))}\n${scope(agencyCss(paletteOf(NAPKIN_COLOURS)))}`
}

/** "2026-10-05 · roster", "just now · by engineer@napkin". */
export function addedLine(p: PersonRow, justNow = false): string {
  if (justNow) return `just now · by ${p.added_by}`
  const day = p.added_at.slice(0, 10)
  return `${day} · ${p.added_by === 'roster' ? 'roster' : `by ${p.added_by}`}`
}

/** The people a search finds: by name, sign-in name or agency (its id or name). */
export function findPeople(people: readonly PersonRow[], q: string, agencies: readonly AgencyRow[]): PersonRow[] {
  const t = q.trim().toLowerCase()
  const live = people.filter(p => !p.removed_at)
  if (!t) return live
  return live.filter(p => {
    const ag = agencies.find(a => a.id === p.agency)?.name.toLowerCase() ?? ''
    return (p.name ?? '').toLowerCase().includes(t) || p.id.includes(t) || p.agency.includes(t) || ag.includes(t)
  })
}
