// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the desk reads of recent documents' own chains (deskData.ts DocFacts):
// who touched each last, what blocks its lock, what rests on thin evidence and whether
// what it was made from changed. There is no tenant-wide route for any of it
// (gaps.md §12), so the desk asks each recent document itself
// (Host.docOps), at most MAX of them, and again only when one changes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { hasServer, host } from '../../host'
import type { DecisionsView, LibraryItem, UpstreamView } from '../../host'
import { needsOf } from '../decisions/needs'
import { needsYou } from '../landing/model'
import { thinOf, type DocFacts, type Facts } from './deskData'
import { limiter, READING } from './limiter'

/** How many documents the desk reads: the newest, and every one that needs a call. */
export const MAX = 10

/** The documents worth reading, newest first: all that need a call, then the newest. */
export function worthReading(items: readonly LibraryItem[], max = MAX): LibraryItem[] {
  const out = items.filter(needsYou).slice(0, max)
  for (const i of items) {
    if (out.length >= max) break
    if (!out.includes(i)) out.push(i)
  }
  return out
}

const stampOf = (i: LibraryItem) => `${i.updated_at}:${i.state?.needs_you ?? 0}:${i.state?.locked ? 1 : 0}:${i.run?.state ?? ''}`

/** The facts one document's chain and upstream give. */
export function factsOf(view: DecisionsView, up: UpstreamView | null): DocFacts {
  const newest = view.decisions.find(b => !b.superseded) ?? view.decisions[0]
  const parent = up?.upstream.find(u => u.direct && u.status === 'changed')
  return {
    editor: newest ? { name: newest.who.name, you: !!newest.who.you, at: newest.decision.timestamp } : null,
    calls: needsOf(view),
    thin: thinOf(view.attention),
    upstreamChanged: parent ? { title: parent.title || 'What it was made from', ...(parent.path ? { path: parent.path } : {}) } : null,
    locked: !!view.lock.locked && !view.lock.reopened?.length,
    canLock: view.lock.can_lock,
    decisions: view.decisions.length,
  }
}

export function useDeskFacts(items: readonly LibraryItem[] | null, enabled: boolean): { facts: Facts; refresh: (path: string) => void } {
  const [facts, setFacts] = useState<Record<string, DocFacts>>({})
  const read = useRef(new Map<string, string>())
  const slot = useRef(limiter(READING))
  const ops = enabled && hasServer && typeof host.docOps === 'function'

  const load = useCallback(async (item: LibraryItem) => {
    const stamp = stampOf(item)
    read.current.set(item.path, stamp)
    try {
      const [view, up] = await slot.current(async () => {
        const doc = await host.docOps!(item.path)
        return Promise.all([doc.decisions(), doc.upstream().catch(() => null)])
      })
      if (view.problem) return
      const f = factsOf(view, up)
      setFacts(prev => ({ ...prev, [item.path]: f }))
    } catch {
      // Not readable now (gone, another person's): read again when it changes.
      read.current.delete(item.path)
    }
  }, [])

  useEffect(() => {
    if (!ops || !items) return
    for (const i of worthReading(items)) {
      if (read.current.get(i.path) !== stampOf(i)) void load(i)
    }
  }, [ops, items, load])

  const refresh = useCallback((path: string) => {
    const i = items?.find(x => x.path === path)
    if (i) void load(i)
  }, [items, load])

  return { facts, refresh }
}
