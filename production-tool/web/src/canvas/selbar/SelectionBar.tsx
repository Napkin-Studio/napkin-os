// The selection bar for the document's nodes, links and groups (features/canvas-edit-tools.clan;
// ui-behaviour 3.9; mocks CanvasLinking and SketchInk): a frosted bar above the selection,
// flipped below when there is no room, with the 3.9 row (selbar.ts) and More. Engine-neutral:
// it is handed the selection and the actions; pictures and sketch areas keep the canvas's
// own Generate bar.

import { useRef, useState } from 'react'
import { Float } from '../../ui/Float'
import { useFloating } from '../../ui/hooks'
import type { Anchor } from '../../lib/place'
import { barFor, hasMore, moreFor, type ActionId, type SelInfo } from './selbar'
import './selbar.css'

export interface SelectionBarActions {
  open(): void
  group(): void
  ungroup(): void
  lock(locked: boolean): void
  remove(): void
}

const TRASH = (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 4 H11 M5.5 4 V2.5 H8.5 V4 M4 4 L4.6 12 H9.4 L10 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
)
const INK = (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 9 c2 -4 3 -4 4 0 s2 4 4 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M2 12 H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
)

export function SelectionBar({ info, anchor, actions }: { info: SelInfo; anchor: Anchor; actions: SelectionBarActions }) {
  const { ref, style } = useFloating<HTMLDivElement>(anchor)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [more, setMore] = useState(false)
  const bar = barFor(info)
  if (!bar.length) return null
  const run = (id: ActionId) => {
    if (id === 'open') actions.open()
    else if (id === 'group') actions.group()
    else if (id === 'ungroup') actions.ungroup()
    else if (id === 'delete') actions.remove()
  }
  const label = info.group?.ink ? 'Ink group actions' : info.cards.length ? 'Node actions' : 'Selection actions'
  return (
    <div ref={ref} className="toolbar selbar" style={style} role="toolbar" aria-label={label} onPointerDown={(e) => e.stopPropagation()}>
      {bar.map((a) => a.icon
        ? <span key={a.id} className="row"><span aria-hidden="true" className="sep" /><button type="button" className="sb-icon" aria-label={a.label} title={`${a.label} (Delete)`} onClick={() => run(a.id)}>{TRASH}</button></span>
        : (
          <button key={a.id} type="button" className={`sb-btn ${a.primary ? 'primary' : ''} ${a.id === 'convert' ? 'ink' : ''}`} disabled={!!a.off} aria-disabled={!!a.off}
            title={a.off ?? (a.id === 'group' ? 'Group (Ctrl+G)' : a.id === 'ungroup' ? 'Ungroup (Ctrl+Shift+G)' : undefined)} onClick={() => run(a.id)}>
            {a.id === 'convert' && INK}{a.label}
          </button>
        ))}
      {hasMore(bar) && (
        <>
          <span aria-hidden="true" className="sep" />
          <button ref={moreRef} type="button" className="sb-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}>⋯</button>
          <Float anchor={moreRef} open={more} onClose={() => setMore(false)} side="below" align="end" label="More" className="pt-menu sb-more">
            {moreFor(info).map((m) => (
              <button key={m.id} type="button" role="menuitem" className={`pt-menurow ${m.id === 'delete' ? 'danger' : ''}`} disabled={!!m.off} title={m.off}
                onClick={() => {
                  setMore(false)
                  if (m.id === 'delete') actions.remove()
                  else if (m.id === 'lock' || m.id === 'unlock') actions.lock(m.id === 'lock')
                }}>
                {m.label}{m.off && <span className="hint">later</span>}
              </button>
            ))}
          </Float>
        </>
      )}
    </div>
  )
}
