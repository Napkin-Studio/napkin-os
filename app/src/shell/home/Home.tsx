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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markNeedDone, undoNeedDone, type DoorEntry, type HomeView } from '../../host/http'
import type { JobNeed, LibraryItem, NextDeadline } from '../../host/types'
import { doorIsLive, doorLabel, emptyLine, firstNeeds, hello, homeEyebrow, needsLine, needsRows, orderNeeds, UNDO_MS, type NeedRow } from './model'
import { Ask } from '../../timesheet/Ask'
import { SetupCard } from '../setup/SetupCard'
import { useConsent } from '../../timesheet/consent'
import '../gate/gate.css'
import './home.css'

interface Props {
  view: HomeView
  items: readonly LibraryItem[]
  /** What the job index asks of this person, by deadline. */
  jobNeeds?: readonly JobNeed[]
  /** The next deadline on this person's jobs, for the empty list; undefined from an older host. */
  nextDeadline?: NextDeadline | null
  /** Asks the server for the list again at once: after a Done or an Undo. */
  onNeedsChanged?: () => void
  /** The person's first name, for the greeting. */
  first: string | null
  /** App ids installed here: which doors have a tool. */
  apps: readonly string[]
  onDoor: (door: DoorEntry) => void
  onOpenDocument: (path: string) => void
  onMap: () => void
  /** Opens the person's own timesheet day. */
  onTimesheet?: () => void
  /** Opens the agency's setup flow: offered to an admin while a step is still to do. */
  onSetup?: () => void
  /** An admin's own pages: the people and roles, and the audit view. */
  onAdmin?: (page: 'people' | 'audit') => void
  /** The role switcher (admins and demos): another role's home, or null for your own. */
  onSwitch: (role: string | null) => void
}

export function Home({ view, items, jobNeeds = [], nextDeadline, onNeedsChanged, first, apps, onDoor, onOpenDocument, onMap, onTimesheet, onSetup, onAdmin, onSwitch }: Props) {
  // Asked once, here, at the person's first sign-in: only a signed-in person has a timesheet to ask about.
  const consent = useConsent()
  const top = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)
  // The heading takes focus on arrival, so a keyboard or a screen reader lands on it.
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])

  // The last word keeps the period dot with it, so the dot never wraps alone onto a line.
  const greet = hello(first)
  const cut = greet.lastIndexOf(' ')
  const served = useMemo(() => needsRows(items, jobNeeds), [items, jobNeeds])
  // A Done leaves the row in place for five seconds with Undo; the server has the mark already, so the row is held here
  // (and a restored row too, until the server's list has it back).
  const [held, setHeld] = useState<Record<string, { row: NeedRow; state: 'done' | 'back' }>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])
  const drop = useCallback((id: string) => {
    clearTimeout(timers.current[id]); delete timers.current[id]
    setHeld(h => { const { [id]: _gone, ...rest } = h; return rest })
  }, [])
  const done = (row: NeedRow) => {
    const id = row.id
    if (!id) return
    setHeld(h => ({ ...h, [id]: { row, state: 'done' } }))
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => drop(id), UNDO_MS)
    void markNeedDone(id).then(ok => { if (!ok) drop(id); onNeedsChanged?.() })
  }
  const undo = (id: string) => {
    clearTimeout(timers.current[id]); delete timers.current[id]
    setHeld(h => (h[id] ? { ...h, [id]: { ...h[id], state: 'back' } } : h))
    // a restored row is held until the server's list has it again, and no longer than the undo window
    timers.current[id] = setTimeout(() => drop(id), UNDO_MS)
    void undoNeedDone(id).then(() => { onNeedsChanged?.() })
  }
  const needs = useMemo(
    () => orderNeeds<NeedRow>([...served, ...Object.values(held).map(h => h.row).filter(r => !served.some(x => x.id === r.id))]),
    [served, held],
  )
  const remaining = needs.filter(n => !(n.id && held[n.id]?.state === 'done')).length
  const { shown } = firstNeeds(needs, all)
  const open = (n: NeedRow) => {
    if (n.kind === 'timesheet') onTimesheet?.()
    else if (n.path) onOpenDocument(n.path)
    else if (n.job) window.location.assign(n.job.href)
    else onDoor({ id: 'approvals', name: 'Approvals' })
  }

  return (
    <div className="nui nui-page" ref={top} data-testid="home" data-role={view.viewing ?? view.roles.join(' ')}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow" data-testid="home-eyebrow">{homeEyebrow(view).toUpperCase()}</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="home-title">{greet.slice(0, cut + 1)}<span className="hm-nb">{greet.slice(cut + 1)}<span className="period-dot" aria-hidden /></span></h1>
            <p className="hero-sub" data-testid="home-sub">{needsLine(remaining)}</p>
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
            {onAdmin && view.roles.includes('admin') && !view.viewing && (
              <>
                <button type="button" className="side-link" data-testid="open-people" onClick={() => onAdmin('people')}>Your people and their roles</button>
                <button type="button" className="side-link" data-testid="open-audit" onClick={() => onAdmin('audit')}>The audit view</button>
              </>
            )}
            {onTimesheet && consent !== null && <button type="button" className="side-link" data-testid="open-timesheet" onClick={onTimesheet}>Your timesheet</button>}
          </div>
        </section>

        <main className="hm-main">
          {consent === 'not_asked' && <Ask variant="card" onTimesheet={onTimesheet} />}
          {onSetup && view.roles.includes('admin') && !view.viewing && <SetupCard onOpen={onSetup} />}
          <section className="hm-sec" aria-labelledby="hm-needs">
            <h2 className="hm-h" id="hm-needs">Needs you</h2>
            {needs.length === 0 ? (
              <p className="nui-empty hm-none" data-testid="needs-empty">{emptyLine(nextDeadline)}</p>
            ) : (
              <ul className="hm-needs" data-testid="needs-you">
                {shown.map(n => {
                  const h = n.id ? held[n.id] : undefined
                  if (h?.state === 'done') {
                    return (
                      <li key={n.id} className="hm-need hm-need-done" data-testid="need-done" data-done-id={n.id}>
                        <span className="hm-need-what"><b>Done</b><small>{n.title}</small></span>
                        <span className="hm-need-acts"><button type="button" className="btn-rect" onClick={() => undo(n.id!)}>Undo</button></span>
                      </li>
                    )
                  }
                  return (
                    <li key={n.id ?? n.path} className="hm-need" data-testid="need" data-id={n.id} data-kind={n.kind} data-due={n.due ?? ''} data-urgent={n.urgent || undefined}>
                      <span className="hm-need-what"><b>{n.title}</b>
                        <small>{n.job ? <><a className="side-link" href={n.job.href} data-testid="need-job">{n.job.number}</a>{n.sub.slice(n.job.number.length)}</> : n.sub}</small></span>
                      <span className="hm-need-state">{n.state}</span>
                      <span className="hm-need-acts">
                        <button type="button" className="btn-rect" onClick={() => open(n)}>{n.action}</button>
                        {n.canDone && n.id && <button type="button" className="side-link hm-done" aria-label={`Done: ${n.title}`} onClick={() => done(n)}>Done</button>}
                      </span>
                    </li>
                  )
                })}
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
