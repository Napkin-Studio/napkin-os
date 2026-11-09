// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A research's lens dots on its tool-home card (mock phase 2, "Tool homes"):
// one filled dot per lens it ran, one dashed dot per lens it skipped, read
// from the document's own selection (lenses_run, lenses_skipped).

import { useEffect, useState } from 'react'
import { hasServer, host } from '../../host'
import type { LibraryItem } from '../../host'

export type Cov = 'filled' | 'thin' | 'empty' | 'none'

/** The lens dots in a research's data (YAML or JSON text): run lenses filled, skipped ones dashed. */
export function lensDots(text: string): Cov[] {
  const block = (key: string): string[] => {
    const m = new RegExp(`(^|\\n)(\\s*)"?${key}"?\\s*:\\s*\\n?([\\s\\S]*?)(?=\\n\\2[A-Za-z_"]+\\s*:|$)`).exec(text)
    if (!m) return []
    return [...m[3].matchAll(/"?lens"?\s*:\s*"?([A-Za-z_]+)"?/g)].map(x => x[1])
  }
  const run = [...new Set(block('lenses_run'))]
  const skipped = [...new Set(block('lenses_skipped'))].filter(l => !run.includes(l))
  return [...run.map(() => 'filled' as const), ...skipped.map(() => 'none' as const)]
}

/** The lens dots of each research among `items`, read once per change. */
export function useLensDots(items: readonly LibraryItem[]): Record<string, Cov[]> {
  const [dots, setDots] = useState<Record<string, Cov[]>>({})
  const key = items.map(i => `${i.path}:${i.updated_at}`).join('|')
  useEffect(() => {
    if (!hasServer || typeof host.docOps !== 'function') return
    let live = true
    for (const i of items) {
      void host.docOps(i.path).then(d => d.data()).then(t => { if (live) setDots(p => ({ ...p, [i.path]: lensDots(t) })) }, () => {})
    }
    return () => { live = false }
    // `key` stands for the items: read again only when one changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return dots
}
