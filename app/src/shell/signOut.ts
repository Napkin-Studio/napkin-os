// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Sign out of the studio (napkin-web clears the session cookie), then start over at sign-in. */
export async function signOut() {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  location.reload()
}
