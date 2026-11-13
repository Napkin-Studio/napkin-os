// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// View as (the account menu, an admin's): try the desk as one of the agency's roles. It changes the desk's
// "Your pages" row and the tools offered, and nothing else: what the server lets the admin open does not change.

import { useEffect } from 'react'
import '../../components/chrome.css'

interface Props {
  roles: readonly { id: string; title: string }[]
  /** The role being tried, or null for the admin's own view. */
  current: string | null
  onPick: (role: string | null) => void
  onClose: () => void
}

export function ViewAsDialog({ roles, current, onPick, onClose }: Props) {
  // Escape closes it, and only it: the page's own Escape (up one level) waits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="ch-scrim" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="ch-dialog" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-labelledby="viewas-title" data-testid="view-as" onClick={e => e.stopPropagation()}>
        <div>
          <div className="eyebrow">Admin</div>
          <h2 id="viewas-title" style={{ marginTop: 4 }}>View as</h2>
        </div>
        <p>Try the desk as another role. Only the row of pages and the tools offered change.</p>
        <label className="eyebrow" htmlFor="viewas-select">Role</label>
        <select id="viewas-select" data-testid="role-switcher" value={current ?? ''} onChange={e => onPick(e.target.value || null)}
          style={{ minHeight: 44, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 8, background: 'var(--card)', color: 'var(--ink)', font: '600 14px var(--font-ui)' }}>
          <option value="">My own view</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <div className="ch-actions">
          <button className="ch-btn ch-btn-quiet" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
