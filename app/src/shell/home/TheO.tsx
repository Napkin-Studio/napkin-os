// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The O (v2 section 4): the map of the agency, not the landing. The agency's
// logo at the centre, at most five department circles around it with the
// person's own first, and every other department they may open as a quiet text
// list. The server decides which departments and in what order
// (napkin-web/src/roles.rs `map_for`); this draws them.

import { useEffect, useRef } from 'react'
import type { HomeView, MapCircle } from '../../host/http'
import type { AgencyLogo } from '../agency/palette'
import { placeOf } from './model'
import './home.css'

interface Props {
  view: HomeView
  agency: string
  logo?: AgencyLogo
  onOpen: (c: MapCircle) => void
  onHome: () => void
}

export function TheO({ view, agency, logo, onOpen, onHome }: Props) {
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])
  const { circles, other } = view.map
  const own = circles.find(c => c.mine)
  return (
    <div className="nui nui-page" ref={top} data-testid="the-o">
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">THE MAP</div>
            <h1 className="hero-title" tabIndex={-1}>Where to?<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub">{own ? `${own.name} is yours and comes first. You land in your home, not here.` : 'You land in your home, not here.'}</p>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={onHome}>Back to your home</button></div>
        </section>

        <main className="hm-main">
          <nav className="hm-o" aria-label="Departments" data-count={circles.length}>
            <div className="hm-o-logo" data-testid="o-logo" aria-label={agency}>
              {logo?.icon ? <img src={logo.icon} alt="" aria-hidden /> : logo?.wordmark ? <img className="wide" src={logo.wordmark} alt="" aria-hidden /> : <span>{agency}</span>}
            </div>
            {circles.map((c, i) => (
              <button key={c.id} type="button" className="hm-o-dept" data-testid="o-circle" data-dept={c.id} data-mine={c.mine || undefined}
                aria-label={c.mine ? `${c.name}, your department` : c.name} style={placeOf(i, circles.length)} onClick={() => onOpen(c)}>{c.name}</button>
            ))}
          </nav>

          {other.length > 0 && (
            <section className="hm-sec hm-other" aria-labelledby="hm-other">
              <h2 className="hm-h" id="hm-other">Other departments</h2>
              <ul className="hm-more" data-testid="other-departments">
                {other.map(c => <li key={c.id}><button type="button" className="side-link" data-testid="other-department" onClick={() => onOpen(c)}>{c.name}</button></li>)}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
