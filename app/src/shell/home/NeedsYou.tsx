// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Needs you, lifted whole out of the role home when the home went (features/align-landing-look.clan): the
// pick-up rows for what the job index asks of this person, each with its next action, Done and Undo. It is
// drawn on the desk for a person with a role, under their pages. It is unchanged in behaviour; the one settle
// list on the desk is the next record's (align-needs-lock-people), which replaces this component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markNeedDone, undoNeedDone } from '../../host/http'
import type { JobNeed, LibraryItem, NextDeadline } from '../../host/types'
import { emptyLine, firstNeeds, needsRows, orderNeeds, UNDO_MS, type NeedRow } from './model'
import './home.css'

interface Props {
  items: readonly LibraryItem[]
  /** What the job index asks of this person, by deadline. */
  jobNeeds?: readonly JobNeed[]
  /** The next deadline on this person's jobs, for the empty list; undefined from an older host. */
  nextDeadline?: NextDeadline | null
  /** Asks the server for the list again at once: after a Done or an Undo. */
  onNeedsChanged?: () => void
  onOpenDocument: (path: string) => void
  /** Opens the person's own timesheet day. */
  onTimesheet?: () => void
  /** Opens the Approvals page, for a need that has no document of its own. */
  onApprovals: () => void
}

export function NeedsYou({ items, jobNeeds = [], nextDeadline, onNeedsChanged, onOpenDocument, onTimesheet, onApprovals }: Props) {
  const [all, setAll] = useState(false)
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
  const { shown } = firstNeeds(needs, all)
  const open = (n: NeedRow) => {
    if (n.kind === 'timesheet') onTimesheet?.()
    else if (n.path) onOpenDocument(n.path)
    else if (n.job) window.location.assign(n.job.href)
    else onApprovals()
  }

  return (
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
  )
}
