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
    const k = needKey(a)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The document's state as the OS bar's slot says it, from the host's lock. */
export interface DocStateWords { label: string; tone: BarTone; locked: boolean }

/**
 * Draft / Ready to lock / Locked / Reopened, from the
 * decision view (DecisionsView.lock). An app's own `clan:bar` status wins over
 * this where it sends one. Null until the view is read, or when it has a problem.
 */
export function docStateOf(view: DecisionsView | null): DocStateWords | null {
  if (!view || view.problem) return null
  const { lock } = view
  if (lock.locked && lock.reopened?.length) return { label: 'Reopened', tone: 'warn', locked: false }
  if (lock.locked) return { label: 'Locked', tone: 'ok', locked: true }
  // What needs a call is counted once, on the Decisions button (owner, 9 Nov
  // 2026: one needs indicator); the pill says only where the document is.
  if (lock.can_lock) return { label: 'Ready to lock', tone: 'ok', locked: false }
  return { label: 'Draft', tone: null, locked: false }
}

/** One need's key: the same place and reason is the same need, across reads. */
export const needKey = (a: AttentionItem): string => `${a.code}:${a.address ?? a.text}`

/**
 * The needs a person has set aside for now, apart from the rest. Setting one
 * aside is the person's own: it leaves the count (and calms the medallion) but
 * still blocks the lock, and comes back with "Bring back" (owner, 9 Nov 2026).
 * A key whose need has gone (settled since) is simply not matched.
 */
export function splitAside(needs: readonly AttentionItem[], aside: ReadonlySet<string>): { open: AttentionItem[]; aside: AttentionItem[] } {
  const open: AttentionItem[] = [], away: AttentionItem[] = []
  for (const n of needs) (aside.has(needKey(n)) ? away : open).push(n)
  return { open, aside: away }
}

/**
 * What "Looks right" records for a need, where one click is a true answer: an
 * agent's finding nobody has checked is verified (`POST /verify`). Everything
 * else that blocks the lock asks for more than a yes (pick one of a contest's
 * values, revise a field that cites a rejected finding, merge a branch, act on
 * a client's answer), so it has no "Looks right": it opens where it is settled.
 */
export function looksRightOf(a: AttentionItem): { finding: string } | null {
  if (a.code !== 'unverified_finding') return null
  const m = /#findings\[([^\]]+)\]$/.exec(a.address ?? '')
  return m ? { finding: m[1] } : null
}
