// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing, the clients page, one client and the trail, rendered from data
// with no host: counts line, strips, show all beyond a page, the empty state,
// Add client, accessible names, and state said in words (never colour alone).
// Client names are placeholders (features/landing-circles.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ClientRecord, LibraryItem } from '../src/host/types.ts'
import { Circle } from '../src/shell/landing/Circle.tsx'
import { ClientPage } from '../src/shell/landing/ClientPage.tsx'
import { ClientsPage } from '../src/shell/landing/ClientsPage.tsx'
import { LandingPage } from '../src/shell/landing/LandingPage.tsx'
import { ToolPage } from '../src/shell/landing/ToolPage.tsx'
import { Trail } from '../src/shell/landing/Trail.tsx'
import { agencySummary, initialsOf, ordered, summarise } from '../src/shell/landing/model.ts'
import { TOOLS, toolById } from '../src/shell/landing/tools.ts'

const name = (i: number) => `Client ${String.fromCharCode(65 + i)}`
const client = (i: number): ClientRecord => ({
  id: `cli_${String(i + 1).padStart(8, '0')}`, name: name(i), initials: initialsOf(name(i)), material: ['pearl', 'stone', 'ceramic', 'graphite'][i % 4] as ClientRecord['material'],
  owner: 'human:t', created_at: '2026-11-01T00:00:00Z',
})
let seq = 0
const item = (c: ClientRecord | null, app: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${++seq}`, app_id: app, title: `Work ${seq}`, updated_at: '2026-11-04T10:00:00Z',
  client: c ? { id: c.id, name: c.name } : null, state: { needs_you: 0, locked: false }, run: null, ...over,
})
const BRIEF = 'ie.napkin.brief-maker'
const noop = () => {}
const count = (html: string, re: RegExp) => (html.match(re) || []).length

const clientsPage = (n: number, extra: Partial<Parameters<typeof ClientsPage>[0]> = {}, items: LibraryItem[] = []) => {
  const cs = Array.from({ length: n }, (_, i) => client(i))
  return renderToStaticMarkup(createElement(ClientsPage, {
    agency: 'Studio A', clients: ordered(cs, items), query: '', showAll: false, adding: false,
    onQuery: noop, onShowAll: noop, onAdding: noop, onOpenClient: noop, onAdd: async () => null, ...extra,
  }))
}

test('the landing shows the agency, a counts line from the data and both strips', () => {
  const [a, b] = [client(0), client(1)]
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 1, locked: false } }),
    item(b, 'ie.napkin.deck-maker', { title: 'Pitch', run: { state: 'working', label: 'Building: Layout' } }),
    item(null, BRIEF),
  ]
  const html = renderToStaticMarkup(createElement(LandingPage, {
    agency: 'Studio A', greeting: 'Good morning, Sam.', summary: agencySummary([a, b], items, 1), onOpenAgency: noop, onOpenItem: noop,
  }))
  assert.match(html, /Good morning, Sam\./)
  assert.match(html, /Studio A/)
  assert.match(html, /2 clients · 3 open · 1 needs you · 1 running/)
  assert.match(html, /Brief · Client A/)
  assert.match(html, /Spring brief/)
  assert.match(html, /Deck · Client B/)
  assert.match(html, /Building: Layout/)
  assert.match(html, /1 piece of work is not attached to a client yet\./)
  // the agency circle is one real button, and decorative art is hidden from readers
  assert.equal(count(html, /<button/g), 3, 'the agency and one card for each strip')
  assert.match(html, /<svg[^>]*aria-hidden="true"/)
})

test('a quiet landing says so, and offers the door when there are no clients', () => {
  const html = renderToStaticMarkup(createElement(LandingPage, {
    agency: 'Studio A', greeting: 'Good evening.', summary: agencySummary([], [], 0), onOpenAgency: noop, onOpenItem: noop,
  }))
  assert.match(html, /No clients yet/)
  assert.match(html, /Nothing is waiting on you\./)
  assert.match(html, /Nothing is running\./)
  assert.match(html, /add your first client/)
  assert.doesNotMatch(html, /not attached/)
})

test('a strip lists five and says how many more', () => {
  const a = client(0)
  const items = Array.from({ length: 7 }, () => item(a, BRIEF, { state: { needs_you: 1, locked: false } }))
  const html = renderToStaticMarkup(createElement(LandingPage, {
    agency: 'Studio A', greeting: 'Hello.', summary: agencySummary([a], items, 0), onOpenAgency: noop, onOpenItem: noop,
  }))
  assert.equal(count(html, /lc-card"/g), 5)
  assert.match(html, /and 2 more/)
})

test('the clients page: one circle per client with a name that says everything', () => {
  const [a] = [client(0)]
  const html = clientsPage(3, {}, [item(a, BRIEF, { state: { needs_you: 1, locked: false } }), item(a, BRIEF)])
  assert.equal(count(html, /data-testid="client-circle"/g), 3)
  assert.match(html, /aria-label="Client A, 2 briefs · needs you\. Opens its tools"/)
  assert.match(html, /aria-label="Client B, No work yet, idle\. Opens its tools"/)
  // urgent first: Client A needs you, so it comes before B and C
  assert.ok(html.indexOf('Client A') < html.indexOf('Client B'))
  // state in words beside the colour
  assert.match(html, /needs you/)
  assert.match(html, /Every state is also said in words/)
  // three clients: no search, no Show all
  assert.doesNotMatch(html, /Search clients|Show all/)
  assert.match(html, /3 clients, most urgent first/)
})

test('beyond eight clients there is search and Show all', () => {
  const html = clientsPage(11)
  assert.equal(count(html, /data-testid="client-circle"/g), 8)
  assert.match(html, /placeholder="Search clients"/)
  assert.match(html, /Show all 11/)
  const all = clientsPage(11, { showAll: true })
  assert.equal(count(all, /data-testid="client-circle"/g), 11)
  assert.doesNotMatch(all, /Show all 11/)
  const found = clientsPage(11, { query: 'client k' })
  assert.equal(count(found, /data-testid="client-circle"/g), 1)
  assert.match(found, /Client K/)
  const none = clientsPage(11, { query: 'zzz' })
  assert.match(none, /No client called “zzz”/)
})

test('no clients: the empty state, with a way to add the first', () => {
  const html = clientsPage(0)
  assert.match(html, /data-testid="empty"/)
  assert.match(html, /No clients yet\. Add one to start\./)
  assert.match(html, /aria-label="Add your first client"/)
  assert.doesNotMatch(html, /client-circle/)
})

test('Add client is a circle in the page and a form when open', () => {
  const closed = clientsPage(2)
  assert.match(closed, /aria-label="Add client"/)
  assert.doesNotMatch(closed, /data-testid="add-form"/)
  const open = clientsPage(2, { adding: true })
  assert.match(open, /data-testid="add-form"/)
  assert.match(open, /<label[^>]*for="lc-client-name"[^>]*>Client name<\/label>/)
  assert.match(open, /maxLength="60"|maxlength="60"/i)
  assert.doesNotMatch(open, /aria-label="Add client"/, 'the circle gives way to the form')
})

test('a client page puts six tools round it; Idea and Prod are Soon and disabled', () => {
  const a = client(0)
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 1, locked: false } }),
    item(a, 'ie.napkin.deck-maker', { title: 'Pitch', run: { state: 'working', label: 'Building' } }),
  ]
  const live = new Set(['brief', 'research', 'deck', 'ads'])
  const html = renderToStaticMarkup(createElement(ClientPage, {
    summary: summarise(a, items), items, live, onOpenTool: noop, onSoon: noop, onOpenItem: noop,
  }))
  for (const t of TOOLS) assert.match(html, new RegExp(`data-testid="tool-${t.id}"`))
  assert.match(html, /Brief Maker for Client A, 1 open, needs you \(1 of 6\)/)
  assert.match(html, /Research Tool for Client A, none open, start one \(2 of 6\)/)
  assert.match(html, /Idea for Client A, coming soon \(3 of 6\)/)
  assert.match(html, /Production Tool for Client A, coming soon \(5 of 6\)/)
  assert.equal(count(html, /aria-disabled="true"/g), 2)
  assert.match(html, /Spring brief/)
  assert.match(html, /Needs you/)
  assert.equal(count(html, /data-testid="work-item"/g), 2)
})

test('a client with no work says where to start', () => {
  const a = client(0)
  const html = renderToStaticMarkup(createElement(ClientPage, { summary: summarise(a, []), items: [], live: new Set(['brief']), onOpenTool: noop, onSoon: noop, onOpenItem: noop }))
  assert.match(html, /Nothing yet\. Pick a tool above to start the first piece of work for Client A\./)
})

test('the trail is circles you can go back through, and the last is where you are', () => {
  const html = renderToStaticMarkup(createElement(Trail, {
    route: { level: 'client', client: 'cli_00000001' }, agency: 'Studio A',
    client: { name: 'Client A', initials: 'CA', material: 'pearl' }, onGo: noop,
  }))
  assert.match(html, /aria-label="Where you are"/)
  assert.equal(count(html, /<button/g), 3, 'agency, clients, client')
  assert.equal(count(html, /aria-current="page"/g), 1)
  assert.match(html, /Studio A/)
  assert.match(html, /Clients/)
  // Every crumb has a name of its own, even where its label is hidden on a phone.
  for (const n of ['Studio A', 'Clients', 'Client A']) assert.match(html, new RegExp(`<button[^>]*aria-label="${n}"`))
  assert.match(html, /aria-current="page"[^>]*>.*?Client A/s)
  const landing = renderToStaticMarkup(createElement(Trail, { route: { level: 'agency' }, agency: 'Studio A', onGo: noop }))
  assert.equal(count(landing, /<li/g), 1)
})

test('a circle is drawn flat and says its ring', () => {
  for (const activity of ['idle', 'work', 'human', 'error'] as const) {
    const html = renderToStaticMarkup(createElement(Circle, { size: 89, material: 'stone', initials: 'CA', activity }))
    assert.match(html, new RegExp(`data-activity="${activity}"`))
    assert.match(html, /aria-hidden="true"/)
    assert.match(html, />CA</)
    assert.doesNotMatch(html, /<canvas/)
  }
  // an unknown material is still a circle
  assert.match(renderToStaticMarkup(createElement(Circle, { size: 40, material: 'unobtainium' })), /<svg/)
})

test('the six tools are one tab stop: the first has tabindex 0 and the rest -1, each with its number', () => {
  const a = client(0)
  const html = renderToStaticMarkup(createElement(ClientPage, {
    summary: summarise(a, []), items: [], live: new Set(['brief', 'research', 'deck', 'ads']), onOpenTool: noop, onSoon: noop, onOpenItem: noop,
  }))
  const tabs = [...html.matchAll(/data-testid="tool-(\w+)"/g)].map(m => m[1])
  assert.deepEqual(tabs, ['brief', 'research', 'idea', 'deck', 'prod', 'ads'], 'a fixed order round the circle')
  assert.equal(count(html, /tabindex="0"/gi) - count(html, /<h1[^>]*tabindex="0"/gi), 1)
  assert.equal(count(html, /<button[^>]*tabindex="-1"/g), 5)
  for (let i = 1; i <= 6; i++) assert.match(html, new RegExp(`aria-keyshortcuts="${i}"`))
  // The positions are fixed: a hexagon, the first at the top.
  assert.match(html, /data-testid="tool-brief"[^>]*--x:0\.000;--y:-1\.000/)
})

test('the tool page lists the client’s documents of that tool and offers a new one for them', () => {
  const a = client(0)
  const brief = toolById('brief')!
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 1, locked: false } }),
    item(a, BRIEF, { title: 'Autumn brief' }),
  ]
  const html = renderToStaticMarkup(createElement(ToolPage, { client: a, tool: brief, items, onNew: noop, onOpenItem: noop, onBack: noop }))
  assert.match(html, /data-testid="tool-page"[^>]*data-client="cli_00000001"[^>]*data-tool="brief"/)
  assert.match(html, /<h1[^>]*>Brief Maker<\/h1>/)
  assert.match(html, /Client: Client A/)
  assert.match(html, /2 briefs for Client A/)
  assert.match(html, /New brief for Client A/)
  assert.equal(count(html, /data-testid="work-item"/g), 2)
  assert.match(html, /Needs you/)
  assert.match(html, /Back to Client A/)
})

test('the tool page with nothing says so and still offers New', () => {
  const html = renderToStaticMarkup(createElement(ToolPage, { client: client(1), tool: toolById('research')!, items: [], onNew: noop, onOpenItem: noop, onBack: noop }))
  assert.match(html, /No research for Client B yet\./)
  assert.match(html, /New research for Client B/)
  assert.doesNotMatch(html, /data-testid="work-item"/)
})

test('the trail of a tool has four circles, each with a name; in a document none is "here"', () => {
  const route = { level: 'tool', client: 'cli_00000001', tool: 'deck' } as const
  const props = { route, agency: 'Studio A', client: { name: 'Client A', initials: 'CA', material: 'pearl' }, onGo: noop }
  const page = renderToStaticMarkup(createElement(Trail, props))
  assert.equal(count(page, /<button/g), 4, 'agency, clients, client, tool')
  for (const n of ['Studio A', 'Clients', 'Client A', 'Deck Maker']) assert.match(page, new RegExp(`<button[^>]*aria-label="${n}"`))
  assert.equal(count(page, /aria-current="page"/g), 1)
  const inDoc = renderToStaticMarkup(createElement(Trail, { ...props, inDocument: true }))
  assert.equal(count(inDoc, /aria-current/g), 0)
  assert.equal(count(inDoc, /<button/g), 4)
  assert.match(inDoc, /title="Back to the studio"/, 'the agency circle is the way home')
})

test('a trail whose client is not known yet still names every circle', () => {
  const html = renderToStaticMarkup(createElement(Trail, { route: { level: 'client', client: 'cli_00000009' }, agency: 'Studio A', onGo: noop }))
  assert.match(html, /<button[^>]*aria-label="Client"/)
})
