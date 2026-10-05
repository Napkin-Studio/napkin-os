// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** `name@agency` as the server records it: trimmed, lower case. */
export function accountName(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Shaped like `name@agency`: something on both sides of one `@`. The server
 * still decides (Account::parse_username); this only catches a missing half. */
export function isAccountName(raw: string): boolean {
  const parts = accountName(raw).split('@')
  return parts.length === 2 && parts[0] !== '' && parts[1] !== ''
}
