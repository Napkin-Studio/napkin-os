// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// features/job-page.clan in the shell: the words said about a job, the Live jobs order, what a form
// changed, the job page in each state, the Needs you row that carries its job's link, and the one reader
// of budget_hours in the shell. De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { JobDocument, JobEntry, JobNeed, JobView } from '../src/host/types.ts'
import { jobNeedRow } from '../src/shell/home/model.ts'
import { jobHref, jobLink } from '../src/shell/home/dashboardModel.ts'
import {
  budgetLine, changedBriefOf, docLine, dueLine, formOf, formProblem, nextNeed, orderLive, patchOf, saveOutcome, stageLine, waitingLine,
} from '../src/shell/job/jobModel.ts'
import { JobBody } from '../src/shell/job/JobPage.tsx'
import { LiveJobsBody } from '../src/shell/job/LiveJobs.tsx'
import { doorTarget } from '../src/shell/home/doorTargets.ts'

const doc = (over: Partial<JobDocument> = {}): JobDocument => ({ path: 'brief.clan', title: 'Autumn launch brief', app_id: 'ie.napkin.brief-maker', needs_you: 0, locked: false, version: null, changed_since_lock: false, ...over })
const job = (number = 'J001', over: Partial<JobEntry> = {}): JobEntry => ({
  number, title: `${number} brief`, client: { id: 'cli_00000001', name: 'Client A' }, owner: 'aoife@wk', opened_on: '2026-11-02', due: '2026-12-18',
  stage: { id: 'brief-check', step: 2, label: 'Brief check' }, status: 'Passed the gate. Waiting for signatures.', waiting_on: 'agency',
  days_waiting_on_client: null, at_risk: false, documents: [doc()], route: [], holder: null, ...over,
})
const need = (over: Partial<JobNeed> = {}): JobNeed => ({ job: 'J001', client: 'Client A', client_id: 'cli_00000001', text: 'Sign the brief', action: 'Sign the brief', path: 'brief.clan', due: '2026-12-18', ...over })
const rights = { manage: true, budget: false }
const view = (over: Partial<JobView> = {}): JobView => ({ job: job(), needs: [], can: rights, ...over })

const noop = () => {}
const page = (value: JobView | 'missing' | 'forbidden' | null, ready = true) =>
  renderToStaticMarkup(createElement(JobBody, { number: 'J001', value, ready, go: noop, onOpenDocument: noop, back: { route: { level: 'door', door: 'live-jobs' }, label: 'Back to Live jobs' }, reload: noop, save: async () => ({ ok: true }) }))

test('the words: step n of 11, the deadline, who the job waits on', () => {
  assert.equal(stageLine(job()), 'Step 2 of 11. Brief check.')
  assert.equal(dueLine(job()), 'Due 18 Dec')
  assert.equal(dueLine(job('J002', { due: null })), 'No deadline')
  assert.equal(dueLine(job('J002', { at_risk: true })), 'Past its deadline, 18 Dec')
  assert.equal(waitingLine(job()), 'Waiting on the agency.')
  assert.equal(waitingLine(job('J002', { waiting_on: 'client', days_waiting_on_client: 2 })), 'Waiting on the client for 2 days.')
  assert.equal(waitingLine(job('J002', { waiting_on: 'client', days_waiting_on_client: null })), 'Waiting on the client.')
  const holder = { party: 'agency', person: 'dara@wk', role: 'creative_director', stage: 'brief-check', since: '2026-11-11T09:00:00Z', days: 2, due: '2026-11-14', days_late: 0 }
  assert.match(waitingLine(job('J002', { holder })), /^Waiting on dara@wk, creative director, for 2 days\. Due 14 Nov\.$/)
})

test('Live jobs: soonest deadline first, none last, ties in the order opened', () => {
  const jobs = [job('J001', { due: null }), job('J002', { due: '2026-12-18' }), job('J003', { due: '2026-11-20' }), job('J004', { due: '2026-12-18' })]
  assert.deepEqual(orderLive(jobs).map(j => j.number), ['J003', 'J002', 'J004', 'J001'])
})

test('a budget is only worded when the role was sent it', () => {
  assert.equal(budgetLine(job()), null)
  assert.equal(budgetLine(job('J001', { budget_hours: null })), null)
  assert.equal(budgetLine(job('J001', { budget_hours: 120 })), '120 hours')
  assert.equal(budgetLine(job('J001', { budget_hours: 1 })), '1 hour')
})

test('a signed brief that moved on is the Changed brief, vN to vN+1', () => {
  assert.equal(changedBriefOf(job()), null)
  const c = changedBriefOf(job('J001', { documents: [doc({ version: 1, changed_since_lock: true })] }))
  assert.deepEqual([c?.from, c?.to], ['v1', 'v2'])
  assert.equal(docLine(doc({ version: 1, changed_since_lock: true })), 'Brief · Changed since it was signed')
  assert.equal(docLine(doc({ locked: true })), 'Brief · Signed and locked')
  assert.equal(docLine(doc({ needs_you: 2 })), 'Brief · 2 to check')
})

test('the next action is the first need on this job', () => {
  assert.equal(nextNeed([], 'J001'), null)
  assert.equal(nextNeed([need({ job: 'J002' })], 'J001'), null)
  assert.equal(nextNeed([need({ job: 'J002' }), need()], 'J001')?.action, 'Sign the brief')
})

test('the form sends only what changed, and the budget only to a role that may set it', () => {
  const j = job('J001', { budget_hours: 120 })
  assert.equal(patchOf(j, formOf(j), true), null)
  assert.deepEqual(patchOf(j, { ...formOf(j), due: '2026-12-25' }, true), { due: '2026-12-25' })
  assert.deepEqual(patchOf(j, { ...formOf(j), due: '' }, true), { due: null })
  assert.deepEqual(patchOf(j, { ...formOf(j), title: ' New  ', budget: '90' }, true), { title: 'New', budget_hours: 90 })
  assert.deepEqual(patchOf(j, { ...formOf(j), budget: '90' }, false), null)
  assert.match(formProblem({ ...formOf(j), title: ' ' }, true) ?? '', /title/)
  assert.match(formProblem({ ...formOf(j), budget: '-3' }, true) ?? '', /budget/)
  assert.equal(formProblem(formOf(j), true), null)
  assert.deepEqual(['saved', 'refused', 'problem', 'problem', 'failed'], [
    saveOutcome({ ok: true }), saveOutcome({ ok: false, status: 403, message: '' }), saveOutcome({ ok: false, status: 400, message: 'x' }), saveOutcome({ ok: false, status: 409, message: 'x' }), saveOutcome({ ok: false, status: 0, message: '' }),
  ])
})

test('every job link goes to the job page, and several jobs to Live jobs', () => {
  const line = { number: 'J001', client: 'Client A', client_id: 'cli_00000001', line: '' }
  assert.equal(jobLink(line), '#job-J001')
  assert.equal(jobHref([line]), '#job-J001')
  assert.equal(jobHref([line, { ...line, number: 'J002' }]), '#door-live-jobs')
  assert.equal(jobHref([]), '#door-live-jobs')
})

test('a Needs you row carries its job and the hash of its page', () => {
  const row = jobNeedRow(need())
  assert.deepEqual(row.job, { number: 'J001', href: '#job-J001' })
  assert.equal(row.sub, 'J001, Client A')
  assert.equal(row.path, 'brief.clan', 'the button still opens the document')
  assert.equal(jobNeedRow(need({ job: 'not-a-job' })).job, undefined)
})

test('Live jobs is a built door', () => {
  assert.deepEqual(doorTarget('live-jobs'), { page: 'live-jobs', built: true })
})

test('the page shows the stage, who holds it, the dates, every document, and one primary button', () => {
  const html = page(view({ job: job('J001', { documents: [doc(), doc({ path: 'r.clan', title: 'Whiskey research', app_id: 'ie.napkin.campaign-research' }), doc({ path: 'd.clan', title: 'Deck', app_id: 'ie.napkin.deck-maker' })] }), needs: [need()] }))
  assert.match(html, /data-testid="job-page" data-job="J001"/)
  assert.match(html, /Step 2 of 11\. Brief check\./)
  assert.match(html, /Waiting on the agency\./)
  assert.match(html, /Deadline<\/dt><dd data-testid="job-due">18 Dec/)
  assert.equal((html.match(/data-testid="job-document"/g) || []).length, 3)
  assert.equal((html.match(/ns-primary/g) || []).length, 1, 'one primary button')
  assert.match(html, />Sign the brief<\/button>/)
  assert.match(html, /data-state="normal"/)
  assert.doesNotMatch(html, /data-testid="job-budget"/, 'no budget was sent')
})

test('with nothing asked of the person there is no primary button', () => {
  const html = page(view())
  assert.equal((html.match(/ns-primary/g) || []).length, 0)
})

test('a changed brief is two lines and one button, and the other need is not a second primary', () => {
  const html = page(view({ job: job('J001', { documents: [doc({ version: 1, changed_since_lock: true })] }), needs: [need()] }))
  assert.match(html, /data-state="changed-brief"/)
  assert.match(html, /The brief changed to v2\. This work was made from v1\./)
  assert.match(html, /The signed version stays as it was; the new one needs signing\./)
  assert.match(html, />Update to brief v2<\/button>/)
  assert.equal((html.match(/ns-primary/g) || []).length, 1)
})

test('a role sent the budget sees it; the change form shows the budget field only to a role that may set it', () => {
  const money = page(view({ job: job('J001', { budget_hours: 120 }), can: { manage: true, budget: true } }))
  assert.match(money, /data-testid="job-budget">120 hours/)
  const none = page(view({ can: { manage: false, budget: false } }))
  assert.doesNotMatch(none, /data-testid="job-edit"/, 'no control for a role that may not change a job')
  assert.match(page(view()), /data-testid="job-edit"/)
})

test('the route strip is drawn when the job has a route, and is nothing without one', () => {
  assert.doesNotMatch(page(view()), /data-testid="route-strip"/)
  const step = { stage: 'brief-check', label: 'Brief check', party: 'agency', role: 'planner', approver: 'aoife@wk', due: '2026-11-13', state: 'waiting', approved_by: null, approved_at: null, version: null, document: 'brief.clan', held_since: '2026-11-11T09:00:00Z', days_held: 1, days_late: 0 }
  assert.match(page(view({ job: job('J001', { route: [step as never] }) })), /data-testid="route-strip"/)
})

test('the job page in its other states: Loading, a job that is not here, Missing access, no answer', () => {
  assert.match(page(null, false), /data-state="loading"/)
  const missing = page('missing')
  assert.match(missing, /data-state="empty"/)
  assert.match(missing, /This job is not in your agency\./)
  assert.match(missing, /Go to Live jobs/)
  assert.match(page('forbidden'), /data-state="missing-access"/)
  assert.match(page(null), /data-state="empty"/)
})

test('a job with no documents is the Empty state', () => {
  assert.match(page(view({ job: job('J001', { documents: [] }) })), /Nothing is filed under this job yet\./)
})

const live = (jobs: JobEntry[] | null, may: boolean | null, ready = true) =>
  renderToStaticMarkup(createElement(LiveJobsBody, { jobs, ready, clients: [{ id: 'cli_00000001', name: 'Client A' } as never], rights: may === null ? null : { manage: may, budget: may }, go: noop, reload: noop, open: async () => ({ ok: true }) }))

test('Live jobs lists each job as a link to its page, soonest deadline first', () => {
  const html = live([job('J001', { due: null }), job('J002', { due: '2026-11-20' })], true)
  assert.match(html, /data-testid="live-jobs"/)
  assert.ok(html.indexOf('data-job="J002"') < html.indexOf('data-job="J001"'))
  assert.match(html, /<a class="jp-row" href="#job-J001"/)
  assert.match(html, /data-testid="open-a-job"/)
})

test('a Live jobs row is named by the words it shows: no aria-label that replaces them (axe label-content-name-mismatch)', () => {
  const html = live([job('J001')], true)
  const row = html.slice(html.indexOf('<a class="jp-row"'), html.indexOf('</a>', html.indexOf('<a class="jp-row"')))
  assert.ok(row.length > 0)
  assert.doesNotMatch(row, /aria-label=/)
  assert.match(row, />J001</)
})

test('with no job Live jobs is the Empty state and its one verb is Open a job', () => {
  const html = live([], true)
  assert.match(html, /data-state="empty"/)
  assert.match(html, />Open a job<\/button>/)
  assert.match(live([], false), /Planning, account service, management and producers open jobs\./)
  assert.match(live(null, true, false), /data-state="loading"/)
})

test('a role that may not open a job is not given the button, and says who may', () => {
  const html = live([job()], false)
  assert.doesNotMatch(html, /data-testid="open-a-job"/)
  assert.match(html, /data-testid="live-no-open"/)
})

// The shell's one reader of budget_hours besides the dashboard (which reads GET /dashboard) is the job page.
test('budget_hours is read in the shell only where the server sends it to the Money roles', () => {
  // the runner bundles each test into tests/.run-*/, so the shell's source is two levels up
  const root = new URL('../../src', import.meta.url).pathname
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, 'utf8').includes('budget_hours')) hits.push(p.slice(root.length + 1))
    }
  }
  walk(root)
  assert.deepEqual(hits.sort(), ['host/http.ts', 'host/types.ts', 'shell/job/LiveJobs.tsx', 'shell/job/jobModel.ts'].sort())
})
