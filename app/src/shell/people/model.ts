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

/** The Napkin admins: napkin-web's PEOPLE_ADMINS (tests/peopleAdmin.test.ts keeps them the same). They manage every agency
 *  and alone add one. */
export const PEOPLE_ADMINS: readonly string[] = ['engineer@napkin']

/** Whether the signed-in person is a Napkin admin. */
export function isPeopleAdmin(user: string | null | undefined): boolean {
  return !!user && PEOPLE_ADMINS.includes(user.trim().toLowerCase())
}

/** Whether the signed-in person may open the People page: a Napkin admin, or an admin of their own agency (the `admin` role,
 *  which the People store holds; features/align-needs-lock-people.clan). The server refuses everyone else with 403 regardless. */
export function canManagePeople(user: string | null | undefined, roles: readonly string[] = []): boolean {
  return isPeopleAdmin(user) || (!!user && roles.includes('admin'))
}

/** The account menu's People entry: for an admin only; undefined hides it. */
export function peopleEntryFor(user: string | null | undefined, open: () => void, roles: readonly string[] = []): (() => void) | undefined {
  return canManagePeople(user, roles) ? open : undefined
}

/** Open the People page from anywhere (the "People" page door, the bar's command): App.tsx listens. */
export const OPEN_PEOPLE_EVENT = 'napkin:open-people'
export function openPeoplePage(): void {
  window.dispatchEvent(new CustomEvent(OPEN_PEOPLE_EVENT))
}

/** The agency part of a sign-in name. */
export const agencyOfUser = (user: string | null | undefined): string => (user ?? '').split('@')[1] ?? ''

/** The roles a person may be given, in the order the People page offers them (roles.rs's table, and `admin`). */
export const ROLE_CHOICES: readonly { id: string; name: string }[] = [
  { id: 'planning', name: 'Planning' },
  { id: 'creative-director', name: 'Creative director' },
  { id: 'account-service', name: 'Account service' },
  { id: 'management', name: 'Management' },
  { id: 'art-director', name: 'Art director' },
  { id: 'copywriter', name: 'Copywriter' },
  { id: 'producer', name: 'Producer' },
  { id: 'agency-brain', name: 'Agency Brain' },
  { id: 'traffic', name: 'Traffic' },
  { id: 'admin', name: 'Admin' },
]

/** A role as it is said: `creative-director` is Creative director. */
export function roleName(id: string): string {
  return ROLE_CHOICES.find(r => r.id === id)?.name ?? id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
}

/** A person's roles in words, `No role` for none. */
export function rolesLine(roles: readonly string[] | undefined): string {
  return roles && roles.length ? roles.map(roleName).join(', ') : 'No role'
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
  /** The roles the People store holds for them (features/align-needs-lock-people.clan). */
  roles?: string[]
  /** For an admin's eyes. */
  email?: string
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
