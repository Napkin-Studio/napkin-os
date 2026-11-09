// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Decisions on the desk (gaps.md X7): the calls themselves, across every
// document the desk has read (useDeskFacts), each settled through its own
// document's routes (Host.docOps); documents not read yet are listed to open.
// The views show the document with the most calls, as the mock's desk drawer
// shows McDonald's brief.

import { useCallback, useEffect, useState } from 'react'
import { host } from '../../host'
import type { DecisionsView, LibraryItem, RelatedView } from '../../host'
import { read as readAside, write as writeAside } from '../decisions/useSetAside'
import { needsReason, toolName } from '../landing/model'
import { clientName, deskCallDocs, type Facts } from './deskData'
import { DecisionsDrawer, type CallGroup, type DrawerView } from './DecisionsDrawer'

const NOUN: Record<string, string> = { brief: 'brief', research: 'research', deck: 'deck', prod: 'production', ads: 'ad', idea: 'idea' }

interface Props {
  items: readonly LibraryItem[]
  facts: Facts
  /** The agency's name, for the title when nothing needs a call. */
  agency: string
  onOpen: (path: string) => void
  onClose: () => void
  /** A document was settled here: read it again. */
  onChanged: (path: string) => void
}

export function DeskDrawer({ items, facts, agency, onOpen, onClose, onChanged }: Props) {
  const { read, unread } = deskCallDocs(items, facts)
  const [view, setView] = useState<DrawerView>('graph')
  const [, setTick] = useState(0)
  const first = read[0]?.item ?? null
  const [focus, setFocus] = useState<{ path: string; view: DecisionsView | null; related: RelatedView | null; error: string | null } | null>(null)
  const focusPath = first?.path ?? null
  const stamp = first ? `${first.updated_at}:${first.state?.needs_you ?? 0}` : ''
  useEffect(() => {
    if (!focusPath || typeof host.docOps !== 'function') return
    let live = true
    host.docOps(focusPath).then(d => Promise.all([d.decisions(), d.related().catch(() => null)]))
      .then(([v, r]) => { if (live) setFocus({ path: focusPath, view: v, related: r, error: null }) },
        e => { if (live) setFocus({ path: focusPath, view: null, related: null, error: String(e instanceof Error ? e.message : e) }) })
    return () => { live = false }
  }, [focusPath, stamp])

  const ops = useCallback((path: string) => host.docOps!(path), [])
  const groups: CallGroup[] = read.map(({ item, calls }) => ({
    key: item.path,
    title: item.title || 'Untitled',
    noun: NOUN[toolName(item)?.id ?? ''] ?? 'document',
    calls,
    aside: readAside(item.path),
    onToggleAside: key => {
      const keys = readAside(item.path)
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      writeAside(item.path, keys)
      setTick(t => t + 1)
    },
    locked: !!item.state?.locked,
    verify: async finding => { await (await ops(item.path)).verify(finding, 'Looks right (from Decisions on the desk)'); onChanged(item.path) },
    approve: async () => { await (await ops(item.path)).approve('Approved from Decisions on the desk'); onChanged(item.path) },
    open: () => onOpen(item.path),
  }))
  const shown = focus && focus.path === focusPath ? focus : null
  return (
    <DecisionsDrawer
      title={first ? `${first.client ? `${clientName(first.client)} · ` : ''}${first.title || 'Untitled'}` : `${agency} · every client`}
      groups={groups}
      pending={unread.map(i => ({ key: i.path, title: i.title || 'Untitled', sub: `${i.client ? clientName(i.client) : 'No client'} · ${needsReason(i)}`, onOpen: () => onOpen(i.path) }))}
      focus={first ? {
        title: first.title || 'Untitled',
        noun: NOUN[toolName(first)?.id ?? ''] ?? 'document',
        view: shown?.view ?? null,
        error: shown?.error ?? null,
        related: shown?.related ?? null,
        onShow: () => onOpen(first.path),
        onOpenPath: onOpen,
        acknowledge: async id => { await (await ops(first.path)).acknowledge(id); onChanged(first.path) },
      } : null}
      view={view}
      onView={setView}
      onClose={onClose}
    />
  )
}
