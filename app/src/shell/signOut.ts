// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { markSignedOut } from './agency/lastAgency'

/** Sign out of the studio (napkin-web clears the session cookie), then start over at sign-in. */
export async function signOut() {
  // The sign-in screen then says "Signed out.", in Napkin's look until they type (agency/lastAgency.ts).
  markSignedOut(true)
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  // The open document and the place in the studio were this person's: the
  // next person to sign in starts at their own home (shell/lastOpen.ts).
  const params = new URLSearchParams(location.search)
  params.delete('open')
  const q = params.toString()
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''))
  location.reload()
}
