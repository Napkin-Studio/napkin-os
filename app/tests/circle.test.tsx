// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing's circle is always the flat disc (owner, 2026-11-11: "We only
// need flat circles"): one svg, no canvas, no 3D hooks, the initials as text,
// decorative (the button around it names it), and a coming tool stays dim.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Circle } from '../src/shell/landing/Circle.tsx'

const html = (p: Parameters<typeof Circle>[0]) => renderToStaticMarkup(createElement(Circle, p))
const count = (s: string, re: RegExp) => (s.match(re) || []).length

test('a circle is the flat svg alone: no canvas, nothing for a 3D engine', () => {
  const s = html({ size: 144, material: 'stone', initials: 'CA', activity: 'work' })
  assert.match(s, /^<svg class="lc-cir"/)
  assert.equal(count(s, /<svg /g), 1)
  assert.doesNotMatch(s, /<canvas|data-orb/)
  assert.match(s, /<text class="lc-ini"[^>]*>CA<\/text>/, 'the initials are text')
  assert.ok(!/<svg[^>]*role=/.test(s) && /<svg[^>]*aria-hidden/.test(s), 'the button around it names it; the circle is decoration')
})

test('a dim (coming soon) circle stays dim', () => {
  assert.match(html({ size: 89, material: 'pearl', dim: true }), /style="opacity:0.55"/)
  assert.doesNotMatch(html({ size: 89, material: 'pearl' }), /opacity/)
})

test('its ring says what is happening, in shape as well as colour', () => {
  assert.match(html({ size: 100, material: 'pearl', activity: 'work' }), /class="lc-act"/)
  assert.match(html({ size: 100, material: 'pearl', activity: 'error' }), /var\(--lc-ring-error\)/)
  assert.doesNotMatch(html({ size: 100, material: 'pearl' }), /lc-act/)
})
