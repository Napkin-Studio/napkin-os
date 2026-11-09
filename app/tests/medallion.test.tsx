// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion is the approved mock's satin H1 mark (design/new-ui/
// napkin-app-v1.html mountH1Mark), in the agency's colours, and it changes
// only when the app the person is in needs them (features/new-ui-shell.clan).

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DeepOMark } from '../src/brand/DeepOMark.tsx'
import { medallionLook, mix, wavePath } from '../src/components/medallionLook.ts'
import { AGENCY_COLOURS, markOf } from '../src/shell/agency/palette.ts'

test('mix is the mock\'s DeepO.mix: a toward b by t', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000')
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff')
  assert.equal(mix('#1E22AA', '#FFFFFF', 0.34), '#6b6dc7')
})

test('the satin sphere and the window: the mock\'s shell and wall colours from the agency base', () => {
  const L = medallionLook('#1E22AA', '#FFB800', 'awake')
  assert.equal(L.shellHi, mix('#1E22AA', '#FFFFFF', 0.34))
  assert.equal(L.shellLo, mix('#1E22AA', '#050609', 0.52))
  assert.equal(L.line, '#ffb800', 'awake: the horizon is the agency accent')
  assert.deepEqual(L.win, { x: 10.5, y: -8.5 }, 'at rest the window faces up and right')
  assert.equal(L.arc, false)
})

test('needs you: the horizon warms and rises, the window turns to face you, the ring closes', () => {
  const awake = medallionLook('#1E22AA', '#FFB800', 'awake')
  const needs = medallionLook('#1E22AA', '#FFB800', 'needs')
  assert.equal(needs.line, mix('#FFB800', '#EBCB9E', 1))
  assert.ok(needs.yBase < awake.yBase, 'the horizon rises')
  assert.deepEqual(needs.win, { x: 0, y: 0 })
  assert.equal(needs.arc, true)
})

test('the wave path: 19 points, closed to the sea when filled', () => {
  const open = wavePath(0, 3.95, -1.8, false)
  assert.equal(open.split(/[ML]/).filter(Boolean).length, 19)
  assert.match(wavePath(0, 3.95, -1.8, true), /Z$/)
})

test('the mark renders as the mock\'s H1: the arc is always drawn, lit only in a state that rings', async () => {
  const { resetMark } = await import('../src/components/markStore.ts')
  resetMark()
  const awake = renderToStaticMarkup(createElement(DeepOMark, { size: 54, palette: { base: '#1E22AA', accent: '#FFB800' }, shared: true, state: 'awake', progress: 0, testId: 'medallion-mark' }))
  assert.match(awake, /viewBox="-50 -50 100 100"/)
  assert.match(awake, /data-testid="medallion-arc"[^>]*/)
  assert.match(awake, /data-k="arc"[^>]*opacity="0\.000"/, 'awake: the ring is not lit')
  resetMark()
  const needs = renderToStaticMarkup(createElement(DeepOMark, { size: 54, palette: { base: '#1E22AA', accent: '#FFB800' }, shared: true, state: 'needs', progress: 0.85, testId: 'medallion-mark' }))
  assert.match(needs, /data-k="arc"[^>]*opacity="1\.000"/, 'needs: the ring closes round the sphere')
  assert.match(needs, /data-state="needs"/)
})

test('the medallion takes the signed-in agency\'s kit, else Napkin\'s', () => {
  assert.deepEqual(markOf('sam@wk'), { base: AGENCY_COLOURS.wk.base, accent: AGENCY_COLOURS.wk.accent })
  assert.deepEqual(markOf(null), { base: AGENCY_COLOURS.napkin.base, accent: AGENCY_COLOURS.napkin.accent })
  assert.deepEqual(markOf('sam@unknown'), markOf(null))
})
