// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The words and links on the agency dashboard's six tiles (v2 section 6; docs/design/dashboard.html),
// as plain functions over what `GET /dashboard` sends. Every number is a link to the job behind it, or,
// where it stands for several jobs, to the Live jobs door. Napkin never scores people: nothing here
// names a person's number, and the Judge and results tiles hold no figure in Phase 1.

import type { DashboardView, JobLine } from '../../host/types'
import { formatRoute } from '../route'

/** Where a number goes: the job's page for one job, the Live jobs door for several. */
export function jobHref(jobs: readonly JobLine[]): string {
  return jobs.length === 1 && jobs[0] ? formatRoute({ level: 'job', number: jobs[0].number }) : formatRoute({ level: 'door', door: 'live-jobs' })
}

export const jobLink = (j: JobLine): string => formatRoute({ level: 'job', number: j.number })

export interface Tile {
  id: 'stage' | 'risk' | 'hours' | 'waiting' | 'scores' | 'results'
  label: string
  /** The numbers on the tile, each a link; none on a tile that has no figure yet. */
  numbers: { text: string; href: string }[]
  /** The line under them. */
  line: string
  /** The jobs the tile speaks of. */
  jobs: { job: JobLine; text: string; stage?: string }[]
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Judge's tile: pieces scored, never people. With nothing scored it reads as it always did. The wording stays;
 *  the numbers are the pieces scoring 27 or more, and how many are under 24 (advice until Judge is trusted). */
function scoresTile(d: DashboardView): Tile {
  const label = 'Work scoring 27 or more'
  const s = d.scores
  if (!s) return { id: 'scores', label, numbers: [], line: 'No scores yet. Send a script to Judge.', jobs: [] }
  const door = formatRoute({ level: 'door', door: 'judge-scores' })
  return {
    id: 'scores',
    label,
    numbers: [
      { text: `${s.at_27} of ${s.scored} ${plural(s.scored, 'piece', 'pieces')}`, href: door },
      { text: `${s.under_24} under 24`, href: door },
    ],
    line: `Average ${s.average} out of 30. ${s.brave} Brave, ${s.overruled} overruled. ${s.awaiting_set} more decided ${plural(s.awaiting_set, 'piece', 'pieces')} before Judge's 24 is more than advice.`,
    jobs: s.jobs.map(j => ({ job: { number: j.number, client: j.client, client_id: j.client_id, line: '' }, text: `${j.scored} scored, average ${j.average}, ${j.under_24} under 24.` })),
  }
}

export function tiles(d: DashboardView): Tile[] {
  const all = d.by_stage.flatMap(s => s.jobs)
  const maxWait = [...d.waiting_on_client].sort((a, b) => Number(b.line) - Number(a.line))[0]
  const hoursJobs = d.hours.jobs
  return [
    {
      id: 'stage',
      label: 'Live jobs by stage',
      numbers: d.by_stage.map(s => ({ text: `${s.count} in ${s.label}`, href: jobHref(s.jobs) })),
      line: d.live_jobs === 1 ? 'One live job.' : `${d.live_jobs} live jobs.`,
      jobs: d.by_stage.flatMap(s => s.jobs.map(j => ({ job: j, text: j.line, stage: s.id }))),
    },
    {
      id: 'risk',
      label: 'At risk',
      numbers: [{ text: String(d.at_risk.length), href: jobHref(d.at_risk.length ? d.at_risk : all) }],
      line: d.at_risk.length === 0 ? 'No job is past a deadline.' : `${d.at_risk.length} ${plural(d.at_risk.length, 'job is', 'jobs are')} past a deadline.`,
      jobs: d.at_risk.map(j => ({ job: j, text: j.line })),
    },
    {
      id: 'hours',
      label: 'Hours against budget',
      numbers: [{ text: d.hours.confirmed === null ? 'No hours yet' : `${Math.round((d.hours.confirmed / Math.max(d.hours.budget, 1)) * 100)}%`, href: jobHref(hoursJobs) }],
      line: hoursJobs.length === 0
        ? 'No job has a budget in hours yet.'
        : `${d.hours.budget} budgeted ${plural(d.hours.budget, 'hour', 'hours')} across ${hoursJobs.length} ${plural(hoursJobs.length, 'job', 'jobs')}. Hours count once timesheets are confirmed.`,
      jobs: hoursJobs.map(j => ({ job: j, text: j.line })),
    },
    {
      id: 'waiting',
      label: 'Days waiting on client',
      numbers: [{ text: maxWait ? maxWait.line : '0', href: jobHref(maxWait ? [maxWait] : all) }],
      line: maxWait ? `The longest wait, on ${maxWait.number}.` : 'No brief is waiting on a client.',
      jobs: d.waiting_on_client.map(j => ({ job: j, text: `${j.line} ${plural(Number(j.line), 'day', 'days')}.` })),
    },
    scoresTile(d),
    { id: 'results', label: 'Results against objectives', numbers: [], line: 'No results yet. No job has launched.', jobs: [] },
  ]
}
