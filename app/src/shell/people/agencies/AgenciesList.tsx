// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Agencies list (mock people-agencies-v3, state 2): every agency in its own
// pill as people see it now, its name and id, other spellings, how many people,
// and its kind: In code, Basic, and Draft for changes nobody sees yet.

import { useState } from 'react'
import { LookPill } from './LookPill'
import {
  coloursForLook, currentLook, findAgencies, hasDraft, isPublished, listOrder, liveLook,
  type AgencyAdminRow,
} from './model'

/** The kind tags: In code or Basic (New for one not made yet), and Draft. */
export function KindTags({ row }: { row: AgencyAdminRow | null }) {
  return (
    <span className="ag-tags">
      {!row ? <span className="pa-tag ag-new">New</span>
        : row.kind === 'code' ? <span className="pa-tag ag-code">In code</span> : <span className="pa-tag ag-basic">Basic</span>}
      {row && hasDraft(row) && <span className="pa-tag ag-draft">Draft</span>}
    </span>
  )
}

export function AgenciesList({ rows, onOpen, onNew }: { rows: readonly AgencyAdminRow[]; onOpen: (row: AgencyAdminRow) => void; onNew: () => void }) {
  const [q, setQ] = useState('')
  const shown = findAgencies(listOrder(rows), q)
  return (
    <div data-testid="agencies-list">
      <div className="pa-tools">
        <input className="pa-search" placeholder="Find an agency by name, id or spelling" aria-label="Find an agency" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className="pa-btn pa-primary" onClick={onNew}>New agency</button>
      </div>
      <table className="pa-table ag-list">
        <thead><tr><th>AGENCY</th><th>NAME · ID</th><th>OTHER SPELLINGS</th><th>PEOPLE</th><th>KIND</th></tr></thead>
        <tbody>
          {shown.map(r => {
            const cur = currentLook(r)
            // the pill as people see it now; an agency never published has only its draft
            const pill = coloursForLook(isPublished(r) ? liveLook(r) : cur)
            return (
              <tr key={r.id} className="ag-row" tabIndex={0} data-agency={r.id} onClick={() => onOpen(r)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r) } }}>
                <td><LookPill colours={pill} small /></td>
                <td><b>{cur.name}</b><br /><span className="ag-mono">@{r.id}</span></td>
                <td className="ag-mono">{cur.aliases.length ? cur.aliases.join(', ') : <span className="ag-none">none</span>}</td>
                <td>{r.people}</td>
                <td><KindTags row={r} /></td>
              </tr>
            )
          })}
          {shown.length === 0 && <tr><td colSpan={5}><small>No agency matches “{q}”.</small></td></tr>}
        </tbody>
      </table>
      <p className="ag-hint"><b>In code</b>: the look lives in code; only the display name changes here. <b>Basic</b>: made on this page from two colours and one SVG wordmark. <b>Draft</b>: changes nobody sees until they are published.</p>
    </div>
  )
}
