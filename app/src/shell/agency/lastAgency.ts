// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency this browser last signed in to, so a reload opens in its look
// (brand/bootLook.ts, brand/useAgencyMark.ts), and whether the person just
// signed out, so the sign-in screen (shell/SignIn.tsx) can say "Signed out.".
// The sign-in screen itself always opens in Napkin's look and takes an
// agency's only from what is typed. Per browser only: a convenience, never a
// source of truth.

import { agencyIdOf, canonicalAgencyId } from './palette'

const AGENCY_KEY = 'napkin.lastAgency'
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
  try { store('local')?.setItem(AGENCY_KEY, id) } catch { /* not kept */ }
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
