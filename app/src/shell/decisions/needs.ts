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
export function needsOf(view: DecisionsView | null): Need[] {
  if (!view) return []
  const seen = new Set<string>()
  const by = new Map(view.decisions.map(b => [b.decision.id, b.who.kind] as const))
  return view.attention.filter(a => {
    if (!a.blocks_lock) return false
    const k = needKey(a)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).map(a => {
    const kind = a.decision ? by.get(a.decision) : undefined
    return kind ? { ...a, by: kind } : a
  })
}

/** The notices on a document: items of its alerts (a brief changed, a client's change, an approval late) that wait on a person and block nothing. */
export function noticesOf(view: DecisionsView | null): Need[] {
  if (!view) return []
  const seen = new Set<string>()
  return view.attention.filter(a => {
    if (a.blocks_lock || !a.code.startsWith('notice:')) return false
    const k = needKey(a)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Whether an item waits on this person: it names them, or a role they hold. An item that names nobody is nobody's in particular. */
export function isForMe(item: AttentionItem, me: string | null, roles: readonly string[]): boolean {
  const f = item.for
  if (!f) return false
  return (!!f.person && f.person === me) || (!!f.role && roles.includes(f.role))
}

const dueKey = (a: AttentionItem) => a.due ?? '9999-99-99'

/**
 * A person's own items first, soonest due first within each part, an item with no date last, and otherwise the order
 * the host gave. Pure: it sorts a copy and scores nobody.
 */
export function mineFirst<T extends AttentionItem>(needs: readonly T[], me: string | null, roles: readonly string[]): T[] {
  return mineFirstBy(needs, n => n, me, roles)
}

/** [`mineFirst`] for rows that hold an item (a document's group and its item). */
export function mineFirstBy<R>(rows: readonly R[], item: (r: R) => AttentionItem, me: string | null, roles: readonly string[]): R[] {
  return rows
    .map((r, i) => ({ r, i, a: item(r), mine: isForMe(item(r), me, roles) }))
    .sort((x, y) => Number(y.mine) - Number(x.mine) || (dueKey(x.a) < dueKey(y.a) ? -1 : dueKey(x.a) > dueKey(y.a) ? 1 : 0) || x.i - y.i)
    .map(x => x.r)
}

const words = (s: string) => s.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase())

/** Who another person's item is waiting on, in words ("Waiting on Aoife", "Waiting on Creative director"); null for mine or for one that names nobody. */
export function waitingOn(item: AttentionItem, me: string | null, roles: readonly string[]): string | null {
  const f = item.for
  if (!f || isForMe(item, me, roles)) return null
  if (f.person) return `Waiting on ${words(f.person.split('@')[0])}`
  if (f.role) return `Waiting on ${words(f.role).toLowerCase().replace(/^./, c => c.toUpperCase())}`
  return null
}

/** A need, with who raised it when its decision is in the view (person or agent). */
export type Need = AttentionItem & { by?: 'person' | 'agent' }

/**
 * A bad verdict in words that say whose it is (UAT round 5, 2026-11-12): the Review agent's own
 * "no" read "Marked wrong" as if a person had marked it. A person's stays "Marked wrong".
 */
export function verdictWords(by: 'person' | 'agent' | undefined): string {
  return by === 'agent' ? 'The Review agent said no, and it is not settled yet' : 'Marked wrong, and not answered yet'
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
  // The host's can_lock is true for a document with nothing in it yet (no
  // blockers): one nobody and no agent has written anything into is a draft.
  if (lock.can_lock && view.decisions.length > 0) return { label: 'Ready to lock', tone: 'ok', locked: false }
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

/** Whether a host event (`clan-data-changed`, `clan-patch-saved`) is about `docPath`:
 * they come on one stream for the whole workspace and name their document (os-layer.md §8.4). */
export function isFor(payload: { path?: unknown } | null | undefined, docPath: string): boolean {
  return !!payload && typeof payload === 'object' && payload.path === docPath
}
