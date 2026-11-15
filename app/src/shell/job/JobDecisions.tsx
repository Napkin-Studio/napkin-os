// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A job's Decisions (features/align-confidential-prices.clan, done_when line 12): the decisions of the job's own
// chain, newest first, drawn as the Decisions drawer draws a document's (the same drawer, head and rows). It is the
// one place a budget is read and recorded: a Money role that manages jobs records it here ("Record the budget"), as a
// set_budget decision, and no figure sits on the job page. A role that is not sent the hours is sent no budget line
// at all (crates/napkin-web/src/api.rs, job_decisions). A run's cost is read the same way, in each document's own
// Decisions drawer.

import { useCallback, useEffect, useState } from 'react'
import { jobDecisions, recordBudget, type JobSaved } from '../../host/http'
import type { JobDecisionRow, JobDecisionsView } from '../../host/types'
import { LogoSpinner } from '../../brand/LogoSpinner'
import { budgetWords } from '../decisions/words'
import '../decisions/DecisionPanel.css'

/** `2026-11-13T09:30:00Z` as `13 Nov, 09:30`. */
function when(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** A person's sign-in (`cian@wk`) as a first name; anything else as it is. */
function nameOf(who: string): string {
  const at = /^([^@\s]+)@[^@\s]+$/.exec(who)
  if (!at) return who
  return at[1].split(/[._-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** One line: a budget in the words the drawer uses for one, anything else in the words the host wrote. */
const lineOf = (row: JobDecisionRow): string =>
  row.kind === 'set_budget' ? `${nameOf(row.who)} ${budgetWords({ hours: row.hours ?? undefined })}` : row.what

export function JobDecisions({ number, title, onClose }: { number: string; title: string; onClose: () => void }) {
  const [view, setView] = useState<JobDecisionsView | null | 'failed'>(null)
  const read = useCallback(() => { void jobDecisions(number).then(v => setView(v ?? 'failed')) }, [number])
  useEffect(() => { read() }, [read])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const onRecord = async (hours: number) => {
    const r = await recordBudget(number, hours)
    if (r.ok) read()
    return r
  }
  return <JobDecisionsBody view={view} title={title} onClose={onClose} onRecord={onRecord} />
}

export function JobDecisionsBody({ view, title, onClose, onRecord }: {
  view: JobDecisionsView | null | 'failed'
  title: string
  onClose: () => void
  onRecord: (hours: number) => Promise<JobSaved>
}) {
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const record = async () => {
    const n = Number(hours)
    if (hours.trim() === '' || !Number.isFinite(n) || n < 0) { setProblem('Give the hours as a number, not below zero.'); return }
    setBusy(true); setProblem(null)
    const r = await onRecord(n)
    setBusy(false)
    if (r.ok) setHours('')
    else setProblem(r.status === 403 ? 'Only account service, management and producers record a budget.' : r.message || 'That did not save. Try again.')
  }

  return (
    <div className="nui">
      <div className="dtree-backdrop" onClick={onClose} aria-hidden />
      <aside className="dtree-drawer" aria-label="Decisions" role="dialog" data-testid="job-decisions">
        <header className="dtree-head">
          <div>
            <div className="sec-num" style={{ margin: 0 }}>DECISIONS</div>
            <h3 style={{ font: '800 18px/1.2 var(--font-ui)' }}>{title}</h3>
          </div>
          <button type="button" className="btn-rect" style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }} onClick={onClose} aria-label="Close decisions">Close</button>
        </header>
        <div className="dtree-body">
          {view === null ? <div className="dp-loading" data-state="loading"><LogoSpinner label="Reading what happened" /></div>
            : view === 'failed' ? <p className="nui-empty">The decisions could not be read just now.</p>
            : (
              <>
                {view.can_record_budget && (
                  <form className="dtree-call-card" data-testid="job-budget-form" aria-label="Record the budget" onSubmit={e => { e.preventDefault(); void record() }}>
                    <b style={{ fontSize: 13.5 }}>Record the budget</b>
                    <label className="jp-f"><span>Hours</span>
                      <input data-testid="job-budget-hours" type="number" min={0} step="any" inputMode="decimal" value={hours} onChange={e => { setHours(e.target.value); setProblem(null) }} />
                    </label>
                    {problem && <p className="dp-err" role="alert" data-testid="job-budget-problem">{problem}</p>}
                    <div><button type="submit" className="ch-btn" data-primary data-testid="job-budget-save" aria-disabled={busy || undefined}>Record the budget</button></div>
                  </form>
                )}
                <div className="p33-dlist">
                  <h5>What happened, newest first</h5>
                  {view.decisions.length === 0 && <p className="nui-empty">Nothing has been decided on this job yet.</p>}
                  {view.decisions.map((d, i) => (
                    <div className="p33-drow" key={d.id ?? i} data-testid="job-decision-row" data-kind={d.kind ?? undefined}>
                      <div className="dr-top"><b>{lineOf(d)}</b></div>
                      <span className="dr-who">{[nameOf(d.who), when(d.at)].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
        </div>
      </aside>
    </div>
  )
}
