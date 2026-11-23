// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Reads each exploration's document so its card can say what it holds (territoryCounts.ts has the words).

import { useEffect, useState } from 'react'
import { hasServer, host } from '../../host'
import type { LibraryItem } from '../../host'
import { territoryCount, type TerritoryCount } from './territoryCounts'

/** The count of each exploration among `items`, read once per change. */
export function useTerritoryCounts(items: readonly LibraryItem[]): Record<string, TerritoryCount> {
  const [counts, setCounts] = useState<Record<string, TerritoryCount>>({})
  const key = items.map(i => `${i.path}:${i.updated_at}`).join('|')
  useEffect(() => {
    if (!hasServer || typeof host.docOps !== 'function') return
    let live = true
    for (const i of items) {
      void host.docOps(i.path).then(d => d.data()).then(t => { if (live) setCounts(p => ({ ...p, [i.path]: territoryCount(t) })) }, () => {})
    }
    return () => { live = false }
    // `key` stands for the items: read again only when one changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return counts
}

