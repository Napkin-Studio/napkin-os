// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the desk's Decisions drawer lists (DeskDecisions.tsx): pure, so a test
// can read it with no DOM. The same items the bar's count counts.

import type { LibraryItem } from '../../host'
import { needsYou } from '../landing/model'

/** The documents that need a call, by client (no client last), newest first within each. */
export function deskCalls(items: readonly LibraryItem[]): { client: string; items: LibraryItem[] }[] {
  const by = new Map<string, LibraryItem[]>()
  for (const it of items) {
    if (!needsYou(it)) continue
    const k = it.client?.name ?? ''
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(it)
  }
  return [...by.entries()]
    .map(([client, list]) => ({ client, items: [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }))
    .sort((a, b) => (a.client === '' ? 1 : b.client === '' ? -1 : a.client.localeCompare(b.client)))
}

