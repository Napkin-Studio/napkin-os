// The History panel: the .clan's decision chain, newest first. Who did it (you,
// another person, the crew), what, why, which fields it changed, its Kind,
// narrowed to one item when you ask "why does this look like this?". The
// items and the narrowing read the decisions' targets and cites
// (model/lineage.ts), not ids in the words.

import { useEffect, useMemo, useState } from 'react'
import { useDoc, useUi } from '../app/context'
import type { Kind } from '../model/lineage'
import type { ModelStore } from '../model/store'
import { download, exportClanFile } from '../export'
import { entryKind, historyItems, projectEntries, type ChainLike } from './historyItems'
import { HistoryList } from './HistoryList'
import './history.css'

const KINDS: { id: Kind; label: string }[] = [
  { id: 'decision', label: 'Decisions' }, { id: 'check', label: 'Checks' }, { id: 'ask', label: 'Asks' }, { id: 'pick', label: 'Picks' },
]

/** An item to open History on (Why, why?): its words and the addresses its decisions target or cite. */
export interface HistoryFocus { label: string; addresses: string[] }

export function HistoryPanel({ store, onClose, focus }: { store: ModelStore | null; onClose: () => void; focus?: HistoryFocus }) {
  const doc = useDoc()
  const ui = useUi()
  const [entries, setEntries] = useState<ChainLike[] | null>(null)
  const [itemKey, setItemKey] = useState(focus ? 'focus' : 'all')
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [error, setError] = useState<string | null>(null)
  const docId = useMemo(() => {
    try {
      return store?.documentId() ?? ''
    } catch {
      return ''
    }
  }, [store])
  const items = useMemo(() => [...(focus ? [{ key: 'focus', ...focus }] : []), ...historyItems(doc, docId)], [doc, docId, focus])
  const item = items.find((i) => i.key === itemKey)
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { decision: 0, check: 0, ask: 0, pick: 0 }
    for (const e of entries ?? []) c[entryKind(e)]++
    return c
  }, [entries])

  // Escape closes it. An open menu takes Escape first (ui/Float.tsx stops it).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  useEffect(() => {
    if (!store) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      store.chain().then((c) => alive && setEntries(projectEntries(c as ChainLike[]))).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    }
    load()
    const off = store.onChain(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 300)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [store])

  return (
    <aside className="history" aria-label="History">
      <div className="history-top">
        <b>History</b>
        <span className="faint">{entries ? `${entries.length} decisions` : ''}</span>
        <span className="spacer" />
        <button className="btn xs ghost" onClick={onClose} aria-label="Close history">Close</button>
      </div>
      {!store ? (
        <div className="history-empty">
          <b>Saving without history.</b>
          <span className="faint">The .clan engine did not load in this browser, so your work is kept as plain data and its decisions are not recorded.</span>
        </div>
      ) : (
        <>
          <div className="history-filter">
            <label className="faint" htmlFor="history-item">Why does this look like this?</label>
            <select id="history-item" className="select" value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
              <option value="all">Everything</option>
              {items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
            <label className="faint" htmlFor="history-kind">Kind</label>
            <select id="history-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind | 'all')}>
              <option value="all">All</option>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} {counts[k.id]}</option>)}
            </select>
          </div>
          {error && <div role="alert" className="history-error">{error}</div>}
          {entries ? <HistoryList entries={entries} doc={doc} me={ui.me?.participantId} item={item} kind={kind === 'all' ? undefined : kind} /> : <div className="history-empty faint">Reading the .clan…</div>}
          <div className="history-foot">
            <button className="btn sm" onClick={async () => {
              const { blob, name } = await exportClanFile(store)
              download(blob, name)
            }}>Download .clan</button>
            <span className="faint">Open it with <code>clan read chain</code></span>
          </div>
        </>
      )}
    </aside>
  )
}
