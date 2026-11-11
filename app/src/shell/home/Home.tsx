// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A role's home (v2 section 4; features/roles-and-homes.clan): where a person
// lands. Needs you first, then at most five round doors, then More tools as a
// quiet text list. The server sends the doors from the roles in the session;
// this draws whatever it is sent and never decides what a role may open.
//
// It wears the shell's own look: the desk's header, the pick-up rows for Needs
// you, the client circles' shadow and name for the doors. A door whose tool
// exists is ink; one whose tool comes in a later phase is dashed, as the
// shell draws what cannot run yet.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DoorEntry, HomeView } from '../../host/http'
import type { JobNeed, LibraryItem } from '../../host/types'
import { doorIsLive, doorLabel, firstNeeds, hello, homeEyebrow, needsLine, needsRows } from './model'
import { changedBriefs } from '../gate/words'
import { Ask } from '../../timesheet/Ask'
import { useConsent } from '../../timesheet/consent'
import '../gate/gate.css'
import './home.css'

interface Props {
  view: HomeView
  items: readonly LibraryItem[]
  /** What the job index asks of this person, by deadline. */
  jobNeeds?: readonly JobNeed[]
  /** The person's first name, for the greeting. */
  first: string | null
  /** App ids installed here: which doors have a tool. */
  apps: readonly string[]
  onDoor: (door: DoorEntry) => void
  onOpenDocument: (path: string) => void
  onMap: () => void
  /** Opens the person's own timesheet day. */
  onTimesheet?: () => void
  /** The role switcher (admins and demos): another role's home, or null for your own. */
  onSwitch: (role: string | null) => void
}

export function Home({ view, items, jobNeeds = [], first, apps, onDoor, onOpenDocument, onMap, onTimesheet, onSwitch }: Props) {
  // Asked once, here, at the person's first sign-in: only a signed-in person has a timesheet to ask about.
  const consent = useConsent()
  const top = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)
  // The heading takes focus on arrival, so a keyboard or a screen reader lands on it.
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])

  // The last word keeps the period dot with it, so the dot never wraps alone onto a line.
  const greet = hello(first)
  const cut = greet.lastIndexOf(' ')
  const needs = useMemo(() => needsRows(items, jobNeeds), [items, jobNeeds])
  const { shown } = firstNeeds(needs, all)

  return (
    <div className="nui nui-page" ref={top} data-testid="home" data-role={view.viewing ?? view.roles.join(' ')}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow" data-testid="home-eyebrow">{homeEyebrow(view).toUpperCase()}</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="home-title">{greet.slice(0, cut + 1)}<span className="hm-nb">{greet.slice(cut + 1)}<span className="period-dot" aria-hidden /></span></h1>
            <p className="hero-sub" data-testid="home-sub">{needsLine(needs.length)}</p>
          </div>
          <div className="hm-tools">
            {view.switcher && (
              <label className="hm-switch">
                <span className="eyebrow">View as</span>
                <select data-testid="role-switcher" value={view.viewing ?? ''} onChange={e => onSwitch(e.target.value || null)}>
                  <option value="">My home</option>
                  {view.switcher.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="side-link" data-testid="open-map" onClick={onMap}>The map of the agency</button>
            {onTimesheet && consent !== null && <button type="button" className="side-link" data-testid="open-timesheet" onClick={onTimesheet}>Your timesheet</button>}
          </div>
        </section>

        <main className="hm-main">
          {consent === 'not_asked' && <Ask variant="card" onTimesheet={onTimesheet} />}
          {changedBriefs(items).map(i => (
            <div key={i.path} className="gate-alert" role="status" data-testid="alert">
              <i aria-hidden />
              <span><b>Changed brief</b> {i.title}{i.client ? `, ${i.client.name}` : ''}. The signed version stays as it was; the new one needs signing.</span>
              <button type="button" className="ch-btn" onClick={() => onOpenDocument(i.path)}>Open the brief</button>
            </div>
          ))}
          <section className="hm-sec" aria-labelledby="hm-needs">
            <h2 className="hm-h" id="hm-needs">Needs you</h2>
            {needs.length === 0 ? (
              <p className="nui-empty hm-none" data-testid="needs-empty">Nothing needs you now. No deadline is set on any job.</p>
            ) : (
              <ul className="hm-needs" data-testid="needs-you">
                {shown.map(n => (
                  <li key={n.path} className="hm-need" data-testid="need">
                    <span className="hm-need-what"><b>{n.title}</b><small>{n.sub}</small></span>
                    <span className="hm-need-state">{n.state}</span>
                    <button type="button" className="btn-rect" onClick={() => onOpenDocument(n.path)}>{n.action}</button>
                  </li>
                ))}
              </ul>
            )}
            {!all && needs.length > shown.length && (
              <p className="nui-more"><button type="button" className="side-link" data-testid="needs-show-all" onClick={() => setAll(true)}>Show all {needs.length}</button></p>
            )}
          </section>

          <section className="hm-sec" aria-labelledby="hm-doors">
            <h2 className="hm-h" id="hm-doors">Your doors</h2>
            <nav className="hm-doors" aria-label="Your doors">
              {view.doors.map(d => {
                const live = doorIsLive(d.id, apps)
                return (
                  <button key={d.id} type="button" className="hm-door" data-testid="door" data-door={d.id} data-live={live || undefined}
                    aria-label={doorLabel(d, live)} onClick={() => onDoor(d)}>{d.name}</button>
                )
              })}
            </nav>
            {view.doors.length === 0 && <p className="nui-empty hm-none">No doors are set for this role yet. Ask your studio admin.</p>}
          </section>

          {view.more.length > 0 && (
            <section className="hm-sec" aria-labelledby="hm-more">
              <h2 className="hm-h" id="hm-more">More tools</h2>
              <ul className="hm-more" data-testid="more-tools">
                {view.more.map(m => (
                  <li key={m.id}><button type="button" className="side-link" data-testid="more-tool" data-door={m.id} onClick={() => onDoor(m)}>{m.name}</button></li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
