// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The keyboard on a client's tools and what the live region says
// (features/landing-circles.clan, phase 2).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { arrival, isTyping, wheelKey } from '../src/shell/landing/keys.ts'
import { routeOfDocument } from '../src/shell/landing/model.ts'

test('arrows go round the six tools and wrap; Home and End jump', () => {
  assert.deepEqual(wheelKey('ArrowRight', 0, 6), { kind: 'move', to: 1 })
  assert.deepEqual(wheelKey('ArrowDown', 4, 6), { kind: 'move', to: 5 })
  assert.deepEqual(wheelKey('ArrowRight', 5, 6), { kind: 'move', to: 0 })
  assert.deepEqual(wheelKey('ArrowLeft', 0, 6), { kind: 'move', to: 5 })
  assert.deepEqual(wheelKey('ArrowUp', 3, 6), { kind: 'move', to: 2 })
  assert.deepEqual(wheelKey('Home', 4, 6), { kind: 'move', to: 0 })
  assert.deepEqual(wheelKey('End', 1, 6), { kind: 'move', to: 5 })
})

test('1 to 6 pick a tool by its place; 0, 7 to 9 and letters are not ours', () => {
  for (let i = 1; i <= 6; i++) assert.deepEqual(wheelKey(String(i), 0, 6), { kind: 'pick', index: i - 1 })
  for (const k of ['0', '7', '8', '9', 'a', 'Tab', 'Escape', ' ', 'Enter', '10', '']) assert.equal(wheelKey(k, 0, 6), null, k)
  assert.equal(wheelKey('ArrowRight', 0, 0), null)
})

test('enter and space are left to the button; escape and numbers are not stolen from a field or a menu', () => {
  const el = (tagName: string, extra: object = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...extra }) as unknown as EventTarget
  assert.equal(isTyping(el('INPUT')), true)
  assert.equal(isTyping(el('TEXTAREA')), true)
  assert.equal(isTyping(el('SELECT')), true)
  assert.equal(isTyping(el('DIV', { isContentEditable: true })), true)
  assert.equal(isTyping(el('BUTTON', { closest: () => ({}) })), true, 'inside a menu or a dialog')
  assert.equal(isTyping(el('BUTTON')), false)
  assert.equal(isTyping(null), false)
})

test('the live region says where you are at each level, in words', () => {
  const names = { agency: 'Studio A', client: 'Client A', tool: 'Brief Maker', tools: 6, open: 2 }
  // #agency and #clients are the one desk now (gaps.md §11): arrows rove the circles, the numbers pick on the dial.
  assert.match(arrival({ level: 'agency' }, names), /^Studio A: your desk\. Arrow keys move between clients, Enter opens one's dial, 1 to 6 pick a tool on it, Escape closes it\./)
  assert.equal(arrival({ level: 'clients' }, names), arrival({ level: 'agency' }, names))
  assert.match(arrival({ level: 'client', client: 'cli_00000001' }, names), /Client A opened with 6 tools\. 1 to 6 open a tool, Escape goes back to the desk\./)
  assert.match(arrival({ level: 'tool', client: 'cli_00000001', tool: 'brief' }, names), /Brief Maker for Client A\. 2 open\./)
  assert.match(arrival({ level: 'tool', client: 'cli_00000001', tool: 'brief' }, { ...names, open: 0 }), /Nothing open yet\./)
})

test('a document sits at its client’s tool in the trail; a client without a known tool at its client; no client, nowhere', () => {
  const c = { id: 'cli_00000001', name: 'Client A' }
  assert.deepEqual(routeOfDocument({ client: c, app: { app_id: 'ie.napkin.brief-maker' } }), { level: 'tool', client: c.id, tool: 'brief' })
  assert.deepEqual(routeOfDocument({ client: c, app: { app_id: 'ie.napkin.deck-maker' } }), { level: 'tool', client: c.id, tool: 'deck' })
  assert.deepEqual(routeOfDocument({ client: c, app: { app_id: 'ie.example.unknown' } }), { level: 'client', client: c.id })
  assert.deepEqual(routeOfDocument({ client: c }), { level: 'client', client: c.id })
  assert.equal(routeOfDocument({ app: { app_id: 'ie.napkin.brief-maker' } }), null)
  assert.equal(routeOfDocument({ client: null }), null)
})
