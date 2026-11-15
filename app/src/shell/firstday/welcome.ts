// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The sign-in name an invite's link carries (`/?welcome=name@agency`). The link names a person and grants nothing:
// it only starts the sign-in form's name field. Who the person is and what they may do comes from the People store at
// sign-in, as for anyone.

/** The sign-in name in `search` (`?welcome=...`), lower case, or '' when there is none or it is not one. */
export function welcomeName(search: string): string {
  const raw = (() => { try { return new URLSearchParams(search).get('welcome') } catch { return null } })()
  const name = (raw ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9-]*$/.test(name) && name.length <= 120 ? name : ''
}
