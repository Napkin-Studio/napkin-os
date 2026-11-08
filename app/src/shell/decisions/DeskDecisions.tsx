// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Decisions on the desk (features/new-ui-shell.clan, open question answered
// 9 Nov 2026): a drawer listing every document, across the agency's clients,
// that needs a call, newest first and grouped by client. Each opens the
// document, where its own Decisions drawer has the calls. The same items the
// bar's count counts (landing/model.ts needsYou), never worked out twice.

import type { LibraryItem } from '../../host'
import { needsReason, toolName } from '../landing/model'
import { deskCalls } from './deskCalls'
import './DecisionPanel.css'

export default function DeskDecisions({ items, onOpen, onClose }: {
  items: readonly LibraryItem[]
  onOpen: (path: string) => void
  onClose: () => void
}) {
  const groups = deskCalls(items)
  const n = groups.reduce((s, g) => s + g.items.length, 0)
  return (
    <aside className="dp-panel dp-desk" aria-labelledby="dp-desk-title" data-testid="desk-decisions">
      <div className="dp-head">
        <div className="dp-head-t">
          <h2 id="dp-desk-title" className="dp-title">Decisions</h2>
          <span className="dp-sum">{n ? `${n} document${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} your call` : 'nothing needs your call'}</span>
        </div>
        <button className="ch-btn ch-btn-icon ch-btn-quiet" onClick={onClose} aria-label="Close decisions">✕</button>
      </div>
      <div className="dp-scroll">
        {n === 0 && <div className="dp-done">Nothing is waiting on you, across every client.</div>}
        {groups.map(g => (
          <section key={g.client || '-'} aria-label={g.client || 'No client'}>
            <h3 className="dp-sec">{g.client || 'No client'} <span className="dp-n">{g.items.length}</span></h3>
            {g.items.map(it => (
              <div className="dp-card" key={it.path} data-testid="desk-call">
                <div className="dp-card-what">{it.title || 'Untitled'}</div>
                <div className="dp-card-who">{[toolName(it)?.name, needsReason(it)].filter(Boolean).join(' · ')}</div>
                <div className="dp-acts">
                  <button className="dp-btn dp-btn-primary" onClick={() => onOpen(it.path)}>Open</button>
                  <span className="dp-hint">its calls are in its own Decisions</span>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
