// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Approvals door of account service's home (v2 sections 4 and 6; features/approval-route.clan): for
// each live job, who it waits on and for how long, its route as a strip, and a way to name the route.
// Everything shown is read from the job index, which reads the documents' own decisions: an approval
// cannot be typed in here. It never scores a person: it names who holds a job, not how fast anyone is.
//
// The states that apply to a read-and-save page are drawn with the shell's own: Loading while the index
// answers, Empty with no job or no route, Missing access when the server refuses a route to this role,
// Failed save when the save did not arrive, and Normal. A page with no run and no brief of its own has
// no Run failed, Long run, Changed brief or Not right.

import { useState } from 'react'
import { jobsView, setJobRoute } from '../../host/http'
import type { JobEntry, RouteStep } from '../../host/types'
import { Empty, FailedSave, Loading, MissingAccess } from '../../components/states/ScreenStates'
import type { Route } from '../route'
import { useLiveRead } from '../home/useLiveRead'
import { draftOf, holderLine, orderJobs, outcomeOf } from './approvalsModel'
import { RouteEditor } from './RouteEditor'
import { RouteStrip } from './RouteStrip'
import './approvals.css'

export function ApprovalsPage({ go }: { go: (r: Route) => void }) {
  const { value, ready, reload } = useLiveRead(jobsView, true, null)
  return <ApprovalsBody jobs={value} ready={ready} go={go} reload={reload} save={setJobRoute} />
}

type Save = (number: string, steps: RouteStep[]) => ReturnType<typeof setJobRoute>

/** The page for what the server last said, and for the save it is given. */
export function ApprovalsBody({ jobs, ready, go, reload, save }: { jobs: JobEntry[] | null; ready: boolean; go: (r: Route) => void; reload: () => void; save: Save }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [failed, setFailed] = useState<{ job: string; steps: RouteStep[] } | null>(null)

  const run = async (job: string, steps: RouteStep[]) => {
    setBusy(true)
    setProblem(null)
    setFailed(null)
    const r = await save(job, steps)
    setBusy(false)
    const out = outcomeOf(r)
    if (out === 'saved') { setEditing(null); setRefused(false); reload() }
    else if (out === 'refused') { setRefused(true); setEditing(null) }
    else if (out === 'problem' && !r.ok) setProblem(r.message)
    else setFailed({ job, steps })
  }

  if (!ready) return <Loading what="the approvals" rows={3} />
  if (jobs === null) {
    return <Empty line="The approvals cannot be read just now." verb="Open the clients" example={{ title: 'Example · Client A, an Irish whiskey', lines: ['J001 waits on the creative director. Brief check, due 14 Nov.'] }} onStart={() => go({ level: 'clients' })} reason="The server did not answer. It tries again by itself." />
  }
  if (jobs.length === 0) {
    return (
      <Empty
        line="Who approves each stage of a job, and by when, goes here once a job is open."
        example={{ title: 'Example · Client A, an Irish whiskey', lines: ['J001: the planner signs by 13 Nov, the creative director by 14 Nov, Client A by 20 Nov.'] }}
        verb="Open the clients"
        onStart={() => go({ level: 'clients' })}
      />
    )
  }

  return (
    <div className="ap" data-testid="approvals">
      {refused && <MissingAccess what="the approval route" who="Account service" />}
      {orderJobs(jobs).map(j => (
        <section key={j.number} className="ap-job" data-testid="approval-job" data-job={j.number} aria-labelledby={`ap-${j.number}`}>
          <h2 className="hm-h" id={`ap-${j.number}`}>{j.number}, {j.client.name}</h2>
          {j.holder ? (
            <p className="ap-holder" data-testid="holder" data-late={j.holder.days_late > 0 || undefined}>{holderLine(j.holder)}</p>
          ) : (
            <p className="ap-holder" data-testid="holder">{j.route.length > 0 ? 'Every step is approved.' : 'No route yet. Nobody is named to approve this job.'}</p>
          )}
          <RouteStrip route={j.route} label={`Approval route for ${j.number}`} />
          {editing === j.number ? (
            <>
              <RouteEditor job={j.number} initial={draftOf(j.route)} busy={busy} problem={problem} onSave={steps => { void run(j.number, steps) }} onCancel={() => { setEditing(null); setProblem(null); setFailed(null) }} />
              {failed?.job === j.number && <FailedSave primary={false} compact busy={busy} onRetry={() => { void run(failed.job, failed.steps) }} />}
            </>
          ) : (
            <div className="ap-act"><button type="button" className={`ch-btn ap-primary${j.route.length > 0 ? '' : ' ch-btn-primary'}`} data-testid="route-edit" onClick={() => { setEditing(j.number); setProblem(null); setFailed(null) }}>{j.route.length > 0 ? 'Change the route' : 'Set the route'}</button></div>
          )}
        </section>
      ))}
    </div>
  )
}
