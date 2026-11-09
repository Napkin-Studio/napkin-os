// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion's states and motion, as the approved mock's headerMark and
// tickH1Mark (design/new-ui/napkin-app-v1.html) and Deep O's grammar
// (design/new-ui/identity-v4/mark/deep-o-grammar.js).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createModel } from '../src/brand/deepO.ts'
import { kindOfStage, markTarget, pointerTarget, stepLook } from '../src/components/medallionMotion.ts'

const rest = { inDoc: false, needs: 0, engaged: false }

test('which state the mark is told: sleep until engaged, working with real progress, needs only in the app you are in, done, error', () => {
  assert.deepEqual(markTarget(rest), { state: 'sleep', progress: 0 })
  assert.deepEqual(markTarget({ ...rest, engaged: true }), { state: 'awake', progress: 0 })
  // The desk's counts never change the logo: needs counts only inside a document.
  assert.equal(markTarget({ ...rest, needs: 4, engaged: true }).state, 'awake')
  const doc = { inDoc: true, needs: 0, engaged: true }
  assert.equal(markTarget(doc).state, 'awake', 'in a document with nothing going on: awake')
  assert.equal(markTarget({ ...doc, engaged: false }).state, 'sleep')
  assert.deepEqual(markTarget({ ...doc, needs: 2 }), { state: 'needs', progress: 0.85 })
  assert.equal(markTarget({ ...doc, run: { state: 'waiting' } }).state, 'needs', 'a run waiting on the person needs them')
  assert.deepEqual(markTarget({ ...doc, run: { state: 'working', stage: 'research', progress: [3, 6] } }),
    { state: 'working', progress: 0.5, kind: 'read', stage: 'research' })
  assert.equal(markTarget({ ...doc, run: { state: 'working' } }).progress, 0, 'no steps known: no fake progress')
  assert.equal(markTarget({ ...doc, needs: 1, run: { state: 'working' } }).state, 'needs', 'needs wins over working')
  assert.deepEqual(markTarget({ ...doc, finished: true }), { state: 'done', progress: 1 })
  assert.equal(markTarget({ ...doc, finished: true, needs: 1 }).state, 'needs', 'done only with nothing open')
  assert.equal(markTarget({ ...doc, run: { state: 'failed' } }).state, 'error')
  assert.equal(kindOfStage('judge'), 'check')
  assert.equal(kindOfStage('draft'), 'write')
})

test('following the pointer: off while asleep, toward the pointer only when it is over the mark and the mark is awake', () => {
  const rect = { left: 0, top: 0, width: 54, height: 54 }
  const over = { x: 27 + 20, y: 27 - 10 }
  // Asleep (night 1): the window does not follow, wherever the pointer is.
  assert.deepEqual(pointerTarget(1, 0, rect, over), { tx: 0, ty: 0 })
  // Nearly asleep (night past 0.3 + 0.7 * 0.99): still nothing.
  assert.deepEqual(pointerTarget(0.995, 0, rect, over), { tx: 0, ty: 0 })
  // Awake (night 0): the mock's centre pull and 11.5 travel, over a 0.56-size radius.
  const r = 54 * 0.56
  const a = pointerTarget(0, 0, rect, over)
  assert.ok(Math.abs(a.tx - (-10.5 * 0.65 + (20 / r) * 11.5)) < 1e-9)
  assert.ok(Math.abs(a.ty - (8.5 * 0.65 + (-10 / r) * 11.5)) < 1e-9)
  // Half awake (night 0.65): half of it.
  const h = pointerTarget(0.65, 0, rect, over)
  assert.ok(Math.abs(h.tx - a.tx * 0.5) < 1e-9)
  // Off the mark, or no pointer: it rests.
  assert.deepEqual(pointerTarget(0, 0, rect, { x: 200, y: 200 }), { tx: 0, ty: 0 })
  assert.deepEqual(pointerTarget(0, 0, rect, null), { tx: 0, ty: 0 })
  // The look springs toward the target and settles on it.
  let l = { lx: 0, ly: 0, vx: 0, vy: 0 }
  for (let i = 0; i < 120; i++) l = stepLook(l, 5, -3, 1 / 60)
  assert.ok(Math.abs(l.lx - 5) < 0.01 && Math.abs(l.ly + 3) < 0.01)
})

test('the grammar: the host owns the state; the model eases and never moves on by itself', () => {
  const m = createModel({ state: 'sleep' })
  m.snap(false)
  assert.equal(m.c.night, 1)
  m.set({ state: 'awake', progress: 0 })
  for (let i = 0; i < 300; i++) m.step(1 / 30, false)
  assert.ok(m.c.night < 0.01, 'awake: the night lifts')
  m.set({ state: 'done', progress: 1 })
  for (let i = 0; i < 600; i++) m.step(1 / 30, false)
  assert.equal(m.S.state, 'done', 'done holds until the host moves it')
  m.set({ state: 'working', progress: 0.25 })
  for (let i = 0; i < 300; i++) m.step(1 / 30, false)
  assert.ok(Math.abs(m.c.len - 0.25) < 0.01, 'the arc is the real progress')
  // Reduced motion: no breath, so a settled awake mark asks for no frames.
  const r = createModel({ state: 'awake' })
  r.snap(true)
  for (let i = 0; i < 10; i++) r.step(1 / 15, true)
  assert.equal(r.fpsCap(true), 0)
  assert.equal(createModel({ state: 'awake' }).fpsCap(false) > 0, true)
})
