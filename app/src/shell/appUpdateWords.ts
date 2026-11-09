// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the newer-app notice on a locked document says (AppUpdateNotice).

import type { AppUpdate } from '../host'

export interface AppUpdateWords {
  /** "A newer Brief Maker is available" */
  lead: string
  /** "0.10.0, you have 0.9.5" */
  hint: string
  /** Why it cannot be taken, when the document's data does not fit; no Update then. */
  blocked: string | null
}

/** What the notice says, or null when there is nothing to say: no newer app, or the document is not locked. */
export function appUpdateWords(update: AppUpdate | null | undefined, locked: boolean, noun: string): AppUpdateWords | null {
  if (!update?.available || !locked) return null
  const blocked = update.blocked?.length
    ? `This ${update.name} can’t take this ${noun}’s data as it stands: ${update.blocked.join(', ')}`
    : null
  return {
    lead: `A newer ${update.name} is available`,
    hint: `${update.to.version}, you have ${update.from.version}`,
    blocked,
  }
}
