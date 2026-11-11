// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency dashboard, a door on Management's home (v2 sections 4 and 6; docs/design/dashboard.html):
// six plain tiles about the agency's live jobs, each number a link to the job behind it. It reads
// the job index through `GET /dashboard` and stays current by itself, so a stage change on J001 shows
// without a reload. It shows jobs and stages, never a score or a ranking of a person.
//
// Who may see it is the server's: the route answers 403 to another role, and this draws that as Missing
// access. With no jobs it is the Empty state. Nothing here is a new component style: the home's
// section label, the shell's text links and the screen states.

import { dashboardView } from '../../host/http'
import { Empty, Loading, MissingAccess } from '../../components/states/ScreenStates'
import type { DashboardView } from '../../host/types'
import type { Route } from '../route'
import { jobLink, tiles } from './dashboardModel'
import { useLiveRead } from './useLiveRead'
import './dashboard.css'

export function Dashboard({ go }: { go: (r: Route) => void }) {
  const { value, ready } = useLiveRead(dashboardView, true, null)
  return <DashboardBody value={value} ready={ready} go={go} />
}

/** The dashboard for what the server last said: loading, no access, no answer, no jobs, or the six tiles. */
export function DashboardBody({ value, ready, go }: { value: DashboardView | 'forbidden' | null; ready: boolean; go: (r: Route) => void }) {
  if (!ready) return <Loading what="the dashboard" rows={3} />
  if (value === 'forbidden') return <MissingAccess what="the agency dashboard" who="Management" />
  if (value === null) return <Empty line="The dashboard cannot be read just now." verb="Open the clients" example={{ title: 'Example · Client A, an Irish whiskey', lines: ['J001 is in Brief check. Waiting for signatures.'] }} onStart={() => go({ level: 'clients' })} reason="The server did not answer. It tries again by itself." />
  if (value.live_jobs === 0) {
    return (
      <Empty
        line="Six plain numbers about your live jobs go here, once a job is open."
        example={{ title: 'Example · Client A, an Irish whiskey', lines: ['Live jobs: 1 in Brief check. Days waiting on client: 2.'] }}
        verb="Open the clients"
        onStart={() => go({ level: 'clients' })}
      />
    )
  }

  return (
    <div className="db" data-testid="dashboard" aria-label="Agency dashboard">
      {tiles(value).map(t => (
        <section key={t.id} className="db-tile" data-testid={`tile-${t.id}`} aria-labelledby={`db-${t.id}`}>
          <h2 className="hm-h" id={`db-${t.id}`}>{t.label}</h2>
          {t.numbers.length > 0 ? (
            <div className="db-numbers">
              {t.numbers.map(n => <a key={n.text} className="db-n" href={n.href} data-testid="tile-number">{n.text}</a>)}
            </div>
          ) : (
            <p className="db-none" data-testid="tile-none">{t.line.split('. ')[0]}.</p>
          )}
          <p className="db-line">{t.numbers.length > 0 ? t.line : t.line.split('. ').slice(1).join('. ')}</p>
          {t.jobs.length > 0 && (
            <ul className="db-jobs">
              {t.jobs.map(j => (
                <li key={j.job.number} data-job={j.job.number} data-stage={j.stage}>
                  <a className="side-link" href={jobLink(j.job)}>{j.job.number}</a>
                  <span>{j.job.client}. {j.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
