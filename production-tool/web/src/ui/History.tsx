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
import { entryKind, historyItems, kindOf, projectEntries, type ChainLike } from './historyItems'
import { AgentFigure } from './agents/AgentFigure'
import type { CastKey } from './agents/cast'

const CREW_ORDER: CastKey[] = ['skye', 'dex', 'wren', 'rhea', 'jude', 'ellis', 'edie']
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
  const [tree, setTree] = useState(true)
  const [whoOnly, setWhoOnly] = useState<string>('all')
  const [pinned, setPinned] = useState(false)
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
  // Who: everyone, you, the people, or one of the crew (only those in this project's chain).
  const me = ui.me?.participantId
  const crewIn = useMemo(() => CREW_ORDER.filter((c) => (entries ?? []).some((e) => e.agent === c)), [entries])
  const shown = useMemo(() => (entries ?? []).filter((e) => {
    if (pinned && !e.pinned) return false
    if (whoOnly === 'all') return true
    if (whoOnly === 'you') return !!me && e.agent === `human:${me}`
    if (whoOnly === 'people') return kindOf(e.agent) === 'person'
    return e.agent === whoOnly
  }), [entries, pinned, whoOnly, me])
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
        <span className="faint">the project's decision chain</span>
        <span className="spacer" />
        <span className="pt-seg" role="group" aria-label="Show as">
          <button type="button" aria-pressed={!tree} onClick={() => setTree(false)}>List</button>
          <button type="button" aria-pressed={tree} onClick={() => setTree(true)}>Tree</button>
        </span>
        <button className="history-x" onClick={onClose} aria-label="Close history">×</button>
      </div>
      {!store ? (
        <div className="history-empty">
          <b>Saving without history.</b>
          <span className="faint">The .clan engine did not load in this browser, so your work is kept as plain data and its decisions are not recorded.</span>
        </div>
      ) : (
        <>
          <div className="history-filter">
            <div className="history-frow">
              <label className="pt-label" htmlFor="history-item">Item</label>
              <select id="history-item" className="select" value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
                <option value="all">Everything</option>
                {items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              </select>
              {focus && <span className="faint">opened from "Why does this look like this?"</span>}
            </div>
            <div className="history-frow" role="group" aria-label="Who">
              <span className="pt-label">Who</span>
              <button type="button" className={`chip ${whoOnly === 'all' ? 'on' : ''}`} onClick={() => setWhoOnly('all')}>Everyone</button>
              <button type="button" className={`chip ${whoOnly === 'you' ? 'on' : ''}`} onClick={() => setWhoOnly('you')}>You</button>
              <button type="button" className={`chip ${whoOnly === 'people' ? 'on' : ''}`} onClick={() => setWhoOnly('people')}>People</button>
              {crewIn.map((c) => (
                <button key={c} type="button" className={`history-crewchip ${whoOnly === c ? 'on' : ''}`} aria-pressed={whoOnly === c} aria-label={c} title={c} onClick={() => setWhoOnly(whoOnly === c ? 'all' : c)}>
                  <AgentFigure agent={c} size={20} decorative />
                </button>
              ))}
            </div>
            <div className="history-frow" role="group" aria-label="Kind">
              <span className="pt-label">Kind</span>
              {KINDS.map((k) => (
                <button key={k.id} type="button" className={`chip ${kind === k.id ? 'on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? 'all' : k.id)}>{k.label} {counts[k.id]}</button>
              ))}
              <span className="spacer" />
              <button type="button" className={`chip ${pinned ? 'on' : ''}`} aria-pressed={pinned} onClick={() => setPinned(!pinned)}>Pinned only</button>
            </div>
          </div>
          {error && <div role="alert" className="history-error">{error}</div>}
          {entries ? <HistoryList entries={shown} doc={doc} me={ui.me?.participantId} myName={ui.me?.name ?? ui.me?.handle} item={item} kind={kind === 'all' ? undefined : kind} tree={tree} /> : <div className="history-empty faint">Reading the .clan…</div>}
          <div className="history-foot">
            <button className="btn sm" onClick={async () => {
              const { blob, name } = await exportClanFile(store)
              download(blob, name)
            }}>Download .clan</button>
            <span className="faint">Open it with <code>clan read chain</code></span>
            <span className="spacer" />
            {entries && <span className="pt-mono">{shown.length} of {entries.length}</span>}
          </div>
        </>
      )}
    </aside>
  )
}
