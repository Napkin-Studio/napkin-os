// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// First day (features/first-day.clan): three pointers shown once, one at a time, each beside the real thing on the
// desk; the sign-in name that comes from the link; the invite on a person's row of the People page; the first task
// as the first row of Me. The mark and the first task are the server's (crates/napkin-web/tests/first_day.rs).

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { JobNeed } from '../src/host/types.ts'
import { POINTERS, pointerKey, placement, stepsFrom } from '../src/shell/firstday/anchors.ts'
import { InviteForm } from '../src/shell/firstday/InviteRow.tsx'
import { makeInvite } from '../src/shell/firstday/invite.ts'
import { PointerCard } from '../src/shell/firstday/Pointers.tsx'
import { welcomeName } from '../src/shell/firstday/welcome.ts'
import { BUTTONS, POINTER_WORDS } from '../src/shell/firstday/words.ts'
import { meRows } from '../src/shell/nui/meRows.ts'

const src = resolve(process.cwd(), 'src/shell/firstday')
const ALL = new Set(['[data-testid="your-pages"]', '#cl-row', '[data-testid="os-bar"]', '[data-testid="me-row"]', '[data-testid="pick-up"]', '[data-testid="decisions"]'])
const has = (present: Set<string>) => (sel: string) => present.has(sel)

test('three pointers in order: the person\'s pages, the OS bar, Needs you, each with its own words', () => {
  const steps = stepsFrom(has(ALL))
  assert.deepEqual(steps.map(s => s.id), ['pages', 'bar', 'needs'])
  assert.deepEqual(steps.map(s => s.words), [
    'Your pages and your clients. Open one to start.',
    'This bar is on every screen. Press Cmd K to find anything.',
    'Needs you. What is waiting for you, soonest first.',
  ])
  assert.equal(POINTER_WORDS.pages, steps[0].words)
  assert.equal(POINTERS.length, 3)
  assert.deepEqual([BUTTONS.next, BUTTONS.gotIt], ['Next', 'Got it'])
})

test('each pointer stands beside the first anchor that is there: Your pages, else the client circles; a Needs you row, else the list', () => {
  const noPages = new Set(ALL); noPages.delete('[data-testid="your-pages"]')
  assert.equal(stepsFrom(has(noPages))[0].anchor, '#cl-row')
  assert.equal(stepsFrom(has(ALL))[0].anchor, '[data-testid="your-pages"]')
  assert.equal(stepsFrom(has(ALL))[2].anchor, '[data-testid="me-row"]')
  const noRow = new Set(ALL); noRow.delete('[data-testid="me-row"]')
  assert.equal(stepsFrom(has(noRow))[2].anchor, '[data-testid="pick-up"]')
})

test('a missing anchor skips its pointer: two show, not three, and nothing throws', () => {
  const noBar = new Set(ALL); noBar.delete('[data-testid="os-bar"]')
  assert.deepEqual(stepsFrom(has(noBar)).map(s => s.id), ['pages', 'needs'])
  assert.deepEqual(stepsFrom(has(new Set())), [])
  assert.doesNotThrow(() => stepsFrom(() => { throw new Error('no DOM') }))
})

test('the keyboard: Escape ends, nothing else is taken', () => {
  assert.equal(pointerKey('Escape'), 'end')
  for (const k of ['Tab', 'Enter', ' ', 'ArrowRight', 'a']) assert.equal(pointerKey(k), null, k)
})

const step = (i: number) => stepsFrom(has(ALL))[i]
const card = (i: number, over: object = {}) => renderToStaticMarkup(createElement(PointerCard, {
  step: step(i), at: i, count: 3, still: false, spot: { top: 100, left: 20 }, onNext: () => {}, onGotIt: () => {}, ...over,
}))

test('a pointer is a dialog without a veil or a trap, named for feedback, with Next and Got it (Got it alone on the last)', () => {
  const html = card(0)
  assert.match(html, /data-testid="pointer"/)
  assert.match(html, /role="dialog"/)
  assert.doesNotMatch(html, /aria-modal/)
  assert.match(html, /data-feedback-label="First day pointer: Your pages"/)
  assert.match(html, /data-anchor="pages"/)
  assert.match(html, />Next</)
  assert.match(html, />Got it</)
  assert.match(html, /1 of 3/)
  const last = card(2)
  assert.doesNotMatch(last, />Next</)
  assert.match(last, />Got it</)
  assert.match(last, /3 of 3/)
  for (const h of [html, last]) assert.doesNotMatch(h, /—/)
})

test('with Reduce motion nothing moves in', () => {
  assert.match(card(0, { still: true }), /data-still="true"/)
  assert.match(card(0, { still: false }), /data-still="false"/)
  const css = readFileSync(resolve(src, 'firstday.css'), 'utf8')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /min-height: 44px/, 'the primary button is 44 px')
  assert.doesNotMatch(css, /backdrop|rgba\(0, ?0, ?0|inset: 0|bounce|cubic-bezier\([^)]*-/, 'no veil, no bounce')
})

test('placement: 8 px below the anchor, kept on screen, and above when below would cover what must stay clear', () => {
  const view = { width: 390, height: 800 }
  const size = { width: 300, height: 120 }
  const anchor = { top: 200, left: 10, width: 200, height: 40, bottom: 240, right: 210 }
  assert.deepEqual(placement(anchor, size, view, []), { top: 248, left: 10 })
  const edge = { ...anchor, left: 300, right: 500, width: 200 }
  const p = placement(edge, size, view, [])
  assert.ok(p.left + size.width <= view.width - 8 && p.left >= 8)
  // the consent item sits where the card would land: the card goes above the anchor
  const consent = { top: 250, left: 0, width: 390, height: 100, bottom: 350, right: 390 }
  assert.equal(placement(anchor, size, view, [consent]).top, 200 - 8 - 120)
  // no room below and none above: it stays on screen
  const tall = { top: 380, left: 0, width: 390, height: 40, bottom: 420, right: 390 }
  const q = placement(tall, { width: 300, height: 700 }, view, [])
  assert.ok(q.top >= 8 && q.top + 700 <= view.height + 700)
})

test('the sign-in name starts from the link and from nothing else', () => {
  assert.equal(welcomeName('?welcome=newcomer@wk'), 'newcomer@wk')
  assert.equal(welcomeName('?x=1&welcome=Newcomer%40WK'), 'newcomer@wk')
  assert.equal(welcomeName(''), '')
  assert.equal(welcomeName('?welcome='), '')
  // only a sign-in name: no script, no spaces, no second @
  for (const bad of ['<script>@wk', 'a b@wk', 'a@b@c', 'no-agency', '@wk', 'a@']) assert.equal(welcomeName(`?welcome=${encodeURIComponent(bad)}`), '', bad)
})

const TASK: JobNeed = {
  id: 'first:newcomer@wk', kind: 'first-task', stage: '', days_late: null, job: 'J001', client: 'Client A', client_id: 'client-a',
  text: 'Start with J001 brief', action: 'Open', path: 'doc-b1', due: '2026-11-20', due_source: 'job', urgent: false, can_done: true,
} as JobNeed

test('the first task is the first row of Me, before the timesheet reminder, and opens its document', () => {
  const timesheet = { ...TASK, id: 't', kind: 'timesheet', due: '2026-11-15' } as JobNeed
  const rows = meRows([], [], timesheet, TASK)
  assert.equal(rows[0].key, 'first:newcomer@wk')
  assert.equal(rows[0].path, 'doc-b1')
  assert.equal(rows[0].firstTask, true)
  assert.match(rows[0].title, /J001/)
  assert.match(rows[0].sub, /J001/)
  assert.equal(rows[1].key, 'timesheet')
  assert.equal(meRows([], [], null, null).length, 0)
})

const DOCS = [{ path: 'doc-b1', title: 'J001 brief', job: 'J001', client: 'Client A' }]
const form = (over: object = {}) => renderToStaticMarkup(createElement(InviteForm, {
  docs: DOCS, first: '', email: '', busy: false, link: null, error: null, copied: false,
  onFirst: () => {}, onEmail: () => {}, onMake: () => {}, onCopy: () => {}, onClose: () => {}, ...over,
}))

test('the invite on a person\'s row: a first thing to open from the live jobs, then the link to copy', () => {
  const html = form()
  assert.match(html, /First thing to open/)
  assert.match(html, /<option value="doc-b1">J001, J001 brief<\/option>/)
  assert.match(html, /data-testid="invite-make"/)
  assert.doesNotMatch(html, /data-testid="invite-link"/)
  const done = form({ link: 'http://x.test/?welcome=newcomer@wk' })
  assert.match(done, /data-testid="invite-link"[^>]*value="http:\/\/x.test\/\?welcome=newcomer@wk"/)
  assert.match(done, /Copy the link/)
  assert.match(form({ error: 'That is not a document of this agency.' }), /role="alert"[^>]*>That is not a document/)
  assert.doesNotMatch(html + done, /—/)
})

test('making an invite sends the first thing and the address only, and answers the link or the server\'s words', async () => {
  const sent: unknown[] = []
  const api = {
    invite: async (id: string, body: unknown) => { sent.push([id, body]); return { person: id, link: 'http://x.test/?welcome=a@wk', mailed: false } },
  }
  const ok = await makeInvite(api, 'a@wk', { first: 'doc-b1', email: '' })
  assert.deepEqual(ok, { ok: true, link: 'http://x.test/?welcome=a@wk', mailed: false })
  assert.deepEqual(sent[0], ['a@wk', { first: { path: 'doc-b1' } }])
  await makeInvite(api, 'a@wk', { first: '', email: ' a@mail.example.test ' })
  assert.deepEqual(sent[1], ['a@wk', { email: 'a@mail.example.test' }])
  const refused = await makeInvite({ invite: async () => { throw new Error('That is not a document of this agency.') } }, 'a@wk', { first: 'x', email: '' })
  assert.deepEqual(refused, { ok: false, error: 'That is not a document of this agency.' })
})

test('the words: no price, cost or credit, no score, no em dash', () => {
  const all = [...Object.values(POINTER_WORDS), ...Object.values(BUTTONS), readFileSync(resolve(src, 'words.ts'), 'utf8')].join(' ')
  assert.doesNotMatch(all, /—|price|cost|credit|score|days since|progress/i)
})
