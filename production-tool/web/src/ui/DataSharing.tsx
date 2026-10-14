// Data sharing (features/tenant-limits.clan): who receives the agency's material, opened from Home's ⋯
// menu. Read-only: Napkin changes what an agency shares when the agency asks, so the sheet says so.
// Its words are in sharing.ts. No prices, costs or limits here (owner, 2026-10-13).

import { useEffect } from 'react'
import type { Allow } from '../contracts/types'
import { ASK_NAPKIN, sharingRows } from './sharing'
import './datasharing.css'

export function DataSharing({ allow, onClose }: { allow: Allow; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="ds-veil" role="dialog" aria-modal="true" aria-labelledby="ds-h" onClick={onClose}>
      <div className="ds-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="ds-h">Data sharing</h2>
        <p className="ds-lead">Who receives what your agency puts into the Production Tool.</p>
        <ul className="ds-list">
          {sharingRows(allow).map((r) => (
            <li key={r.id} className={`ds-row ${r.on ? 'on' : 'off'}`} data-maker={r.id}>
              <div className="ds-head">
                <b>{r.name}</b>
                <span className={`ds-pill ${r.on ? 'on' : 'off'}`}>{r.on ? 'On' : 'Off'}</span>
              </div>
              <p>{r.does}</p>
              <p className="ds-meta">Receives: {r.receives}</p>
              <p className="ds-meta">{[r.through, r.where].filter(Boolean).join(' · ')}</p>
              {r.state !== 'On' && <p className="ds-meta">{r.state}</p>}
            </li>
          ))}
        </ul>
        <p className="ds-foot">{ASK_NAPKIN}</p>
        <div className="ds-actions">
          <button className="btn sm" onClick={onClose} autoFocus>Close</button>
        </div>
      </div>
    </div>
  )
}
