// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Naming a job's route: one row per step, with the stage, who approves, the date, and for a client step
// the contact and the rounds. Account service and management only; the server says no to anyone else
// (the page then shows Missing access). It sends what was typed and takes the server's sentence back
// when a step is wrong: the route is checked in one place, on the host.

import { useState } from 'react'
import type { RouteStep } from '../../host/types'
import { blankStep, cleanSteps, missingIn, STAGE_CHOICES } from './approvalsModel'
import './approvals.css'

interface Props {
  job: string
  initial: readonly RouteStep[]
  busy: boolean
  /** The server's own sentence about a step it refused. */
  problem: string | null
  onSave: (steps: RouteStep[]) => void
  onCancel: () => void
}

export function RouteEditor({ job, initial, busy, problem, onSave, onCancel }: Props) {
  const [rows, setRows] = useState<RouteStep[]>(() => initial.map(r => ({ ...r })))
  const [ask, setAsk] = useState<string | null>(null)
  const set = (i: number, patch: Partial<RouteStep>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const save = () => {
    const miss = missingIn(rows)
    setAsk(miss)
    if (!miss) onSave(cleanSteps(rows))
  }
  const line = ask ?? problem
  return (
    <form className="re" data-testid="route-editor" aria-label={`Route for ${job}`} onSubmit={e => { e.preventDefault(); save() }}>
      {rows.map((r, i) => {
        const client = r.party === 'client'
        const id = `re-${job}-${i}`
        return (
          <fieldset key={i} className="re-row" data-testid="route-row">
            <legend className="re-legend">Step {i + 1}</legend>
            <label className="re-f" htmlFor={`${id}-stage`}><span>Stage</span>
              <select id={`${id}-stage`} value={r.stage} onChange={e => set(i, { stage: e.target.value })}>
                {STAGE_CHOICES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="re-f" htmlFor={`${id}-party`}><span>Who approves</span>
              <select id={`${id}-party`} value={r.party} onChange={e => set(i, { party: e.target.value as RouteStep['party'] })}>
                <option value="agency">Someone here</option>
                <option value="client">The client</option>
              </select>
            </label>
            <label className="re-f" htmlFor={`${id}-role`}><span>Role</span>
              <input id={`${id}-role`} list={`${id}-roles`} value={r.role ?? ''} onChange={e => set(i, { role: e.target.value })} placeholder="planner" />
              <datalist id={`${id}-roles`}><option value="planner" /><option value="creative_director" /></datalist>
            </label>
            <label className="re-f" htmlFor={`${id}-who`}><span>{client ? 'Approver name' : 'Approver sign-in'}</span>
              <input id={`${id}-who`} value={r.approver} onChange={e => set(i, { approver: e.target.value })} placeholder={client ? 'Client A contact' : 'dara@wk'} autoComplete="off" />
            </label>
            <label className="re-f" htmlFor={`${id}-due`}><span>Due</span>
              <input id={`${id}-due`} type="date" value={r.due} onChange={e => set(i, { due: e.target.value })} />
            </label>
            {client && (
              <>
                <label className="re-f" htmlFor={`${id}-contact`}><span>Client email</span>
                  <input id={`${id}-contact`} type="email" value={r.contact ?? ''} onChange={e => set(i, { contact: e.target.value })} placeholder="contact@client.example" autoComplete="off" />
                </label>
                <label className="re-f" htmlFor={`${id}-rounds`}><span>Rounds of changes</span>
                  <input id={`${id}-rounds`} type="number" min={1} max={20} value={r.rounds ?? ''} onChange={e => set(i, { rounds: e.target.value ? Number(e.target.value) : null })} />
                </label>
              </>
            )}
            {rows.length > 1 && <button type="button" className="side-link re-remove" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>Remove step {i + 1}</button>}
          </fieldset>
        )
      })}
      <div className="re-more"><button type="button" className="side-link" data-testid="route-add" onClick={() => setRows(rs => [...rs, blankStep(rs.at(-1)?.stage)])}>Add a step</button></div>
      {line && <p className="re-problem" role="alert" data-testid="route-problem">{line}</p>}
      <div className="re-act">
        <button type="submit" className="ch-btn ch-btn-primary ap-primary" data-testid="route-save" aria-disabled={busy || undefined}>Save the route</button>
        <button type="button" className="ch-btn ap-primary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
