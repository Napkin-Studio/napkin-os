// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Needs you in full (features/needs-you-full.clan): an empty list names the next deadline (three wordings), a notice
// has a quiet Done and a task has none, the row says what it is, Undo lasts five seconds, and nothing on the list moves.
// The press of Done and the five seconds run in the browser (e2e test 24); here is what the page draws and says.
// De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { JobNeed } from '../src/host/types.ts'
import { NeedsYou } from '../src/shell/home/NeedsYou.tsx'
import { emptyLine, jobNeedRow, UNDO_MS } from '../src/shell/home/model.ts'

const need = (over: Partial<JobNeed>): JobNeed => ({
  id: 'J001:brief-check:everyone:brief-changed:abc', kind: 'brief-changed', stage: 'brief-check', job: 'J001', client: 'Client A', client_id: 'cli_00000001',
  text: 'J001 brief: the brief has a new version since it was signed.', action: 'Open the brief', path: 'documents/b.clan', due: '2026-12-18', due_source: 'job',
  urgent: false, can_done: true, ...over,
})
const noop = () => {}
const home = (jobNeeds: JobNeed[], nextDeadline?: JobNeed extends never ? never : { job: string; client: string; client_id: string; due: string } | null) =>
  renderToStaticMarkup(createElement(NeedsYou, { items: [], jobNeeds, nextDeadline, onOpenDocument: noop, onApprovals: noop }))

test('an empty list names the next deadline, or says none is set, or says only that nothing needs you', () => {
  assert.equal(emptyLine({ job: 'J001', client: 'Client A', client_id: 'c', due: '2026-12-18' }), 'Nothing needs you now. Next deadline: J001, Client A, 18 Dec.')
  assert.equal(emptyLine(null), 'Nothing needs you now. No deadline is set on your jobs.')
  assert.equal(emptyLine(undefined), 'Nothing needs you now.')
  assert.match(home([], { job: 'J001', client: 'Client A', client_id: 'c', due: '2026-12-18' }), /data-testid="needs-empty"[^>]*>Nothing needs you now\. Next deadline: J001, Client A, 18 Dec\./)
  assert.match(home([], null), /No deadline is set on your jobs\./)
})

test('a notice has a quiet Done named for its row, and a task has none', () => {
  const html = home([
    need({}),
    need({ id: 'J001:brief-check:planner:gate', kind: 'gate', text: 'J001 brief: passed the gate. It needs your signature.', action: 'Sign the brief', can_done: false }),
  ])
  assert.equal((html.match(/data-testid="need"/g) || []).length, 2)
  assert.equal((html.match(/>Done<\/button>/g) || []).length, 1, 'one Done, on the notice')
  assert.match(html, /aria-label="Done: J001 brief: the brief has a new version since it was signed\."/)
  assert.match(html, /data-kind="gate"/)
  assert.match(html, /data-id="J001:brief-check:planner:gate"/)
  // the changed-brief banner above the list is gone: a changed brief is a row like any other
  assert.doesNotMatch(html, /data-testid="alert"/)
})

test('a notice row says what it is: late, due, or the timesheet of today', () => {
  assert.equal(jobNeedRow(need({})).state, 'Due 18 Dec')
  assert.equal(jobNeedRow(need({ kind: 'approval', days_late: 2, can_done: false })).state, '2 days late')
  const sheet = jobNeedRow(need({ kind: 'timesheet', job: '', client: '', client_id: '', path: '', due: '2026-11-12', can_done: true, text: "Today's timesheet is not confirmed.", action: 'Open your timesheet' }))
  assert.equal(sheet.state, 'Today')
  assert.equal(sheet.job, undefined, 'a day has no job to link')
  assert.equal(sheet.canDone, true)
  assert.equal(jobNeedRow(need({ can_done: undefined })).canDone, false, 'an older host sends no Done')
})

test('Undo lasts five seconds, and nothing on the list moves, so Reduce motion has nothing to stop', () => {
  assert.equal(UNDO_MS, 5000)
  const css = readFileSync(join(process.cwd(), 'src/shell/home/home.css'), 'utf8') // npm test runs in app/
  const rules = css.split('}').filter(r => /\.hm-need|\.hm-done/.test(r))
  assert.ok(rules.length > 0)
  for (const r of rules) assert.doesNotMatch(r, /(^|[\s;{])(transition|animation|transform)\s*:/, r)
})
