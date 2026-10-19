// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The home's coming-soon cards: shown until their app is installed, and never
// a button (features/launcher-coming-soon.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TEASERS, upcoming } from '../src/shell/comingSoon.ts'
import { SoonCard } from '../src/shell/SoonCard.tsx'

test('both tools are on their way while neither is installed', () => {
  const ids = upcoming([{ app_id: 'ie.napkin.brief-maker' }]).map(t => t.app_id)
  assert.deepEqual(ids, ['ie.napkin.production-tool', 'ie.napkin.deck-maker'])
})

test('an installed app replaces its teaser', () => {
  const ids = upcoming([{ app_id: 'ie.napkin.deck-maker' }]).map(t => t.app_id)
  assert.deepEqual(ids, ['ie.napkin.production-tool'])
})

test('the Production Tool keeps its blue and Deck Maker is purple', () => {
  const colour = Object.fromEntries(TEASERS.map(t => [t.app_id, t.colour]))
  assert.equal(colour['ie.napkin.production-tool'], '#2F64F5')
  assert.equal(colour['ie.napkin.deck-maker'], '#7C4DFF')
})

test('a coming-soon card says so and opens nothing', () => {
  for (const teaser of TEASERS) {
    const html = renderToStaticMarkup(createElement(SoonCard, { teaser }))
    assert.match(html, new RegExp(teaser.name))
    assert.match(html, /Coming soon/)
    assert.match(html, /aria-disabled="true"/)
    assert.match(html, new RegExp(`--tc:${teaser.colour}`))
    assert.doesNotMatch(html, /<button|<a /)
  }
})
