// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One page door of the desk's "Your pages" row, opened (features/align-landing-look.clan). A page door opens an
// agency-wide page of the shell: the dashboard, Live jobs, Approvals, Judge scores. A door whose page is not built yet
// opens develop's SoonCard, carrying that door's own example line (components/states/doors.ts), with one way back.
// Tools are not doors: they are landing/tools.ts entries, offered on the desk by the role.

import { useEffect, useRef } from 'react'
import type { ClientRecord, JobRights } from '../../host/types'
import { SoonCard } from '../SoonCard'
import type { Teaser } from '../comingSoon'
import { doorById } from '../../components/states/doors'
import type { Route } from '../route'
import { doorIsLive, doorTarget } from './doorTargets'
import { Dashboard } from './Dashboard'
import { ApprovalsPage } from '../approvals/ApprovalsPage'
import { LiveJobs } from '../job/LiveJobs'
import { JudgeScoresPage } from '../judge/JudgeScoresPage'
import './home.css'

/** The card for a door with no page yet: the door's own line, example and verb. */
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="14" fill="none" stroke="black" stroke-width="3"/></svg>'
function teaserOf(door: string, title: string, content: ReturnType<typeof doorById>): Teaser {
  return {
    app_id: door,
    name: title,
    job: content?.verb ?? 'Open the J001 job',
    line: content?.line ?? `${title} goes here.`,
    colour: '#6B665C',
    mark: MARK,
    example: content?.example ?? { title: 'Example · Client A, an Irish whiskey', lines: [`${title} will list the J001 work here.`] },
  }
}

interface Props {
  door: string
  /** The door's words as the home gave them (`Brief (read and sign)`), else the Empty content's name. */
  name: string | null
  clients: readonly ClientRecord[]
  /** What this person may do with jobs (the home view's): who gets the Open a job button. */
  rights?: JobRights | null
  go: (r: Route) => void
}

export function DoorPage({ door, name, clients, rights = null, go }: Props) {
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [door])
  const content = doorById(door)
  const title = name ?? content?.name ?? door.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  const live = doorIsLive(door)
  const target = doorTarget(door)
  const page = live && target ? target.page : null

  let body
  if (page === 'agency-dashboard') {
    // The dashboard reads the job index, behind the server's role check (a door of Management's row).
    body = <Dashboard go={go} />
  } else if (page === 'approvals') {
    // Who approves each stage and by when, who holds each job and for how long: read from the job index.
    body = <ApprovalsPage go={go} />
  } else if (page === 'live-jobs') {
    // Every live job, soonest deadline first, each row its page (features/job-page.clan).
    body = <LiveJobs clients={clients} rights={rights} go={go} />
  } else if (page === 'judge-scores') {
    // Each piece of work and its score, by job: counts of pieces, never of people (record judge).
    body = <JudgeScoresPage go={go} />
  } else {
    body = (
      <div className="pg-soon" data-testid="door-soon">
        <SoonCard teaser={teaserOf(door, title, content)} />
        <button type="button" className="side-link" data-testid="to-desk" onClick={() => go({ level: 'agency' })}>Back to the desk</button>
      </div>
    )
  }

  return (
    <div className={`nui nui-page${door === 'approvals' ? ' ap-page' : door === 'live-jobs' ? ' jp-page' : ''}`} ref={top} data-testid="door-page" data-door={door}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">YOUR PAGES</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="door-title">{title}<span className="period-dot" aria-hidden /></h1>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={() => go({ level: 'agency' })}>Back to the desk</button></div>
        </section>
        <main className="hm-main">{body}</main>
      </div>
    </div>
  )
}
