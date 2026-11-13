// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agencies added from the People page (features/people-admin.clan), read
// from napkin-web once at start (`GET /api/agency-looks`, public) and taken
// into the look registry (palette.ts registerAgencyLooks), so the sign-in card
// and the studio wear a new agency's look. A server without them, or none at
// all (the desktop, offline), leaves the code registry as it is.

import { registerAgencyLooks, type AgencyLook } from './palette'

/** Read the added agencies' looks and register them; never throws. */
export async function loadAgencyLooks(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const r = await fetcher('/api/agency-looks', { credentials: 'same-origin' })
    if (!r.ok) return
    const looks = (await r.json()) as unknown
    if (Array.isArray(looks)) registerAgencyLooks(looks.filter(isLook))
  } catch {
    // no server, or offline: the code registry stands
  }
}

function isLook(v: unknown): v is AgencyLook {
  const l = v as AgencyLook
  return !!l && typeof l.id === 'string' && typeof l.name === 'string' && typeof l.base === 'string' && typeof l.accent === 'string'
}
