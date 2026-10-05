// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Which export events are this tab's.
//
// napkin-web's event stream reaches every tab of the tenant, and with accounts
// that is the whole agency. An app's export event names the frame that asked
// (`frame`); a tab acts only on its own, or a bystander tab would claim the
// export and the person who clicked would get nothing (features/pdf-export.clan).
// An event with no `frame` comes from a host that serves one tab (the desktop).

export function isMyExport(payload: { frame?: string } | null | undefined, myFrame: string | null): boolean {
  if (!payload) return false
  return payload.frame === undefined || payload.frame === myFrame
}
