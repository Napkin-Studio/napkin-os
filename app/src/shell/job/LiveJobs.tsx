// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Live jobs door (v2 section 4; features/job-page.clan): every job in flight, soonest deadline first, a
// job with none last, each row a link to its page (`#job-<number>`). A person who may open a job has one
// button for it here: client, title, deadline (and the budget in hours for the Money roles). With no job it
// is the Empty state, whose one verb is Open a job. The list is the server's, cut to this role's fields, and
// stays current by itself like the dashboard.

import { useState } from 'react'
import { jobsView, openJob, type JobSaved } from '../../host/http'
import type { ClientRecord, JobEntry, JobRights } from '../../host/types'
import { Empty, FailedSave, Loading, MissingAccess } from '../../components/states/ScreenStates'
import { clientName } from '../nui/deskData'
import { useLiveRead } from '../home/useLiveRead'
import type { Route } from '../route'
import { formatRoute } from '../route'
import { dueLine, orderLive, saveOutcome, stageLine, waitingLine } from './jobModel'
import './job.css'

type Open = (body: { client_id: string; title?: string; due?: string; budget_hours?: number }) => Promise<JobSaved & { number?: string }>

export function LiveJobs({ clients, rights, go }: { clients: readonly ClientRecord[]; rights: JobRights | null; go: (r: Route) => void }) {
  const { value, ready, reload } = useLiveRead(jobsView, true, null)
  return <LiveJobsBody jobs={value} ready={ready} clients={clients} rights={rights} go={go} reload={reload} open={openJob} />
}

export function LiveJobsBody({ jobs, ready, clients, rights, go, reload, open }: {
  jobs: JobEntry[] | null
  ready: boolean
  clients: readonly ClientRecord[]
  rights: JobRights | null
  go: (r: Route) => void
  reload: () => void
  open: Open
}) {
  const [opening, setOpening] = useState(false)
  if (!ready) return <Loading what="the live jobs" rows={3} />
  const example = { title: 'Example · Client A, an Irish whiskey', lines: ['J001, Client A. Brief check, due 18 Dec. Waiting on the creative director.'] }
  if (jobs === null) {
    return <Empty line="The live jobs cannot be read just now." verb="Open a job" example={example} reason="The server did not answer. It tries again by itself." />
  }
  const may = !!rights?.manage
  const form = opening && may
    ? <OpenForm clients={clients} mayBudget={rights?.budget ?? false} open={open} onDone={n => { setOpening(false); reload(); if (n) go({ level: 'job', number: n }) }} onCancel={() => setOpening(false)} />
    : null

  if (jobs.length === 0) {
    return (
      <div className="jp-live" data-testid="live-jobs">
        {form ?? (
          <Empty
            line="Every job in flight goes here."
            example={example}
            verb="Open a job"
            onStart={may ? () => setOpening(true) : undefined}
            reason={may ? undefined : 'Planning, account service, management and producers open jobs.'}
          />
        )}
      </div>
    )
  }

  return (
    <div className="jp-live" data-testid="live-jobs">
      <ul className="jp-list" data-testid="live-job-list">
        {orderLive(jobs).map(j => (
          <li key={j.number} data-job={j.number} data-stage={j.stage.id} data-testid="live-job">
            <a className="jp-row" href={formatRoute({ level: 'job', number: j.number })} data-testid="live-job-link">
              <span className="jp-row-id">{j.number}</span>
              <span className="jp-row-what"><b>{j.title}</b><small>{j.client.name}</small></span>
              <span className="jp-row-stage">{stageLine(j)}</span>
              <span className="jp-row-due" data-late={j.at_risk || undefined}>{dueLine(j)}</span>
              <span className="jp-row-wait">{waitingLine(j)}</span>
            </a>
          </li>
        ))}
      </ul>
      {form}
      {may && !opening && <div className="jp-act"><button type="button" className="ch-btn" data-testid="open-a-job" onClick={() => setOpening(true)}>Open a job</button></div>}
      {!may && rights && <p className="jp-note" data-testid="live-no-open">Planning, account service, management and producers open jobs.</p>}
    </div>
  )
}

function OpenForm({ clients, mayBudget, open, onDone, onCancel }: {
  clients: readonly ClientRecord[]
  mayBudget: boolean
  open: Open
  onDone: (number?: string) => void
  onCancel: () => void
}) {
  const [client, setClient] = useState(clients[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = async () => {
    if (!client) { setProblem('Pick the client the job is for.'); return }
    if (mayBudget && budget.trim() !== '' && !(Number(budget) >= 0)) { setProblem('The budget is a number of hours.'); return }
    setBusy(true); setProblem(null); setFailed(false)
    const r = await open({
      client_id: client,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(due ? { due } : {}),
      ...(mayBudget && budget.trim() !== '' ? { budget_hours: Number(budget) } : {}),
    })
    setBusy(false)
    const out = saveOutcome(r)
    if (out === 'saved') onDone(r.ok ? r.number : undefined)
    else if (out === 'refused') setRefused(true)
    else if (out === 'problem' && !r.ok) setProblem(r.message || 'The server did not accept that.')
    else setFailed(true)
  }

  if (refused) return <MissingAccess what="opening a job" who="Account service" />
  if (clients.length === 0) return <Empty compact line="A job is opened for a client." verb="Open the clients" example={{ title: 'Example · Client A, an Irish whiskey', lines: ['Client A, an Irish whiskey. One live job, J001.'] }} onStart={onCancel} />
  return (
    <form className="jp-edit" data-testid="open-job-form" onSubmit={e => { e.preventDefault(); void run() }} aria-label="Open a job">
      <label className="jp-f"><span>Client</span>
        <select data-testid="open-f-client" value={client} onChange={e => setClient(e.target.value)}>
          {clients.map(c => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
        </select>
      </label>
      <label className="jp-f"><span>Title</span><input data-testid="open-f-title" value={title} maxLength={80} placeholder="Autumn launch" onChange={e => setTitle(e.target.value)} /></label>
      <label className="jp-f"><span>Deadline</span><input data-testid="open-f-due" type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
      {mayBudget && <label className="jp-f"><span>Budget in hours</span><input data-testid="open-f-budget" type="number" min={0} step="any" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label>}
      {problem && <p className="jp-problem" role="alert" data-testid="open-problem">{problem}</p>}
      {failed && <FailedSave primary={false} compact busy={busy} onRetry={() => { void run() }} />}
      <div className="jp-act">
        <button type="submit" className="ch-btn ch-btn-primary jp-save" data-testid="open-save" aria-disabled={busy || undefined}>Open the job</button>
        <button type="button" className="ch-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
