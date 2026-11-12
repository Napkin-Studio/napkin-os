// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// features/approval-route.clan in the shell: the words said about a route step and about who holds a job,
// the Approvals page in the states that apply to it, the route strip for each state of a step, the route
// editor's blank and clean-up, and a Needs you row for an approval, with and without the new fields.
// De-identified: Client A, an Irish whiskey. Nothing here scores a person.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { Holder, JobEntry, JobNeed, RouteStepState } from '../src/host/types.ts'
import { jobNeedRow } from '../src/shell/home/model.ts'
import {
  blankStep, cleanSteps, draftOf, heldLine, holderLine, missingIn, orderJobs, outcomeOf, roleWords, stepLine,
} from '../src/shell/approvals/approvalsModel.ts'
import { ApprovalsBody } from '../src/shell/approvals/ApprovalsPage.tsx'
import { RouteStrip } from '../src/shell/approvals/RouteStrip.tsx'
import { RouteEditor } from '../src/shell/approvals/RouteEditor.tsx'

const step = (over: Partial<RouteStepState> = {}): RouteStepState => ({
  stage: 'brief-check', label: 'Brief check', party: 'agency', role: 'creative_director', approver: 'dara@wk', contact: null, rounds: null,
  due: '2026-11-14', state: 'waiting', approved_by: null, approved_at: null, version: null, document: 'brief.clan',
  held_since: '2026-11-11T09:00:00Z', days_held: 2, days_late: 0, ...over,
})
const holder = (over: Partial<Holder> = {}): Holder => ({
  party: 'agency', person: 'dara@wk', role: 'creative_director', stage: 'brief-check', since: '2026-11-11T09:00:00Z', days: 2, due: '2026-11-14', days_late: 0, ...over,
})
const job = (number: string, over: Partial<JobEntry> = {}): JobEntry => ({
  number, title: `${number} brief`, client: { id: 'cli_00000001', name: 'Client A' }, owner: 'aoife@wk', opened_on: '2026-11-02', due: '2026-12-18', budget_hours: 120,
  stage: { id: 'brief-check', step: 2, label: 'Brief check' }, status: 'Passed the gate. Waiting for signatures.', waiting_on: 'agency',
  days_waiting_on_client: null, at_risk: false, documents: [], route: [], holder: null, ...over,
})
const approved = step({ state: 'approved', role: 'planner', approver: 'aoife@wk', approved_by: 'aoife@wk', approved_at: '2026-11-11T09:30:00Z', version: 'v3', held_since: null, days_held: null, days_late: null })
const client = step({ stage: 'client-approval', label: 'Client approval', party: 'client', role: 'client', approver: 'Client A contact', contact: 'contact@client-a.example', rounds: 2, due: '2026-11-20', state: 'not_started', held_since: null, days_held: null, days_late: null })
const routed = job('J001', { route: [approved, step(), client], holder: holder() })

const page = (jobs: JobEntry[] | null, ready = true) =>
  renderToStaticMarkup(createElement(ApprovalsBody, { jobs, ready, go: () => {}, reload: () => {}, save: async () => ({ ok: true as const }) }))

test('a step says what happened to it, from the decision, and how long the job has waited at it', () => {
  assert.equal(stepLine(approved), 'Approved by aoife@wk on 11 Nov.')
  assert.equal(stepLine(step()), 'Due 14 Nov.')
  assert.equal(stepLine(step({ days_late: 2 })), '2 days late. Was due 14 Nov.')
  assert.equal(stepLine(step({ days_late: 1 })), '1 day late. Was due 14 Nov.')
  assert.equal(stepLine(client), 'Due 20 Nov.')
  assert.equal(heldLine(step()), 'Held 2 days, since 11 Nov.')
  assert.equal(heldLine(approved), null)
  assert.equal(heldLine(client), null)
  assert.equal(roleWords('creative_director'), 'Creative director')
  assert.equal(roleWords(null), '')
})

test('who holds a job is one sentence about the job: the person, the days, the date, and the days late', () => {
  assert.equal(holderLine(holder()), 'Waiting on dara@wk, creative director, for 2 days. Due 14 Nov.')
  assert.equal(holderLine(holder({ days: 1, days_late: 2 })), 'Waiting on dara@wk, creative director, for 1 day. Due 14 Nov. 2 days late.')
  assert.equal(holderLine(holder({ party: 'client', person: 'Client A contact', role: 'client' })), 'Waiting on the client, Client A contact, for 2 days. Due 14 Nov.')
  assert.equal(holderLine(null), '')
})

test('jobs are listed by what is waiting and when it is due, never by who holds them', () => {
  const none = job('J004')
  const done = job('J003', { route: [approved] })
  const soon = job('J002', { route: [step()], holder: holder({ due: '2026-11-13' }) })
  assert.deepEqual(orderJobs([none, done, routed, soon]).map(j => j.number), ['J002', 'J001', 'J003', 'J004'])
})

test('the route strip is nothing without a route, and draws each state of a step with its words', () => {
  assert.equal(renderToStaticMarkup(createElement(RouteStrip, { route: [] })), '')
  const html = renderToStaticMarkup(createElement(RouteStrip, { route: [approved, step({ days_late: 2 }), client] }))
  assert.equal((html.match(/data-testid="route-step"/g) || []).length, 3)
  assert.match(html, /data-state="approved"/)
  assert.match(html, /data-state="waiting" data-late="true"/)
  assert.match(html, /data-state="not_started"/)
  assert.match(html, /Approved by aoife@wk on 11 Nov\./)
  assert.match(html, /2 days late\./)
  assert.match(html, /Creative director/)
  assert.doesNotMatch(html, /—/)
})

test('the page: Loading, no answer, no job, no route, and a routed job, each its own state', () => {
  assert.match(page(null, false), /data-state="loading"/)
  assert.match(page(null), /data-state="empty"/)
  assert.match(page([]), /data-state="empty"/)
  assert.match(page([]), /Open the clients/)
  const bare = page([job('J001')])
  assert.match(bare, /No route yet\. Nobody is named to approve this job\./)
  assert.match(bare, /Set the route/)
  assert.doesNotMatch(bare, /route-strip/)
  const html = page([routed])
  assert.match(html, /data-testid="approvals"/)
  assert.match(html, /J001, Client A/)
  assert.match(html, /Waiting on dara@wk, creative director, for 2 days\. Due 14 Nov\./)
  assert.match(html, /Change the route/)
  assert.equal((html.match(/data-testid="route-step"/g) || []).length, 3)
  assert.match(page([job('J001', { route: [approved], holder: null })]), /Every step is approved\./)
})

test('a save the server refuses to this role is Missing access; a step it explains is shown; a lost one is Failed save', () => {
  assert.equal(outcomeOf({ ok: true }), 'saved')
  assert.equal(outcomeOf({ ok: false, status: 403, message: '' }), 'refused')
  assert.equal(outcomeOf({ ok: false, status: 400, message: 'a step\'s due is a date' }), 'problem')
  assert.equal(outcomeOf({ ok: false, status: 400, message: '' }), 'failed')
  assert.equal(outcomeOf({ ok: false, status: 0, message: '' }), 'failed')
  assert.equal(outcomeOf({ ok: false, status: 500, message: 'x' }), 'failed')
})

test('the editor starts from the route as it is, or one blank step, and sends only what the server takes', () => {
  assert.deepEqual(draftOf([]), [blankStep()])
  const rows = draftOf([approved, client])
  assert.deepEqual(rows[1], { stage: 'client-approval', party: 'client', role: 'client', approver: 'Client A contact', contact: 'contact@client-a.example', due: '2026-11-20', rounds: 2 })
  assert.deepEqual(cleanSteps([blankStep()].map(r => ({ ...r, approver: ' dara@wk ', due: '2026-11-14', role: '' }))), [{ stage: 'brief-check', party: 'agency', approver: 'dara@wk', due: '2026-11-14' }])
  // a client's contact and rounds go only on a client step
  const sent = cleanSteps([{ ...rows[1] }, { ...rows[0], party: 'agency', contact: 'x@y.example', rounds: 3 }])
  assert.deepEqual(sent[0], { stage: 'client-approval', party: 'client', role: 'client', approver: 'Client A contact', contact: 'contact@client-a.example', due: '2026-11-20', rounds: 2 })
  assert.equal('contact' in sent[1] || 'rounds' in sent[1], false)
  assert.equal(missingIn([blankStep()]), 'Step 1 needs an approver.')
  assert.equal(missingIn([{ ...blankStep(), approver: 'dara@wk' }]), 'Step 1 needs a due date.')
  assert.equal(missingIn([{ ...blankStep(), approver: 'dara@wk', due: '2026-11-14' }]), null)
})

test('the editor has a row per step, a client step also asks for the client email and the rounds, and one primary button', () => {
  const html = renderToStaticMarkup(createElement(RouteEditor, { job: 'J001', initial: draftOf([approved, client]), busy: false, problem: 'Stage x is not a stage of a job', onSave: () => {}, onCancel: () => {} }))
  assert.equal((html.match(/data-testid="route-row"/g) || []).length, 2)
  assert.equal((html.match(/Client email/g) || []).length, 1)
  assert.equal((html.match(/Rounds of changes/g) || []).length, 1)
  assert.match(html, /data-testid="route-problem"/)
  assert.equal((html.match(/ch-btn-primary/g) || []).length, 1)
  assert.doesNotMatch(html, /—/)
})

const need = (over: Partial<JobNeed> = {}): JobNeed => ({
  job: 'J001', client: 'Client A', client_id: 'cli_00000001', text: 'Brief check: your approval is 2 days late, due 14 Nov.', action: 'Review and approve', path: 'brief.clan', due: '2026-11-14', ...over,
})

test('a Needs you row for an approval says how late; a need without the new fields reads as it always did', () => {
  const late = jobNeedRow(need({ id: 'J001:brief-check:creative_director:approval', kind: 'approval', stage: 'brief-check', days_late: 2 }))
  assert.equal(late.state, '2 days late')
  assert.equal(late.id, 'J001:brief-check:creative_director:approval')
  assert.equal(jobNeedRow(need({ kind: 'approval', days_late: 1 })).state, '1 day late')
  assert.equal(jobNeedRow(need({ kind: 'approval', days_late: 0 })).state, 'Due 14 Nov')
  // an older host: none of the new fields
  const old = jobNeedRow(need())
  assert.equal(old.state, 'Due 14 Nov')
  assert.equal(old.id, undefined)
  // a gate need carries days_late null and keeps its deadline
  assert.equal(jobNeedRow(need({ kind: 'gate', stage: 'brief-check', days_late: null })).state, 'Due 14 Nov')
})

test('nothing on the approvals page totals, averages or ranks people', () => {
  const html = page([routed, job('J002', { route: [step({ approver: 'tadhg@wk' })], holder: holder({ person: 'tadhg@wk' }) })])
  assert.doesNotMatch(html, /average|total|ranking|leaderboard|slowest|fastest|per person/i)
})
