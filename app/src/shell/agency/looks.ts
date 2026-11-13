// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The published looks from the People page (features/people-admin.clan,
// agency-looks-admin.clan): basic agencies with their look and wordmark, and
// agencies in code with a published display name. Read from napkin-web once at
// start (`GET /api/agency-looks`, public, never drafts) and taken into the look
// registry (palette.ts registerAgencyLooks), so the sign-in card and the studio
// wear them. A server without them, or none at all (the desktop, offline),
// leaves the code registry as it is.

import { registerAgencyLooks, type AgencyLook } from './palette'

/** Read the published looks and register them; never throws. */
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
  // palette.ts registerAgencyLooks checks each field: a code id takes only its name, a basic one needs a name and two colours
  const l = v as AgencyLook
  return !!l && typeof l === 'object' && typeof l.id === 'string'
}
