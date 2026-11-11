// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The pieces the desk keeps from the landing (gaps.md §11): the trail, the
// drawn circle, the tool page, and the registry's adopt panel and archived
// list. The desk and the client page themselves are in desk.test.tsx.
// Client names are placeholders (features/landing-circles.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ClientRecord, LibraryItem } from '../src/host/types.ts'
import { Circle } from '../src/shell/landing/Circle.tsx'
import { ToolPage } from '../src/shell/landing/ToolPage.tsx'
import { Trail } from '../src/shell/landing/Trail.tsx'
import { initialsOf } from '../src/shell/landing/model.ts'
import { toolById } from '../src/shell/landing/tools.ts'

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

test('the tool page lists the client’s documents of that tool and offers a new one for them', () => {
  const a = client(0)
  const brief = toolById('brief')!
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 1, locked: false } }),
    item(a, BRIEF, { title: 'Autumn brief' }),
  ]
  const html = renderToStaticMarkup(createElement(ToolPage, { client: a, tool: brief, items, onNew: noop, onOpenItem: noop, onBack: noop }))
  assert.match(html, /data-testid="tool-page"[^>]*data-client="cli_00000001"[^>]*data-tool="brief"/)
  assert.match(html, /<h1[^>]*>Brief Maker<span class="period-dot"/)
  // Brief Maker's identity: dog-eared sheets with a manila tab, in the brief's home
  assert.match(html, /class="home-grid bm-homes"/)
  assert.equal(count(html, /class="home-card bm-card"/g), 2)
  assert.match(html, /class="bm-tab"/)
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

// ── Phase 3 ────────────────────────────────────────────────────────────────

test('every verb has its own ring, drawn flat and from the ring tokens', () => {
  const seen = new Set<string>()
  for (const activity of ['work', 'think', 'read', 'check', 'human', 'error', 'idle'] as const) {
    const html = renderToStaticMarkup(createElement(Circle, { size: 89, material: 'stone', initials: 'CA', activity }))
    assert.match(html, new RegExp(`data-activity="${activity}"`))
    assert.doesNotMatch(html, /<canvas/)
    if (activity !== 'idle') assert.match(html, new RegExp(`var\\(--lc-ring-${activity}\\)`))
    seen.add(html.replace(/data-activity="\w+"/, ''))
  }
  assert.equal(seen.size, 7, 'no two verbs draw the same ring')
})

// ── Phase 5: adopt, rename, archive, restore, and 20 and 100 clients ─────────

import { adoptLabel } from '../src/shell/landing/model.ts'
import { AdoptPanel, ArchivedList } from '../src/shell/landing/Registry.tsx'

test('the desk\'s ⋯ menu names how many clients there are to adopt', () => {
  assert.equal(adoptLabel(5), 'Adopt clients (5)')
})

test('the adopt panel lists every name ticked with its document count, in words', () => {
  const html = renderToStaticMarkup(createElement(AdoptPanel, {
    offer: [{ name: 'Client A', documents: 2 }, { name: 'Client B', documents: 1 }],
    onAdopt: async () => ({ words: 'x' }), onClose: noop,
  }))
  assert.match(html, /aria-label="Adopt clients"/)
  assert.equal(count(html, /type="checkbox"/g), 2)
  assert.equal(count(html, /checked=""/g), 2)
  assert.match(html, /2 documents/)
  assert.match(html, /1 document</)
  assert.match(html, /Adopt 2 names/)
})

test('the archived list says what archiving kept, and names each Restore', () => {
  assert.equal(renderToStaticMarkup(createElement(ArchivedList, { archived: [], onRestore: async () => null })), '')
  const html = renderToStaticMarkup(createElement(ArchivedList, { archived: [client(0), client(1)], onRestore: async () => null }))
  assert.match(html, /Archived clients \(2\)/)
  assert.match(html, /aria-label="Restore Client A"/)
  assert.match(html, /Their work is kept/)
})
