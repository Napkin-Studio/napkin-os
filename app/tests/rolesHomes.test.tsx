// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What a role adds to the desk (features/align-landing-look.clan, which replaced features/roles-and-homes.clan's home
// and its O): one "Your pages" row of at most five page doors and More as a text list, drawn from what the server
// sent; a door with no page opens the SoonCard with its own example line; Needs you shows five rows and Show all.
// The doors come from napkin-web/src/roles.rs (its own tests hold the table); here they are fixtures shaped like its
// answer. De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DoorEntry, HomeView } from '../src/host/http.ts'
import type { LibraryItem } from '../src/host/types.ts'
import { DoorPage } from '../src/shell/home/DoorPage.tsx'
import { NeedsYou } from '../src/shell/home/NeedsYou.tsx'
import { DOORS } from '../src/components/states/doors.ts'
import { doorIsLive } from '../src/shell/home/doorTargets.ts'
import { hello, needsLine, needsRows, NEEDS_FIRST } from '../src/shell/home/model.ts'
import { PagesRow } from '../src/shell/nui/PagesRow.tsx'
import { formatRoute, parseRoute } from '../src/shell/route.ts'

const e = (id: string, name: string): DoorEntry => ({ id, name })
const PAGES = [e('client-brains', 'Client brains'), e('case-study-builder', 'Case study builder (read only)')]
const view = (over: Partial<HomeView> = {}): HomeView => ({
  roles: ['planning'], restricted: true, title: 'Planning', viewing: null, pages: PAGES, more: [],
  tools: ['brief', 'research', 'territories', 'deck', 'idea'], switcher: null, jobs: { manage: true, budget: false }, ...over,
})
const noop = () => {}
const count = (html: string, re: RegExp) => (html.match(re) || []).length
let seq = 0
const need = (title: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${++seq}`, app_id: 'ie.napkin.brief-maker', title, updated_at: '2026-11-04T10:00:00Z',
  client: { id: 'cli_00000001', name: 'Client A' }, state: { needs_you: 1, locked: false }, run: null, ...over,
})
const row = (v: HomeView) => renderToStaticMarkup(createElement(PagesRow, { view: v, onOpen: noop }))
const needs = (items: LibraryItem[] = []) => renderToStaticMarkup(createElement(NeedsYou, { items, onOpenDocument: noop, onApprovals: noop }))

test('the row draws the pages it was sent, in order, headed Your pages, with More as a text list', () => {
  const html = row(view({
    pages: [e('agency-dashboard', 'Agency dashboard'), e('live-jobs', 'Live jobs'), e('time-money', 'Time and money'), e('traffic-board', 'Traffic board'), e('approvals', 'Approvals')],
    more: [e('judge-scores', 'Judge scores'), e('client-brains', 'Client brains')],
  }))
  assert.match(html, /<h2[^>]*>Your pages<\/h2>/)
  assert.equal(count(html, /data-testid="door"/g), 5)
  const names = [...html.matchAll(/data-testid="door"[^>]*>([^<]*)</g)].map(m => m[1])
  assert.deepEqual(names, ['Agency dashboard', 'Live jobs', 'Time and money', 'Traffic board', 'Approvals'])
  assert.equal(count(html, /data-testid="more-tool"/g), 2)
  assert.match(html, /<span class="pg-h">More<\/span>/)
})

test('a person with no role has no row, and a page is ink where it is built and dashed where it is not', () => {
  assert.equal(row(view({ restricted: false })), '')
  const html = row(view({ pages: [e('live-jobs', 'Live jobs'), e('stills', 'Stills')] }))
  assert.deepEqual([...html.matchAll(/data-door="([a-z-]+)" data-live="true"/g)].map(m => m[1]), ['live-jobs'])
  assert.match(html, /aria-label="Stills, comes in a later phase"/)
  assert.equal(doorIsLive('agency-dashboard'), true)
  assert.equal(doorIsLive('brief'), false, 'a tool is not a page door')
  assert.equal(doorIsLive('script-editor'), false)
})

test('the row is named for feedback by pointing: each page door is a control labelled with the door', () => {
  const html = row(view({ pages: [e('live-jobs', 'Live jobs')] }))
  assert.match(html, /data-dogfood="page-door-live-jobs"/)
  assert.match(html, /aria-label="Live jobs"/)
})

test('Needs you: five rows, then Show all, each with its next action; none says so and names no invented deadline', () => {
  const items = Array.from({ length: 7 }, (_, i) => need(`Brief ${i + 1}`))
  const html = needs(items)
  assert.equal(count(html, /data-testid="need"/g), NEEDS_FIRST)
  assert.match(html, /data-testid="needs-show-all">Show all 7</)
  assert.match(html, />Make the calls</)
  const failed = needsRows([need('Deck', { app_id: 'ie.napkin.deck-maker', state: { needs_you: 0, locked: false }, run: { state: 'failed', label: 'Failed' } as never })])
  assert.equal(failed[0].action, 'See what failed')
  const quiet = needs([need('Locked', { state: { needs_you: 0, locked: true } })])
  assert.equal(count(quiet, /data-testid="need"/g), 0)
  assert.match(quiet, /data-testid="needs-empty">Nothing needs you now\./)
  assert.equal(needsLine(1), '1 thing needs you.')
  assert.equal(hello(null, new Date('2026-11-11T08:00:00')), 'Good morning')
})

test('a door with no page opens the SoonCard with its own example line and one way back to the desk', () => {
  const html = renderToStaticMarkup(createElement(DoorPage, { door: 'client-brains', name: 'Client brains', clients: [], go: noop }))
  assert.match(html, /data-testid="door-soon"/)
  assert.match(html, /data-teaser="client-brains"/)
  assert.match(html, /data-state="empty"/)
  assert.match(html, /What the agency knows about one client goes here\./)
  assert.match(html, /Example · Client A, an Irish whiskey/)
  assert.match(html, /data-testid="to-desk"/)
  assert.doesNotMatch(html, /role="alert"|error|Something went wrong/i)
  const later = renderToStaticMarkup(createElement(DoorPage, { door: 'stills', name: 'Stills', clients: [], go: noop }))
  assert.match(later, /Stills for a job go here, each with how it was made\./)
  // an id the table does not know (an agency's own door) still opens a plain card
  const own = renderToStaticMarkup(createElement(DoorPage, { door: 'wall-chart', name: 'Wall chart', clients: [], go: noop }))
  assert.match(own, /Wall chart goes here\./)
})

test('every door in doors.ts that has no page opens its own line, verb and example', () => {
  const none = DOORS.filter(d => !doorIsLive(d.id))
  assert.ok(none.length >= 28)
  for (const d of none) {
    const html = renderToStaticMarkup(createElement(DoorPage, { door: d.id, name: d.name, clients: [], go: noop }))
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')
    assert.match(html, /data-state="empty"/, d.id)
    assert.ok(html.includes(esc(d.line)), `${d.id} shows its own line`)
    assert.ok(html.includes(esc(d.example.lines[0])), `${d.id} shows its own example`)
  }
})

test('the routes: a page door is a hash; the map and another role\'s home are not, and fall to the desk', () => {
  for (const [hash, r] of [['#door-client-brains', { level: 'door', door: 'client-brains' }]] as const) {
    assert.deepEqual(parseRoute(hash), r)
    assert.equal(formatRoute(parseRoute(hash)), hash)
  }
  for (const old of ['#map', '#home-copywriter', '#home-planning']) assert.deepEqual(parseRoute(old), { level: 'agency' }, old)
  for (const hostile of ['#door-', '#door-../x', '#door-A', '#door-' + 'a'.repeat(60)]) {
    assert.deepEqual(parseRoute(hostile), { level: 'agency' }, hostile)
  }
})

test('every word on the row and its doors says no em dash', () => {
  assert.doesNotMatch(row(view({ more: [e('judge-scores', 'Judge scores')] })), /—|–/)
  assert.doesNotMatch(needs([need('Brief')]), /—|–/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(DoorPage, { door: 'client-brains', name: 'Client brains', clients: [], go: noop })), /—|–/)
})
