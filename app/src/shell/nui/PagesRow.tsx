// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Your pages": what a role adds to the desk (features/align-landing-look.clan). One row of page doors
// under the greeting, at most five, the person's own role first, and the rest under More as a text list.
// The server decides which (napkin-web/src/roles.rs view); this draws what it is sent. A person with no
// role has no row. Drawn with the desk's own pieces: the eyebrow, the pill border and the side links.

import type { DoorEntry, HomeView } from '../../host/http'
import { doorIsLive } from '../home/doorTargets'

interface Props {
  view: HomeView
  onOpen: (door: DoorEntry) => void
}

/** The words a door carries for a screen reader: its name, and that it is not here yet. */
const pageLabel = (d: DoorEntry, live: boolean): string => `${d.name}${live ? '' : ', comes in a later phase'}`

export function PagesRow({ view, onOpen }: Props) {
  if (!view.restricted || (view.pages.length === 0 && view.more.length === 0)) return null
  return (
    <section className="pg-row" aria-label="Your pages" data-testid="pages-row">
      <h2 className="pg-h" id="pg-h">Your pages</h2>
      <nav className="pg-doors" aria-labelledby="pg-h">
        {view.pages.map(d => {
          const live = doorIsLive(d.id)
          return (
            <button key={d.id} type="button" className="pg-door" data-testid="door" data-door={d.id} data-live={live || undefined}
              data-dogfood={`page-door-${d.id}`} aria-label={pageLabel(d, live)} onClick={() => onOpen(d)}>{d.name}</button>
          )
        })}
      </nav>
      {view.more.length > 0 && (
        <p className="pg-more" data-testid="more-pages">
          <span className="pg-h">More</span>
          <span className="pg-list">
            {view.more.map(m => (
              <button key={m.id} type="button" className="side-link" data-testid="more-tool" data-door={m.id} data-dogfood={`page-door-${m.id}`} onClick={() => onOpen(m)}>{m.name}</button>
            ))}
          </span>
        </p>
      )}
    </section>
  )
}
