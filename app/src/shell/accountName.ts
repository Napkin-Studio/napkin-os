// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** `user@agency`, the account name the server records: lower case, trimmed. */
export function accountName(user: string, agency: string): string {
  return `${user.trim()}@${agency.trim()}`.toLowerCase()
}
