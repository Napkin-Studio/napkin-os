// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The job index in the shell (features/job-index-dashboard.clan): Needs you is ordered by deadline and
// shows five lines before Show all; a job's documents leave the per-document rows to the per-person
// lines, and a document with no job stays as it was; the dashboard draws six tiles whose numbers are
// links, an Empty state with no jobs, Missing access for a role that may not open it, and no score of
// any person. De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DashboardView, JobNeed, LibraryItem } from '../src/host/types.ts'
import { dueWords, firstNeeds, jobNeedRow, needsRows, NEEDS_FIRST, orderNeeds } from '../src/shell/home/model.ts'
import { jobHref, tiles } from '../src/shell/home/dashboardModel.ts'

const N = (job: string, due: string | null, text = `${job} brief`): JobNeed => ({
  job, client: 'Client A', client_id: 'cli_00000001', text, action: 'Sign the brief', path: `doc-${job}`, due,
})

test('Needs you is ordered by deadline, a job with none last, ties in the order they came', () => {
  const rows = orderNeeds([N('J004', null), N('J002', '2026-11-20'), N('J003', '2026-11-12'), N('J001', '2026-11-20')].map(jobNeedRow))
  assert.deepEqual(rows.map(r => r.sub.slice(0, 4)), ['J003', 'J002', 'J001', 'J004'])
})

test('Needs you shows five lines, then Show all', () => {
  const rows = Array.from({ length: 7 }, (_, i) => jobNeedRow(N(`J00${i + 1}`, `2026-11-${10 + i}`)))
  assert.equal(NEEDS_FIRST, 5)
  const first = firstNeeds(rows, false)
  assert.equal(first.shown.length, 5)
  assert.equal(first.more, 2)
  assert.equal(firstNeeds(rows, true).shown.length, 7)
  assert.equal(firstNeeds(rows.slice(0, 3), false).more, 0)
})

test('a job need is one line with one next action and its deadline in words', () => {
  const r = jobNeedRow(N('J001', '2026-11-20'))
  assert.deepEqual([r.sub, r.state, r.action, r.path], ['J001, Client A', 'Due 20 Nov', 'Sign the brief', 'doc-J001'])
  assert.equal(jobNeedRow(N('J001', null)).state, 'No deadline')
  assert.equal(dueWords('2026-02-03'), '3 Feb')
  assert.equal(dueWords('soon'), 'soon')
})

const doc = (title: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `d-${title}`, app_id: 'ie.napkin.brief-maker', title, updated_at: '2026-11-04T10:00:00Z',
  client: { id: 'cli_00000001', name: 'Client A' }, state: { needs_you: 1, locked: false }, run: null, ...over,
})

test('a job document leaves the per-document rows to the per-person lines; a jobless one stays', () => {
  const rows = needsRows([doc('J001 brief', { job: 'J001' }), doc('Loose brief')], [N('J001', '2026-11-20')])
  assert.deepEqual(rows.map(r => r.title), ['J001 brief', 'Loose brief'])
  assert.equal(rows[0].action, 'Sign the brief') // the job's line, from the index
  assert.equal(rows[1].action, 'Make the calls') // the jobless document, as it was
  // a person the index asks nothing of sees no line for the job's document
  assert.deepEqual(needsRows([doc('J001 brief', { job: 'J001' })], []), [])
})

const dash = (over: Partial<DashboardView> = {}): DashboardView => ({
  live_jobs: 1,
  by_stage: [{ id: 'brief-check', label: 'Brief check', count: 1, jobs: [{ number: 'J001', client: 'Client A', client_id: 'cli_00000001', line: 'Signed. Waiting for the client to confirm.' }] }],
  at_risk: [],
  hours: { budget: 120, confirmed: null, jobs: [{ number: 'J001', client: 'Client A', client_id: 'cli_00000001', line: 'Budget 120 hours.' }] },
  waiting_on_client: [{ number: 'J001', client: 'Client A', client_id: 'cli_00000001', line: '2' }],
  scores: null, results: null, ...over,
})

test('the dashboard has six tiles, each number a link to the job or to Live jobs', () => {
  const t = tiles(dash())
  assert.deepEqual(t.map(x => x.id), ['stage', 'risk', 'hours', 'waiting', 'scores', 'results'])
  assert.deepEqual(t[0].numbers, [{ text: '1 in Brief check', href: '#job-J001' }])
  assert.equal(t[1].numbers[0].text, '0')
  assert.equal(t[1].line, 'No job is past a deadline.')
  assert.equal(t[2].numbers[0].text, 'No hours yet')
  assert.equal(t[3].numbers[0].text, '2')
  // the two tiles with no figure in Phase 1 show none: an Empty line, not a made-up number
  assert.deepEqual([t[4].numbers, t[5].numbers], [[], []])
  assert.match(t[4].line, /No scores yet/)
  assert.match(t[5].line, /No results yet/)
  // several jobs behind one number: it opens Live jobs
  const two = [{ number: 'J001', client: 'A', client_id: 'cli_00000001', line: '' }, { number: 'J002', client: 'A', client_id: 'cli_00000001', line: '' }]
  assert.equal(jobHref(two), '#door-live-jobs')
  assert.equal(jobHref(two.slice(0, 1)), '#job-J001')
})

test('the dashboard names no person and ranks nothing', () => {
  const words = JSON.stringify(tiles(dash()))
  assert.doesNotMatch(words, /score of|rank|leaderboard|top performer/i)
})

import { DashboardBody } from '../src/shell/home/Dashboard.tsx'

const body = (value: DashboardView | 'forbidden' | null, ready = true) => renderToStaticMarkup(createElement(DashboardBody, { value, ready, go: () => {} }))

test('with no jobs the dashboard is the Empty state, with its one verb', () => {
  const html = body(dash({ live_jobs: 0, by_stage: [], hours: { budget: 0, confirmed: null, jobs: [] }, waiting_on_client: [] }))
  assert.match(html, /data-state="empty"/)
  assert.doesNotMatch(html, /data-testid="dashboard"/)
  assert.match(html, /Open the clients/)
})

test('a role that may not open it sees Missing access, and the first read is Loading', () => {
  assert.match(body('forbidden'), /data-state="missing-access"/)
  assert.match(body(null, false), /data-state="loading"/)
})

test('with jobs the dashboard draws six tiles, each number a link, and J001 on the stage tile', () => {
  const html = body(dash())
  assert.equal((html.match(/data-testid="tile-(stage|risk|hours|waiting|scores|results)"/g) || []).length, 6)
  assert.match(html, /<a class="db-n" href="#job-J001" data-testid="tile-number">1 in Brief check<\/a>/)
  assert.match(html, /data-job="J001" data-stage="brief-check"/)
  assert.match(html, /Signed\. Waiting for the client to confirm\./)
})
