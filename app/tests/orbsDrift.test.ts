// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// There used to be two copies of the sphere + ring code: an `Orbs` block inside
// the Deck Maker template and app/src/orbs, and this test held them together.
// Since the one agent engine (app/templates/shared/agent-sphere, owner
// 2026-11-09: "make an engine that can put the right agent anywhere"), Deck Maker
// draws its agents from that engine and keeps no copy of its own. This test holds
// that: no private sphere copy may come back into the template, so nothing can
// drift. app/src/orbs stays the desk's client circles (clients, not agents).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const html = readFileSync(new URL('templates/deck-maker/index.html', root), 'utf8')

test('Deck Maker keeps no private copy of the sphere code', () => {
  assert.equal(html.indexOf('var Orbs = (function () {'), -1, 'no Orbs block in the template')
  assert.doesNotMatch(html, /gl_FragColor|precision mediump float/, 'no shader of its own')
})

test('Deck Maker draws its agents from the one agent engine', () => {
  assert.match(html, /agent-sphere|NapkinAgents/, 'the shared engine is what draws the agents')
})
