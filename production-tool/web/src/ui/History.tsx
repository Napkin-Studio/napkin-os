// The History panel: the .clan's decision chain, newest first. Who did it
// (you, the director, the provider), what, why, and which fields changed,
// narrowed to one item when you ask "why does this look like this?".

import { useEffect, useMemo, useState } from 'react'
import { useDoc } from '../app/context'
import type { ClanBackedStore } from '../doc/clan'
import { download, exportClanFile } from '../export'
import { historyItems, type ChainLike } from './historyItems'
import { HistoryList } from './HistoryList'
import './history.css'

export function HistoryPanel({ store, onClose }: { store: ClanBackedStore | null; onClose: () => void }) {
  const doc = useDoc()
  const [entries, setEntries] = useState<ChainLike[] | null>(null)
  const [itemKey, setItemKey] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const items = useMemo(() => historyItems(doc), [doc])
  const item = items.find((i) => i.key === itemKey)

  // Escape closes it (it did not, 2026-10-09). An open menu takes Escape first (ui/Float.tsx stops it).
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
      store.chain().then((c) => alive && setEntries(c as ChainLike[])).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
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
        <span className="faint">{entries ? `${entries.length} entries` : ''}</span>
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
          </div>
          {error && <div role="alert" className="history-error">{error}</div>}
          {entries ? <HistoryList entries={entries} handle={doc.participant.handle} item={item} /> : <div className="history-empty faint">Reading the .clan…</div>}
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
