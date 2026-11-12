// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One job, opened (v2 section 2, the job file; features/job-page.clan): where it is, who holds it and for
// how long, its dates, the route, and every document filed under it. It draws the job index and nothing
// else, so it cannot drift from the documents: the stage is read from their decisions, never typed in. It
// reads through the same live read as the dashboard, so a stage change shows without a reload.
//
// What a role sees is the server's: the job arrives already cut to that role's allowed fields, so the
// budget in hours is simply absent for a role that is not sent it. The change form shows only what the
// server says this person may change, and the server refuses the write in any case.
//
// States (v2 section 4): Loading, Empty (a job that is not here), Missing access, Changed brief (a signed
// brief moved on), Failed save, and Normal with one primary button: the person's next action on this job.
// Nothing here scores a person: it names who holds the job, never how fast anyone is.

import { useEffect, useRef, useState } from 'react'
import { jobView, updateJob, type JobSaved } from '../../host/http'
import type { JobPatch, JobView } from '../../host/types'
import { ChangedBrief, Empty, FailedSave, Loading, MissingAccess, Normal } from '../../components/states/ScreenStates'
import { dueWords } from '../home/model'
import { useLiveRead } from '../home/useLiveRead'
import { RouteStrip } from '../approvals/RouteStrip'
import { ClientRound } from '../clientReview/RoundView'
import type { Route } from '../route'
import { budgetLine, changedBriefOf, docLine, dueLine, formOf, formProblem, nextNeed, patchOf, saveOutcome, stageLine, waitingLine, type JobForm } from './jobModel'
import './job.css'

interface Props {
  number: string
  go: (r: Route) => void
  /** Open a document of this job; the way back from it returns here. */
  onOpenDocument: (path: string) => void
  /** Where Back goes: Live jobs for a person who has the door, the client desk otherwise. */
  back: { route: Route; label: string }
}

export function JobPage({ number, go, onOpenDocument, back }: Props) {
  const top = useRef<HTMLDivElement>(null)
  // One live read per job: the page is keyed by its number where it is drawn, so a new number is a new read.
  const { value, ready, reload } = useLiveRead(() => jobView(number), true, null as JobView | 'missing' | 'forbidden' | null)
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [number, ready])
  return <JobBody number={number} value={value} ready={ready} go={go} onOpenDocument={onOpenDocument} back={back} reload={reload} save={updateJob} top={top} />
}

type Save = (number: string, patch: JobPatch) => Promise<JobSaved>

export function JobBody({ number, value, ready, go, onOpenDocument, back, reload, save, top }: {
  number: string
  value: JobView | 'missing' | 'forbidden' | null
  ready: boolean
  go: (r: Route) => void
  onOpenDocument: (path: string) => void
  back: { route: Route; label: string }
  reload: () => void
  save: Save
  top?: React.RefObject<HTMLDivElement | null>
}) {
  const view = value !== null && typeof value === 'object' ? value : null
  const job = view?.job
  const title = job ? job.title : number
  return (
    <div className="nui nui-page jp-page" ref={top} data-testid="job-page" data-job={number}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">{job ? `JOB · ${job.client.name}` : 'JOB'}</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="job-title">{title}<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub" data-testid="job-number">{number}</p>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="job-back" onClick={() => go(back.route)}>{back.label}</button></div>
        </section>
        <main className="hm-main">
          {!ready ? <Loading what="the job" rows={3} />
            : value === 'missing' ? (
              <Empty
                line="This job is not in your agency."
                example={{ title: 'Example · Client A, an Irish whiskey', lines: ['J001 is in Brief check. Waiting for signatures.'] }}
                verb="Go to Live jobs"
                onStart={() => go(back.route)}
              />
            ) : value === 'forbidden' ? <MissingAccess what="this job" who="Account service" />
            : !view || !job ? (
              <Empty line="The job cannot be read just now." verb="Go to Live jobs" example={{ title: 'Example · Client A, an Irish whiskey', lines: ['J001 is in Brief check. Waiting for signatures.'] }} onStart={() => go(back.route)} reason="The server did not answer. It tries again by itself." />
            ) : <JobFile view={view} go={go} onOpenDocument={onOpenDocument} reload={reload} save={save} />}
        </main>
      </div>
    </div>
  )
}

/** The documents a client reviews through a link (their clean specs, crates/napkin-host/src/ops/client_pieces.rs). */
const CLIENT_REVIEWED = ['ie.napkin.brief-maker', 'ie.napkin.visual-brief', 'ie.napkin.script-editor']

function JobFile({ view, go, onOpenDocument, reload, save }: { view: JobView; go: (r: Route) => void; onOpenDocument: (path: string) => void; reload: () => void; save: Save }) {
  const { job, needs, can } = view
  const [editing, setEditing] = useState(false)
  const changed = changedBriefOf(job)
  const need = nextNeed(needs, job.number)
  const budget = budgetLine(job)

  const work = (
    <div className="jp" data-testid="job-file">
      <section className="jp-where" aria-labelledby="jp-where-h">
        <h2 className="hm-h" id="jp-where-h">Where it is</h2>
        <p className="jp-stage" data-testid="job-stage" data-stage={job.stage.id}>{stageLine(job)}</p>
        <p className="jp-status" data-testid="job-status">{job.status}</p>
        <p className="jp-holder" data-testid="job-holder" data-late={(job.holder?.days_late ?? 0) > 0 || job.at_risk || undefined}>{waitingLine(job)}</p>
      </section>

      <dl className="jp-facts" data-testid="job-facts">
        <div><dt>Client</dt><dd>{job.client.name}</dd></div>
        <div><dt>Owner</dt><dd>{job.owner}</dd></div>
        <div><dt>Opened</dt><dd>{dueWords(job.opened_on)}</dd></div>
        <div><dt>Deadline</dt><dd data-testid="job-due" data-late={job.at_risk || undefined}>{dueLine(job).replace(/^Due /, '')}</dd></div>
        {budget !== null && <div><dt>Budget</dt><dd data-testid="job-budget">{budget}</dd></div>}
      </dl>

      {changed && (
        <ChangedBrief
          from={changed.from}
          to={changed.to}
          changes="The signed version stays as it was; the new one needs signing."
          onUpdate={() => onOpenDocument(changed.doc.path)}
        />
      )}

      {job.route.length > 0 && (
        <section className="jp-sec" aria-labelledby="jp-route-h">
          <h2 className="hm-h" id="jp-route-h">Approval route</h2>
          <RouteStrip route={job.route} label={`Approval route for ${job.number}`} />
        </section>
      )}

      <section className="jp-sec" aria-labelledby="jp-docs-h">
        <h2 className="hm-h" id="jp-docs-h">Documents</h2>
        {job.documents.length === 0 ? (
          <Empty compact line="Nothing is filed under this job yet." verb="Open the client" example={{ title: 'Example · Client A, an Irish whiskey', lines: ['J001 holds its brief, its research and its deck.'] }} onStart={() => go({ level: 'client', client: job.client.id })} />
        ) : (
          <ul className="jp-docs" data-testid="job-documents">
            {job.documents.map(d => (
              <li key={d.path} className="jp-doc" data-testid="job-document" data-app={d.app_id ?? undefined}>
                <span className="jp-doc-what"><b>{d.title || 'Untitled'}</b><small>{docLine(d)}</small></span>
                <button type="button" className="ch-btn" data-testid="job-open-document" aria-label={`Open ${d.title || 'Untitled'}`} onClick={() => onOpenDocument(d.path)}>Open</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {job.documents.filter(d => d.locked && !d.changed_since_lock && CLIENT_REVIEWED.includes(d.app_id ?? '')).map(d => (
        <section key={d.path} className="jp-sec" aria-label={`Client review of ${d.title || 'Untitled'}`} data-testid="job-client-round">
          <ClientRound doc={d.path} />
        </section>
      ))}

      {can.manage && (editing
        ? <JobEditor job={job} mayBudget={can.budget} save={save} onDone={() => { setEditing(false); reload() }} onCancel={() => setEditing(false)} />
        : <div className="jp-act"><button type="button" className="ch-btn" data-testid="job-edit" data-primary onClick={() => setEditing(true)}>Change this job</button></div>)}
    </div>
  )

  return (
    <Normal
      title={`${job.number}, ${job.title}`}
      work={work}
      next={need ? { label: need.action, primary: !changed, onPress: () => onOpenDocument(need.path) } : undefined}
    />
  )
}

function JobEditor({ job, mayBudget, save, onDone, onCancel }: { job: JobView['job']; mayBudget: boolean; save: Save; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<JobForm>(() => formOf(job))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [failed, setFailed] = useState(false)
  const set = (k: keyof JobForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const run = async () => {
    const wrong = formProblem(form, mayBudget)
    if (wrong) { setProblem(wrong); return }
    const patch = patchOf(job, form, mayBudget)
    if (!patch) { onCancel(); return }
    setBusy(true); setProblem(null); setFailed(false)
    const r = await save(job.number, patch)
    setBusy(false)
    const out = saveOutcome(r)
    if (out === 'saved') onDone()
    else if (out === 'refused') setRefused(true)
    else if (out === 'problem' && !r.ok) setProblem(r.message || 'The server did not accept that.')
    else setFailed(true)
  }

  if (refused) return <MissingAccess what="changing this job" who="Account service" />
  return (
    <form className="jp-edit" data-testid="job-editor" onSubmit={e => { e.preventDefault(); void run() }} aria-label={`Change ${job.number}`}>
      <label className="jp-f"><span>Title</span><input data-testid="job-f-title" value={form.title} onChange={set('title')} maxLength={80} /></label>
      <label className="jp-f"><span>Owner</span><input data-testid="job-f-owner" value={form.owner} onChange={set('owner')} /></label>
      <label className="jp-f"><span>Deadline</span><input data-testid="job-f-due" type="date" value={form.due} onChange={set('due')} /></label>
      {mayBudget && <label className="jp-f"><span>Budget in hours</span><input data-testid="job-f-budget" type="number" min={0} step="any" inputMode="decimal" value={form.budget} onChange={set('budget')} /></label>}
      {problem && <p className="jp-problem" role="alert" data-testid="job-problem">{problem}</p>}
      {failed && <FailedSave primary={false} compact busy={busy} onRetry={() => { void run() }} />}
      <div className="jp-act">
        <button type="submit" className="ch-btn jp-save" data-testid="job-save" aria-disabled={busy || undefined}>Save the change</button>
        <button type="button" className="ch-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
