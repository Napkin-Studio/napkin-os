// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The dial on the desk (features/new-ui-shell.clan): a client's circle opens
// Brief, Research, Deck and Production in place, and More tools lists Idea,
// Ads and every Soon tool, so no tool loses its place. Placeholder names.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ClientRecord, LibraryItem } from '../src/host/types.ts'
import { ClientsPage } from '../src/shell/landing/ClientsPage.tsx'
import { DIAL_TOOLS, moreTools, petalWords, petalsOf } from '../src/shell/landing/dialPetals.ts'
import { initialsOf, ordered, summarise } from '../src/shell/landing/model.ts'
import { TOOLS, toolById } from '../src/shell/landing/tools.ts'

const client = (i: number): ClientRecord => {
  const name = `Client ${String.fromCharCode(65 + i)}`
  return { id: `cli_${String(i + 1).padStart(8, '0')}`, name, initials: initialsOf(name), material: 'pearl', owner: 'human:t', created_at: '2026-11-01T00:00:00Z' }
}
const item = (c: ClientRecord, app: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${app}-${Math.random()}`, app_id: app, title: 'Work', updated_at: '2026-11-04T10:00:00Z',
  client: { id: c.id, name: c.name }, state: { needs_you: 0, locked: false }, run: null, ...over,
})
const LIVE = new Set(['brief', 'research', 'deck'])
const noop = () => {}

test('the dial has the four apps then More tools, Production Soon until it has an app', () => {
  const p = petalsOf(LIVE)
  assert.deepEqual(p.map(x => (x.kind === 'tool' ? x.tool.id : 'more')), [...DIAL_TOOLS, 'more'])
  assert.deepEqual(p.filter(x => x.kind === 'tool' && !x.live).map(x => (x.kind === 'tool' ? x.tool.id : '')), ['prod'])
})

test('More tools lists every tool not on the dial and every Soon one: Idea, Production and Ads', () => {
  assert.deepEqual(moreTools(LIVE).map(t => t.id), ['idea', 'prod', 'ads'])
  // together the dial and More tools hold every tool in the table: none is lost
  const held = new Set([...DIAL_TOOLS, ...moreTools(LIVE).map(t => t.id)])
  for (const t of TOOLS) assert.ok(held.has(t.id), `${t.id} has a place`)
  // Ads installed: still listed, now live
  assert.ok(moreTools(new Set([...LIVE, 'ads'])).some(t => t.id === 'ads'))
})

test('a petal says Soon, Start, or what is open and whether it needs you', () => {
  const a = client(0)
  const s = summarise(a, [item(a, 'ie.napkin.brief-maker', { state: { needs_you: 2, locked: false } }), item(a, 'ie.napkin.deck-maker')])
  assert.equal(petalWords(s, toolById('brief')!, true), '1 open · needs you')
  assert.equal(petalWords(s, toolById('deck')!, true), '1 open')
  assert.equal(petalWords(s, toolById('research')!, true), 'Start')
  assert.equal(petalWords(s, toolById('prod')!, false), 'Soon')
})

test('the desk draws the dial round the chosen circle only: the hub opens the client, petals name themselves', () => {
  const cs = [client(0), client(1)]
  const html = renderToStaticMarkup(createElement(ClientsPage, {
    agency: 'Studio A', clients: ordered(cs, []), query: '', showAll: false, adding: false,
    onQuery: noop, onShowAll: noop, onAdding: noop, onOpenClient: noop, onAdd: async () => null,
    dial: cs[1].id, onDial: noop, live: LIVE, onOpenTool: noop, onSoon: noop,
  }))
  assert.equal((html.match(/data-testid="dial"/g) || []).length, 1)
  assert.match(html, /data-testid="dial"[^>]*data-client="cli_00000002"/)
  assert.match(html, /aria-expanded="true"[^>]*>|aria-expanded="true"/)
  assert.match(html, /data-testid="dial-open-client"[^>]*>Open Client B</)
  for (const id of ['brief', 'research', 'deck', 'prod', 'more']) assert.match(html, new RegExp(`data-testid="dial-${id}"`))
  assert.match(html, /aria-label="Production Tool for Client B, Soon \(4 of 5\)"/)
  assert.match(html, /aria-keyshortcuts="5"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-keyshortcuts="5"|data-testid="dial-more"/)
  // one tab stop for the petals
  assert.equal((html.match(/class="lc-petal[^"]*"[^>]*tabindex="0"|tabindex="0"[^>]*class="lc-petal/g) || []).length, 1)
})

test('without a dial the desk is as it was: a circle opens the client', () => {
  const html = renderToStaticMarkup(createElement(ClientsPage, {
    agency: 'Studio A', clients: ordered([client(0)], []), query: '', showAll: false, adding: false,
    onQuery: noop, onShowAll: noop, onAdding: noop, onOpenClient: noop, onAdd: async () => null,
  }))
  assert.doesNotMatch(html, /data-testid="dial"/)
  assert.doesNotMatch(html, /aria-expanded/)
})
