// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency this browser last signed in to, so a reload opens in its look
// (brand/bootLook.ts, brand/useAgencyMark.ts), and whether the person just
// signed out, so the sign-in screen (shell/SignIn.tsx) can say "Signed out.".
// The sign-in screen itself always opens in Napkin's look and takes an
// agency's only from what is typed. Per browser only: a convenience, never a
// source of truth. For a basic agency (made on the People page, so not in the
// build's boot table) it also keeps the look as the registry resolved it, so a
// reload does not flash Napkin's look before /api/agency-looks answers.

import { AGENCY_KEY, AGENCY_LOOK_KEY, bootLookOf, type BootLook } from '../../brand/bootLook'
import { AGENCY_COLOURS, agencyIdOf, canonicalAgencyId, coloursOf } from './palette'

const SIGNED_OUT_KEY = 'napkin.signedOut'

function store(kind: 'local' | 'session'): Storage | null {
  try { return typeof window === 'undefined' ? null : kind === 'local' ? window.localStorage : window.sessionStorage } catch { return null }
}

/** Remember the agency of the person signed in (`name@agency`); nothing for an anonymous tenant. */
export function rememberAgency(personId: string | null | undefined): void {
  // An alias is kept as the registry id it means (`b+g` is boysandgirls), so the boot screen finds its look.
  const raw = agencyIdOf(personId)
  const id = canonicalAgencyId(raw) ?? raw
  if (!id) return
  // An agency in code boots in the build's look (it can change only its name on the People page).
  const c = Object.hasOwn(AGENCY_COLOURS, id) ? null : coloursOf(id)
  try {
    const s = store('local')
    s?.setItem(AGENCY_KEY, id)
    if (c) s?.setItem(AGENCY_LOOK_KEY, JSON.stringify({ id, ...bootLookOf(c), base: c.base, accent: c.accent }))
    else s?.removeItem(AGENCY_LOOK_KEY)
  } catch { /* not kept */ }
}

/** What rememberAgency keeps of a basic agency's look: the boot's surface layer and mark colours, and the mark's base and accent. */
export interface KeptLook extends BootLook { base: string; accent: string }

const HEX = /^#[0-9A-Fa-f]{6}$/

/** The look kept for the agency this browser last signed in to, if it is a basic agency's, that agency's, and well formed. */
export function lastAgencyLook(): KeptLook | null {
  try {
    const id = lastAgency()
    if (!id || Object.hasOwn(AGENCY_COLOURS, id)) return null
    const v = JSON.parse(store('local')?.getItem(AGENCY_LOOK_KEY) ?? 'null') as ({ id?: unknown } & Partial<KeptLook>) | null
    if (!v || v.id !== id || typeof v.s !== 'string' || v.s.includes('<') || !Array.isArray(v.m) || !v.m.every(c => typeof c === 'string' && HEX.test(c))) return null
    if (typeof v.base !== 'string' || !HEX.test(v.base) || typeof v.accent !== 'string' || !HEX.test(v.accent)) return null
    return { s: v.s, m: v.m, base: v.base, accent: v.accent }
  } catch { return null }
}

/** The agency id this browser last signed in to, if any. */
export function lastAgency(): string | null {
  try {
    const v = store('local')?.getItem(AGENCY_KEY)?.trim().toLowerCase()
    return v && /^[a-z0-9._-]+$/.test(v) ? v : null
  } catch { return null }
}

/** Mark that the person signed out (for this tab), or clear it once they sign in. */
export function markSignedOut(out: boolean): void {
  try {
    const s = store('session')
    if (out) s?.setItem(SIGNED_OUT_KEY, '1')
    else s?.removeItem(SIGNED_OUT_KEY)
  } catch { /* not kept */ }
}

/** Whether the person signed out in this tab. */
export function justSignedOut(): boolean {
  try { return store('session')?.getItem(SIGNED_OUT_KEY) === '1' } catch { return false }
}
