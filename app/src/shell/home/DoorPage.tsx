// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One page door, opened: a page of the agency (Dashboard, Live jobs, Approvals, Judge scores). A door with no
// page yet opens develop's SoonCard (shell/SoonCard.tsx), carrying that door's own line, verb and finished
// example from components/states/doors.ts, never an error and never a blank box (v2 section 8), and one way
// back to the desk. A door that opens a document of a client is a tool, not a door: it lives in
// landing/tools.ts and the Dial (features/align-landing-look.clan).

import { useEffect, useRef } from 'react'
import type { ClientRecord, JobRights } from '../../host/types'
import { SoonCard } from '../SoonCard'
import { teaserFor } from './doorWords'
import type { Route } from '../route'
import { Dashboard } from './Dashboard'
import { ApprovalsPage } from '../approvals/ApprovalsPage'
import { LiveJobs } from '../job/LiveJobs'
import { JudgeScoresPage } from '../judge/JudgeScoresPage'
import '../Launcher.css'
import './home.css'

interface Props {
  door: string
  /** The door's words as the desk's row gave them, else the Empty content's name. */
  name: string | null
  clients: readonly ClientRecord[]
  /** What this person may do with jobs (the role view's): who gets the Open a job button. */
  rights?: JobRights | null
  go: (r: Route) => void
}

export function DoorPage({ door, name, clients, rights = null, go }: Props) {
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [door])
  const teaser = teaserFor(door, name, rights?.read_budget)

  let body
  if (door === 'agency-dashboard') {
    // The dashboard reads the job index, behind the server's role check (a door of Management's row).
    body = <Dashboard go={go} />
  } else if (door === 'approvals') {
    // Who approves each stage and by when, who holds each job and for how long: read from the job index.
    body = <ApprovalsPage go={go} />
  } else if (door === 'live-jobs') {
    // Every live job, soonest deadline first, each row its page (features/job-page.clan).
    body = <LiveJobs clients={clients} rights={rights} go={go} />
  } else if (door === 'judge-scores') {
    // Each piece of work and its score, by job: counts of pieces, never of people (record judge).
    body = <JudgeScoresPage go={go} />
  } else {
    body = <div className="ln-apps" data-testid="soon-door"><SoonCard teaser={teaser} /></div>
  }

  return (
    <div className={`nui nui-page${door === 'approvals' ? ' ap-page' : door === 'live-jobs' ? ' jp-page' : ''}`} ref={top} data-testid="door-page" data-door={door}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">YOUR PAGES</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="door-title">{teaser.name}<span className="period-dot" aria-hidden /></h1>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={() => go({ level: 'agency' })}>Back to the desk</button></div>
        </section>
        <main className="hm-main">{body}</main>
      </div>
    </div>
  )
}
