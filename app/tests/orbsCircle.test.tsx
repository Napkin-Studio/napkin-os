// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the landing's circle hands the 3D engine, seen in static markup (effects do
// not run here): the flat svg stays as the fallback and the accessible mark, a canvas
// sits beside it only for a circle that asked for 3D and is big enough to be a
// sphere, and the initials stay as text over the blank sphere.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Circle, MIN_3D } from '../src/shell/landing/Circle.tsx'

const html = (p: Parameters<typeof Circle>[0]) => renderToStaticMarkup(createElement(Circle, p))
const count = (s: string, re: RegExp) => (s.match(re) || []).length

test('a circle that asks for 3D carries the flat svg and what the engine reads; its canvas comes only when WebGL is up', () => {
  const s = html({ size: 144, material: 'stone', initials: 'CA', activity: 'work', orb: true })
  assert.match(s, /^<span class="lc-c3" data-orb-host="" data-orb-agent="stone" data-orb-activity="work" data-orb-size="144">/)
  assert.equal(count(s, /<svg /g), 1, 'the flat circle is still there: the fallback')
  assert.equal(count(s, /<canvas/g), 0, 'on the server, and in a browser with no WebGL, there is no canvas in the page')
  assert.match(s, /<text class="lc-ini"[^>]*>CA<\/text>/, 'the initials are text, over the sphere')
  assert.ok(!/<svg[^>]*role=/.test(s) && /<svg[^>]*aria-hidden/.test(s), 'the button around it names it; the circle is decoration')
})

test('without the ask, or too small to be a sphere, a circle is the plain flat svg with no canvas', () => {
  assert.ok(!/<canvas|data-orb/.test(html({ size: 144, material: 'stone', initials: 'CA' })))
  assert.ok(!/<canvas|data-orb/.test(html({ size: MIN_3D - 1, material: 'stone', initials: 'CA', orb: true })))
  assert.match(html({ size: MIN_3D, material: 'stone', orb: true }), /data-orb-host/)
})

test('a dim (coming soon) circle stays dim in both forms', () => {
  assert.match(html({ size: 89, material: 'pearl', dim: true }), /style="opacity:0.55"/)
  assert.match(html({ size: 89, material: 'pearl', dim: true, orb: true }), /class="lc-c3 lc-dim"/)
})

test('the engine is told the material, never an agent of the clan', () => {
  for (const m of ['pearl', 'ceramic', 'stone', 'graphite', 'onyx', 'paper']) {
    assert.match(html({ size: 100, material: m, orb: true }), new RegExp(`data-orb-agent="${m}"`))
  }
})
