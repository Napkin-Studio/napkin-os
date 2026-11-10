// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A client's dial on the desk, as the mock draws it (gaps.md D12, D13): four
// quadrants (Brief, Research, Deck, Production) with what is in each, a hub in
// the client's colour that opens the client, number keys 1 to 4.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { LibraryItem } from '../src/host/types.ts'
import { Dial } from '../src/shell/nui/Dial.tsx'

const c = { id: 'cli_00000001', name: 'Client Alpha', sector: null, look: { cl: '#DA291C', ink: '#FFC72C' } }
const item = (app: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${Math.random()}`, app_id: app, title: 'Work', updated_at: '2026-11-04T10:00:00Z',
  client: { id: c.id, name: c.name }, state: { needs_you: 0, locked: false }, run: null, ...over,
})
const noop = () => {}
const dial = (items: LibraryItem[], live = new Set(['brief', 'research', 'deck'])) => renderToStaticMarkup(createElement(Dial, {
  client: c, items, live, place: { left: -8, top: -12, origin: '74px 70px' }, onOpenTool: noop, onSoon: noop, onOpenClient: noop, onClose: noop,
}))

test('four quadrants in the mock order, each with its number key and what is in it', () => {
  const html = dial([
    item('ie.napkin.brief-maker', { state: { needs_you: 2, locked: false } }),
    item('ie.napkin.campaign-research', { run: { state: 'working', label: 'x' } }),
  ])
  const ids = [...html.matchAll(/data-testid="quadrant-(\w+)"/g)].map(m => m[1])
  assert.deepEqual(ids, ['brief', 'research', 'deck', 'prod'])
  for (let i = 1; i <= 4; i++) assert.match(html, new RegExp(`aria-keyshortcuts="${i}"`))
  assert.match(html, /class="dz-tag">YOUR CALL</)
  assert.match(html, /aria-label="Brief Maker for Client Alpha, needs your call \(1 of 4\)"/)
  assert.match(html, /data-testid="quadrant-research" data-activity="work"/, 'the quadrant says its ring\'s verb')
  assert.match(html, /data-testid="quadrant-brief"[^>]*tabindex|tabindex="0"[^>]*data-testid="quadrant-brief"/)
  assert.match(html, /class="dz-sub">Agents working</)
  assert.match(html, /class="dz-sub">Nothing yet</)
  assert.match(html, /aria-label="Production Tool for Client Alpha, coming soon \(4 of 4\)"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Production Tool for Client Alpha, coming soon/)
  assert.match(html, /class="dz-rim needs"/)
})

test('the hub is the client in its own colour and opens it; with no sector the name\'s last word goes under', () => {
  const html = dial([])
  assert.match(html, /data-testid="dial-hub"[^>]*style="--cl:#DA291C;--cl-ink:#FFC72C"[^>]*title="Open Client Alpha"/)
  assert.match(html, /<b>Client<\/b><small>Alpha<\/small>/)
  assert.match(html, /left:-8px;top:-12px;transform-origin:74px 70px/)
  assert.ok(html.indexOf('data-testid="dial-hub"') < html.indexOf('data-testid="quadrant-brief"'), 'the hub first: Shift+Tab from the first quadrant reaches it')
})

test('a quadrant counts its work in its own noun', () => {
  const html = dial([item('ie.napkin.deck-maker'), item('ie.napkin.deck-maker'), item('ie.napkin.brief-maker')])
  assert.match(html, /class="dz-sub">2 decks</)
  assert.match(html, /class="dz-sub">1 brief</)
})

