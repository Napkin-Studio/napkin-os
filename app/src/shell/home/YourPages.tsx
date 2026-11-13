// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Your pages": the one row a role adds to the desk (features/align-landing-look.clan), under the greeting.
// Page doors (Dashboard, Live jobs, Approvals, Judge scores, People ...) are agency-wide pages, not a client's
// tools: at most five, the person's own role first, the rest under More as a text list. The server decides
// which (napkin-web/src/roles.rs); this draws what it was sent and never decides what a role may open.
// Drawn with the desk's own pills and rows: no new colour, no new type.

import { useState } from 'react'
import type { DoorEntry } from '../../host/http'
import './home.css'

interface Props {
  pages: readonly DoorEntry[]
  more: readonly DoorEntry[]
  onOpen: (door: DoorEntry) => void
}

export function YourPages({ pages, more, onOpen }: Props) {
  const [showMore, setShowMore] = useState(false)
  if (pages.length === 0 && more.length === 0) return null
  return (
    <section className="pg-row" id="your-pages" aria-label="Your pages" data-testid="your-pages">
      <h2 className="pg-h">Your pages</h2>
      <div className="pg-doors">
        {pages.map(d => (
          <button key={d.id} type="button" className="btn-rect pg-door" data-testid="page-door" data-door={d.id} data-dogfood={`page: ${d.name}`}
            onClick={() => onOpen(d)}>{d.name}</button>
        ))}
        {more.length > 0 && (
          <button type="button" className="side-link pg-more" data-testid="pages-more" aria-expanded={showMore} aria-controls="pg-more-list"
            onClick={() => setShowMore(v => !v)}>More</button>
        )}
      </div>
      {more.length > 0 && showMore && (
        <ul className="pg-more-list" id="pg-more-list" data-testid="more-pages">
          {more.map(m => (
            <li key={m.id}><button type="button" className="side-link" data-testid="more-page" data-door={m.id} data-dogfood={`page: ${m.name}`}
              onClick={() => onOpen(m)}>{m.name}</button></li>
          ))}
        </ul>
      )}
    </section>
  )
}
