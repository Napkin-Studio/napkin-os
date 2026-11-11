// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** `/c/<token>`: the token, or null when this is not a client link. */
export function linkToken(pathname: string = window.location.pathname): string | null {
  const m = /^\/c\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/?$/.exec(pathname)
  return m ? m[1] : null
}
