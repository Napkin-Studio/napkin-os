// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Roles and homes (features/roles-and-homes.clan): a home draws the doors the server sent, at most five;
// two roles are one merged home; the role switcher is there only when the server sent it; the O draws five
// circles and lists the rest; a door whose tool comes later opens its Empty state; Needs you shows five rows
// and Show all. The doors come from napkin-web/src/roles.rs (its own tests hold the table); here they are
// fixtures shaped like its answer. De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DoorEntry, HomeView, MapCircle } from '../src/host/http.ts'
import type { LibraryItem } from '../src/host/types.ts'
import { DoorPage } from '../src/shell/home/DoorPage.tsx'
import { DOORS } from '../src/components/states/doors.ts'
import { Home } from '../src/shell/home/Home.tsx'
import { TheO } from '../src/shell/home/TheO.tsx'
import { doorIsLive, doorTool, hello, needsLine, needsRows, NEEDS_FIRST, placeOf } from '../src/shell/home/model.ts'
import { formatRoute, parseRoute } from '../src/shell/route.ts'

const e = (id: string, name: string): DoorEntry => ({ id, name })
const circle = (id: string, name: string, mine = false, opens: string | null = null): MapCircle => ({ id, name, mine, opens })
const PLANNING = [e('brief', 'Brief'), e('research', 'Research'), e('territories', 'Territories'), e('client-brains', 'Client brains'), e('presentations', 'Presentations')]
const view = (over: Partial<HomeView> = {}): HomeView => ({
  roles: ['planning'], restricted: true, title: 'Planning', viewing: null, doors: PLANNING,
  more: [e('ideas', 'Ideas (read only)'), e('case-study-builder', 'Case study builder (read only)')],
  map: { circles: [circle('planning', 'Planning', true, 'planning')], other: [] }, switcher: null, ...over,
})
const noop = () => {}
const count = (html: string, re: RegExp) => (html.match(re) || []).length
const APPS = ['ie.napkin.brief-maker', 'ie.napkin.campaign-research', 'ie.napkin.deck-maker']
let seq = 0
const need = (title: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${++seq}`, app_id: 'ie.napkin.brief-maker', title, updated_at: '2026-11-04T10:00:00Z',
  client: { id: 'cli_00000001', name: 'Client A' }, state: { needs_you: 1, locked: false }, run: null, ...over,
})
const home = (v: HomeView, items: LibraryItem[] = []) => renderToStaticMarkup(createElement(Home, {
  view: v, items, first: 'Aoife', apps: APPS, onDoor: noop, onOpenDocument: noop, onMap: noop, onSwitch: noop,
}))

test('a home draws the doors it was sent, in order, and More tools as a text list', () => {
  const html = home(view())
  assert.equal(count(html, /data-testid="door"/g), 5)
  const names = [...html.matchAll(/data-testid="door"[^>]*>([^<]*)</g)].map(m => m[1])
  assert.deepEqual(names, ['Brief', 'Research', 'Territories', 'Client brains', 'Presentations'])
  assert.equal(count(html, /data-testid="more-tool"/g), 2)
  assert.match(html, /<h2[^>]*>More tools<\/h2>/)
  assert.match(html, />PLANNING · HOME</)
  assert.match(html, /Good (morning|afternoon|evening), <span class="hm-nb">Aoife</)
})

test('a door is ink where its tool exists and dashed where it comes in a later phase', () => {
  const html = home(view())
  const live = [...html.matchAll(/data-door="([a-z-]+)" data-live="true"/g)].map(m => m[1])
  assert.deepEqual(live, ['brief', 'research', 'presentations'])
  assert.match(html, /aria-label="Client brains, comes in a later phase"/)
  assert.equal(doorIsLive('clients', []), true, 'the client desk always exists')
  assert.equal(doorIsLive('brief', []), false, 'a tool whose app is not installed is not live')
  assert.equal(doorTool('presentations'), 'deck')
  assert.equal(doorTool('client-brains'), null)
})

test('a merged home of two roles is still five doors', () => {
  const merged = view({
    roles: ['planning', 'creative-director'], title: 'Planning and Creative director',
    doors: [e('brief', 'Brief'), e('ideas', 'Ideas'), e('research', 'Research'), e('ready-for-review', 'Ready for review'), e('territories', 'Territories')],
    more: [e('judge-scores', 'Judge scores'), e('client-brains', 'Client brains')],
  })
  const html = home(merged)
  assert.equal(count(html, /data-testid="door"/g), 5)
  assert.match(html, />PLANNING AND CREATIVE DIRECTOR · HOME</)
  assert.equal(count(html, /data-testid="more-tool"/g), 2)
})

test('the role switcher is on the page only when the server sent it', () => {
  assert.equal(count(home(view()), /data-testid="role-switcher"/g), 0, 'a planner has none')
  const admin = home(view({ roles: ['admin'], switcher: [{ id: 'planning', title: 'Planning' }, { id: 'copywriter', title: 'Copywriter' }] }))
  assert.equal(count(admin, /data-testid="role-switcher"/g), 1)
  assert.match(admin, /<option value="" selected="">My home<\/option>/)
  assert.match(admin, /<option value="copywriter">Copywriter<\/option>/)
})

test('Needs you: five rows, then Show all, each with its next action; none says so and names no invented deadline', () => {
  const items = Array.from({ length: 7 }, (_, i) => need(`Brief ${i + 1}`))
  const html = home(view(), items)
  assert.equal(count(html, /data-testid="need"/g), NEEDS_FIRST)
  assert.match(html, /data-testid="needs-show-all">Show all 7</)
  assert.match(html, />Make the calls</)
  assert.match(html, /7 things need you\./)
  const failed = needsRows([need('Deck', { app_id: 'ie.napkin.deck-maker', state: { needs_you: 0, locked: false }, run: { state: 'failed', label: 'Failed' } as never })])
  assert.equal(failed[0].action, 'See what failed')
  const quiet = home(view(), [need('Locked', { state: { needs_you: 0, locked: true } })])
  assert.equal(count(quiet, /data-testid="need"/g), 0)
  assert.match(quiet, /data-testid="needs-empty">Nothing needs you now\./)
  assert.equal(needsLine(1), '1 thing needs you.')
  assert.equal(hello(null, new Date('2026-11-11T08:00:00')), 'Good morning')
})

test('the O: five circles with the own department first, the rest as a text list', () => {
  const five = [circle('management', 'Management', true, 'management'), circle('clients', 'Clients'), circle('account-service', 'Account service', false, 'account-service'), circle('planning', 'Planning', false, 'planning'), circle('creative', 'Creative', false, 'creative-director')]
  const other = [circle('production', 'Production', false, 'producer'), circle('agency-brain', 'Agency Brain', false, 'agency-brain')]
  const html = renderToStaticMarkup(createElement(TheO, { view: view({ roles: ['admin'], map: { circles: five, other } }), agency: 'Agency A', onOpen: noop, onHome: noop }))
  assert.equal(count(html, /data-testid="o-circle"/g), 5)
  assert.equal(count(html, /data-testid="other-department"/g), 2)
  assert.match(html, /<h2[^>]*>Other departments<\/h2>/)
  assert.match(html, /data-mine="true"/)
  assert.equal(count(html, /data-mine="true"/g), 1, 'only the own department is marked')
  assert.match(html, /data-testid="o-logo"[^>]*><span>Agency A<\/span>/, 'no logo supplied: the agency name at the centre')
  // one department: no list of others at all
  const one = renderToStaticMarkup(createElement(TheO, { view: view(), agency: 'Agency A', onOpen: noop, onHome: noop }))
  assert.equal(count(one, /data-testid="o-circle"/g), 1)
  assert.doesNotMatch(one, /Other departments/)
  // the circles sit round the logo: the first straight above the centre
  assert.deepEqual(placeOf(0, 5), { left: '50%', top: '13%' })
  assert.equal(placeOf(2, 4).left, '50%', 'the third of four is straight below')
  assert.equal(placeOf(2, 4).top, '87%')
})

test('a door whose tool comes in a later phase opens its Empty state, not an error', () => {
  const html = renderToStaticMarkup(createElement(DoorPage, { door: 'client-brains', name: 'Client brains', clients: [], items: [], apps: APPS, go: noop }))
  assert.match(html, /data-state="empty"/)
  assert.match(html, /What the agency knows about one client goes here\./)
  assert.match(html, /Example · Client A, an Irish whiskey/)
  assert.doesNotMatch(html, /role="alert"|error|Something went wrong/i)
  assert.match(html, />Client brains<span class="period-dot"/)
  // a door of one of the five newer homes has its own words, not the generic line
  const later = renderToStaticMarkup(createElement(DoorPage, { door: 'stills', name: 'Stills', clients: [], items: [], apps: APPS, go: noop }))
  assert.match(later, /data-state="empty"/)
  assert.match(later, /Stills for a job go here, each with how it was made\./)
  assert.doesNotMatch(later, /Stills goes here\./)
  // an id the table does not know (an agency's own door) still opens a plain Empty state
  const own = renderToStaticMarkup(createElement(DoorPage, { door: 'wall-chart', name: 'Wall chart', clients: [], items: [], apps: APPS, go: noop }))
  assert.match(own, /data-state="empty"/)
  assert.match(own, /Wall chart goes here\./)
})

test('the door table: Phase 1 answers are unchanged, and a door with no line is not live', () => {
  const APPS_ALL = ['ie.napkin.brief-maker', 'ie.napkin.campaign-research', 'ie.napkin.deck-maker']
  assert.equal(doorIsLive('brief', APPS_ALL), true)
  assert.equal(doorIsLive('research', APPS_ALL), true)
  assert.equal(doorIsLive('presentations', APPS_ALL), true)
  assert.equal(doorIsLive('brief', ['ie.napkin.deck-maker']), false, 'an app that is not installed is not live')
  assert.equal(doorIsLive('clients', []), true)
  assert.equal(doorIsLive('agency-dashboard', []), true)
  assert.equal(doorIsLive('live-jobs', APPS_ALL), false, 'the job page is built by its own record')
  assert.equal(doorIsLive('script-editor', APPS_ALL), false, 'no line, no tool')
  assert.equal(doorTool('brief'), 'brief')
  assert.equal(doorTool('research'), 'research')
  assert.equal(doorTool('presentations'), 'deck')
  for (const id of ['clients', 'agency-dashboard', 'live-jobs', 'stills', 'approvals']) assert.equal(doorTool(id), null, id)
})

test('a door whose tool exists asks which client, and says how many it has of each', () => {
  const clients = [{ id: 'cli_00000001', name: 'Client A', initials: 'CA', material: 'pearl', owner: 'human:t', created_at: '2026-11-01T00:00:00Z' }]
  const html = renderToStaticMarkup(createElement(DoorPage, { door: 'brief', name: 'Brief', clients: clients as never, items: [need('J001 brief')], apps: APPS, go: noop }))
  assert.equal(count(html, /data-testid="door-client"/g), 1)
  assert.match(html, /1 brief/)
  assert.doesNotMatch(html, /data-state="empty"/)
  const none = renderToStaticMarkup(createElement(DoorPage, { door: 'brief', name: 'Brief', clients: [], items: [], apps: APPS, go: noop }))
  assert.match(none, /data-state="empty"/)
})

test('the routes: the map, a door and another role\'s home are hashes, and nothing else is', () => {
  for (const [hash, r] of [['#map', { level: 'map' }], ['#door-client-brains', { level: 'door', door: 'client-brains' }], ['#home-copywriter', { level: 'home', as: 'copywriter' }]] as const) {
    assert.deepEqual(parseRoute(hash), r)
    assert.equal(formatRoute(parseRoute(hash)), hash)
  }
  for (const hostile of ['#door-', '#door-../x', '#door-A', '#home-', '#home-x/y', '#door-' + 'a'.repeat(60)]) {
    assert.deepEqual(parseRoute(hostile), { level: 'agency' }, hostile)
  }
})

test('every word on a home says no em dash', () => {
  const html = home(view({ roles: ['admin'], switcher: [{ id: 'planning', title: 'Planning' }] }), [need('Brief')])
  assert.doesNotMatch(html, /—|–/)
  const door = renderToStaticMarkup(createElement(DoorPage, { door: 'client-brains', name: 'Client brains', clients: [], items: [], apps: APPS, go: noop }))
  assert.doesNotMatch(door, /—|–/)
})

test('every door with no tool opens its own Empty state: its line, its verb, its example and the reason', () => {
  const none = DOORS.filter(d => !doorIsLive(d.id, APPS) || d.id === 'live-jobs')
  assert.ok(none.length >= 30)
  for (const d of none) {
    const html = renderToStaticMarkup(createElement(DoorPage, { door: d.id, name: d.name, clients: [], items: [], apps: [], go: noop }))
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')
    assert.match(html, /data-state="empty"/, d.id)
    assert.ok(html.includes(esc(d.line)), `${d.id} shows its own line`)
    assert.ok(html.includes(esc(d.example.lines[0])), `${d.id} shows its own example`)
    assert.ok(html.includes(`>${esc(d.verb)}<`), `${d.id} shows its own verb`)
    assert.match(html, /This tool comes in a later phase/, d.id)
    assert.doesNotMatch(html, /goes here\.<\/p>.*will list the J001 work here/, d.id)
  }
})
