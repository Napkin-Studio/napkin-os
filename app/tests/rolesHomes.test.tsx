// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The desk's "Your pages" row (features/align-landing-look.clan, which took over features/roles-and-homes.clan):
// the row draws the page doors the server sent, at most five, with the rest under More as a text list; the
// admin's View as is there only when the server sent the roles; a page door with no page yet opens develop's
// SoonCard with its own words and one way back to the desk; the old role-home addresses fall to the desk.
// The doors come from napkin-web/src/roles.rs (its own tests hold the table); here they are fixtures shaped
// like its answer. De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'

import type { DoorEntry } from '../src/host/http.ts'
import { DoorPage } from '../src/shell/home/DoorPage.tsx'
import { BUILT_PAGES, teaserFor } from '../src/shell/home/doorWords.ts'
import { YourPages } from '../src/shell/home/YourPages.tsx'
import { ViewAsDialog } from '../src/shell/home/ViewAsDialog.tsx'
import { DOORS } from '../src/components/states/doors.ts'
import { describeShell } from '../src/dogfood/pointer.ts'
import { formatRoute, parseRoute } from '../src/shell/route.ts'

const e = (id: string, name: string): DoorEntry => ({ id, name })
const noop = () => {}
const count = (html: string, re: RegExp) => (html.match(re) || []).length
const FIVE = [e('agency-dashboard', 'Agency dashboard'), e('live-jobs', 'Live jobs'), e('time-money', 'Time and money'), e('traffic-board', 'Traffic board'), e('people', 'People')]
const MORE = [e('agency-brain', 'Agency Brain (read only)'), e('audit', 'Audit')]
const row = (pages: DoorEntry[], more: DoorEntry[] = []) => renderToStaticMarkup(createElement(YourPages, { pages, more, onOpen: noop }))

test('the row draws the page doors it was sent, in order, under the heading Your pages', () => {
  const html = row(FIVE, MORE)
  assert.match(html, /<h2[^>]*>Your pages<\/h2>/)
  const names = [...html.matchAll(/data-testid="page-door"[^>]*>([^<]*)</g)].map(m => m[1])
  assert.deepEqual(names, FIVE.map(d => d.name))
  assert.equal(count(html, /data-testid="page-door"/g), 5)
})

test('what did not fit is under More as a text list, closed until asked for', () => {
  const html = row(FIVE, MORE)
  assert.equal(count(html, /data-testid="pages-more"/g), 1)
  assert.match(html, /aria-expanded="false"/)
  assert.equal(count(html, /data-testid="more-page"/g), 0, 'the list is closed on arrival')
  assert.equal(count(row(FIVE), /data-testid="pages-more"/g), 0, 'no More button when nothing is left')
})

test('a person with no page doors gets no row at all', () => {
  assert.equal(row([], []), '')
})

test('the row and its items are named for feedback by pointing, as the desk\'s own rows are: a control, labelled by the door', () => {
  const doc = new JSDOM(row(FIVE, MORE)).window.document
  const button = doc.querySelector('[data-testid="page-door"][data-door="live-jobs"]')!
  const found = describeShell(button as never)
  assert.deepEqual(found?.target, { kind: 'control', id: 'page: Live jobs', label: 'Live jobs' })
  // a part of the row that is not a button is named for the row itself
  const heading = doc.querySelector('h2')!
  assert.deepEqual(describeShell(heading as never)?.target, { kind: 'section', id: 'your-pages', label: 'Your pages' })
})

test('View as lists the roles the server sent, with the admin\'s own view first', () => {
  const html = renderToStaticMarkup(createElement(ViewAsDialog, { roles: [{ id: 'planning', title: 'Planning' }, { id: 'copywriter', title: 'Copywriter' }], current: 'copywriter', onPick: noop, onClose: noop }))
  assert.match(html, /<option value="">My own view<\/option>/)
  assert.match(html, /<option value="copywriter" selected="">Copywriter<\/option>/)
  assert.equal(count(html, /data-testid="role-switcher"/g), 1)
})

test('a page door with no page yet opens the SoonCard with that door\'s own words, and one way back to the desk', () => {
  const html = renderToStaticMarkup(createElement(DoorPage, { door: 'client-brains', name: 'Client brains', clients: [], go: noop }))
  assert.match(html, /data-teaser="door:client-brains"/)
  assert.match(html, /data-state="empty"/)
  assert.match(html, /What the agency knows about one client goes here\./)
  assert.match(html, /Example · Client A, an Irish whiskey/)
  assert.match(html, /Coming soon/)
  assert.doesNotMatch(html, /role="alert"|error|Something went wrong/i)
  assert.match(html, />Client brains<span class="period-dot"/)
  assert.equal(count(html, /data-testid="to-home"/g), 1)
  assert.match(html, />Back to the desk</)
  // a door of one of the five newer roles has its own words, not the generic line
  const later = renderToStaticMarkup(createElement(DoorPage, { door: 'stills', name: 'Stills', clients: [], go: noop }))
  assert.match(later, /Stills for a job go here, each with how it was made\./)
  assert.doesNotMatch(later, /Stills goes here\./)
  // an id the table does not know (an agency's own door) still opens a plain card
  const own = renderToStaticMarkup(createElement(DoorPage, { door: 'wall-chart', name: 'Wall chart', clients: [], go: noop }))
  assert.match(own, /data-state="empty"/)
  assert.match(own, /Wall chart goes here\./)
})

test('every door that has no page opens its own SoonCard: its line, its verb and its example', () => {
  const none = DOORS.filter(d => !BUILT_PAGES.includes(d.id))
  assert.ok(none.length >= 28)
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')
  for (const d of none) {
    const html = renderToStaticMarkup(createElement(DoorPage, { door: d.id, name: d.name, clients: [], go: noop }))
    assert.match(html, /data-state="empty"/, d.id)
    assert.ok(html.includes(esc(d.line)), `${d.id} shows its own line`)
    assert.ok(html.includes(esc(d.example.lines[0])), `${d.id} shows its own example`)
    assert.ok(html.includes(`>${esc(d.verb)}<`), `${d.id} shows its own verb`)
    assert.equal(teaserFor(d.id, d.name).example, d.example, d.id)
  }
})

test('a built page door opens its page, not a card', () => {
  for (const id of BUILT_PAGES) {
    const html = renderToStaticMarkup(createElement(DoorPage, { door: id, name: null, clients: [], go: noop }))
    assert.doesNotMatch(html, /data-testid="soon-door"/, id)
  }
})

test('the routes: a page door is a hash, and the old map and role homes fall to the desk like any unknown address', () => {
  const door = parseRoute('#door-client-brains')
  assert.deepEqual(door, { level: 'door', door: 'client-brains' })
  assert.equal(formatRoute(door), '#door-client-brains')
  for (const old of ['#map', '#home-copywriter', '#home-', '#home-planning', '#door-', '#door-../x', '#door-A', '#door-' + 'a'.repeat(60)]) {
    assert.deepEqual(parseRoute(old), { level: 'agency' }, old)
  }
})

test('every word on the row, the door pages and the dialog says no em dash', () => {
  const html = row(FIVE, MORE)
  assert.doesNotMatch(html, /—|–/)
  for (const d of DOORS) assert.doesNotMatch(renderToStaticMarkup(createElement(DoorPage, { door: d.id, name: d.name, clients: [], go: noop })), /—|–/, d.id)
  assert.doesNotMatch(renderToStaticMarkup(createElement(ViewAsDialog, { roles: [{ id: 'planning', title: 'Planning' }], current: null, onPick: noop, onClose: noop })), /—|–/)
})
