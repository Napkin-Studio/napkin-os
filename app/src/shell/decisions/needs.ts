// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the decision view says needs a person, and the document's state in
// words, worked out once for the whole shell. Pure: no host, no React.

import type { AttentionItem, DecisionsView } from '../../host/types'
import type { BarTone } from '../appBar'

/**
 * What blocks the lock, one item per place. The one needs-your-call selector: the Decisions drawer lists these, the OS
 * bar counts them and the medallion lights on them. Never worked out twice.
 */
export function needsOf(view: DecisionsView | null): AttentionItem[] {
  if (!view) return []
  const seen = new Set<string>()
  return view.attention.filter(a => {
    if (!a.blocks_lock) return false
    const k = `${a.code}:${a.address ?? a.text}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The document's state as the OS bar's slot says it, from the host's lock. */
export interface DocStateWords { label: string; tone: BarTone; locked: boolean }

/**
 * Draft / Needs you (n) / Ready to lock / Locked / Reopened, from the
 * decision view (DecisionsView.lock). An app's own `clan:bar` status wins over
 * this where it sends one. Null until the view is read, or when it has a problem.
 */
export function docStateOf(view: DecisionsView | null): DocStateWords | null {
  if (!view || view.problem) return null
  const { lock } = view
  if (lock.locked && lock.reopened?.length) return { label: 'Reopened', tone: 'warn', locked: false }
  if (lock.locked) return { label: 'Locked', tone: 'ok', locked: true }
  const n = needsOf(view).length
  if (n) return { label: `Needs you (${n})`, tone: 'warn', locked: false }
  if (lock.can_lock) return { label: 'Ready to lock', tone: 'ok', locked: false }
  return { label: 'Draft', tone: null, locked: false }
}
