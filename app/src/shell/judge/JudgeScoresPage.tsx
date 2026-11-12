// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Judge scores door (v2 section 4; features/judge.clan), a door of the Creative director's home and read only
// for the Agency Brain: each piece of work with its score out of 30, where Judge advised it goes and what the creative
// director then did, by job. It reads the job index (`GET /jobs`, cut to this role's fields) and stays current by
// itself. Napkin never scores people: the counts are of pieces, every row is a piece of work, and nothing here groups,
// totals or orders by who made it. Until Judge is trusted the 24 is advice, and the page says so.

import { jobsView } from '../../host/http'
import { Empty, Loading } from '../../components/states/ScreenStates'
import type { JobEntry } from '../../host/types'
import { useLiveRead } from '../home/useLiveRead'
import { formatRoute, type Route } from '../route'
import { countsOf, kindName, rowsOf, standing } from './judgeModel'
import { CALIBRATION } from './words'
import './judge.css'

export function JudgeScoresPage({ go }: { go: (r: Route) => void }) {
  const { value, ready } = useLiveRead(jobsView, true, null)
  return <JudgeScoresBody jobs={value} ready={ready} go={go} />
}

export function JudgeScoresBody({ jobs, ready, go }: { jobs: JobEntry[] | null; ready: boolean; go: (r: Route) => void }) {
  if (!ready) return <Loading what="the Judge scores" rows={3} />
  const example = { title: 'Example · Client A, an Irish whiskey', lines: ['Radio script, version 2: 26 of 30. Idea 9, craft 7.'] }
  if (jobs === null) return <Empty line="The Judge scores cannot be read just now." verb="Open the clients" example={example} reason="The server did not answer. It tries again by itself." onStart={() => go({ level: 'clients' })} />
  const rows = rowsOf(jobs)
  if (rows.length === 0) {
    return <Empty line="Each piece of work and its score out of 30 goes here." verb="Score a piece" example={example} onStart={() => go({ level: 'clients' })} />
  }
  const c = countsOf(rows)
  return (
    <div className="js" data-testid="judge-scores">
      <ul className="js-counts" aria-label="Pieces scored">
        <li><b data-testid="js-scored">{c.scored}</b><span>{c.scored === 1 ? 'piece scored' : 'pieces scored'}</span></li>
        <li><b>{c.average}</b><span>average out of 30</span></li>
        <li><b>{c.under24}</b><span>under 24</span></li>
        <li><b>{c.at27}</b><span>27 or more</span></li>
        <li><b>{c.brave}</b><span>Brave</span></li>
        <li><b>{c.overruled}</b><span>overruled</span></li>
      </ul>
      <p className="js-note" data-testid="js-calibration">{CALIBRATION}</p>
      <ul className="js-list">
        {rows.map(r => (
          <li key={r.score} className="js-row" data-testid="judge-piece" data-job={r.job}>
            <span className="js-score"><span data-testid="js-total">{r.total}</span><small> of 30</small></span>
            <span className="js-main">
              <span className="js-title">{r.title}</span>
              <span className="js-sub">{kindName(r.kind)} · {r.job}, {r.client} · Idea {r.idea}, craft {r.craft}, effect {r.effect}</span>
              <span className="js-sub">{standing(r)}{r.current ? '' : '. The work has changed since'}</span>
            </span>
            <a className="js-open side-link" href={formatRoute({ level: 'job', number: r.job })}>Open {r.job}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}
