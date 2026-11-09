// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The press gate (app/src/orbs/gate.ts): a press is seen before the page moves
// on, and it is never in the way of a keyboard, a flat circle or reduced motion.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GATE_MIN_AFTER_RELEASE_MS, GATE_MS, PressGate, type GateClock, type GateTarget } from '../src/orbs/gate.ts'

function clock() {
  let t = 1000
  const q: Array<{ at: number; fn: () => void; id: number; live: boolean }> = []
  let n = 0
  const c: GateClock & { advance(ms: number): void; pending(): number } = {
    now: () => t,
    later: (fn, ms) => { const e = { at: t + ms, fn, id: ++n, live: true }; q.push(e); return e.id },
    cancel: id => { for (const e of q) if (e.id === id) e.live = false },
    advance(ms) {
      const to = t + ms
      for (;;) {
        const next = q.filter(e => e.live && e.at <= to).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        t = next.at; next.live = false; next.fn()
      }
      t = to
    },
    pending: () => q.filter(e => e.live).length,
  }
  return c
}

function target(over: Partial<GateTarget> = {}) {
  const log: string[] = []
  const t: GateTarget & { log: string[] } = {
    log, ok: () => true, press: (x, y) => { log.push(`press ${x},${y}`) }, click: () => { log.push('click') }, kick: () => { log.push('kick') }, ...over,
  }
  return t
}
const ev = (over: Partial<{ button: number; isPrimary: boolean; pointerId: number; clientX: number; clientY: number }> = {}) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: 5, clientY: 6, ...over })

test('a tap: the ripple starts at once and the click follows about 250 ms after the press', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target()
  assert.equal(g.down(t, ev()), true)
  assert.deepEqual(t.log, ['press 5,6'])
  c.advance(30)
  g.up({ pointerId: 1 })
  assert.equal(g.waiting, true)
  assert.equal(g.click(1, t), 'own', 'the browser\'s own click is swallowed')
  c.advance(GATE_MS - 30 - 1)
  assert.deepEqual(t.log, ['press 5,6'], 'not yet')
  c.advance(2)
  assert.deepEqual(t.log, ['press 5,6', 'click'])
  assert.equal(g.click(1, t), 'pass', 'the one we send is let through')
  assert.equal(g.waiting, false)
})

test('press, drag to play, release late: it goes on at least 100 ms after the release', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target()
  g.down(t, ev())
  c.advance(2000)
  g.up({ pointerId: 1 })
  c.advance(GATE_MIN_AFTER_RELEASE_MS - 1)
  assert.deepEqual(t.log, ['press 5,6'])
  c.advance(2)
  assert.deepEqual(t.log, ['press 5,6', 'click'])
})

test('the keyboard is never held up: Enter and Space click at once, with the ripple', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target()
  assert.equal(g.click(0, t), 'kick')
  assert.deepEqual(t.log, ['kick'])
  assert.equal(c.pending(), 0)
})

test('flat circles, no WebGL and reduced motion get the plain click, no delay and no swallowing', () => {
  const c = clock()
  const g = new PressGate(c, () => false, () => 'a')
  const t = target()
  assert.equal(g.down(t, ev()), false)
  assert.equal(g.click(1, t), 'pass')
  assert.equal(g.click(0, t), 'pass')
  assert.deepEqual(t.log, [])
  assert.equal(c.pending(), 0)
})

test('only the primary button of the primary pointer, and a click it did not take goes through', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target()
  assert.equal(g.down(t, ev({ button: 2 })), false)
  assert.equal(g.down(t, ev({ isPrimary: false })), false)
  assert.equal(g.down(null, ev()), false)
  assert.equal(g.click(1, t), 'pass')
})

test('a touch that became a scroll is not a tap', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target()
  g.down(t, ev())
  g.cancel()
  g.up({ pointerId: 1 })
  c.advance(1000)
  assert.deepEqual(t.log, ['press 5,6'])
})

test('another pointer\'s release does not release this press', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target()
  g.down(t, ev({ pointerId: 7 }))
  g.up({ pointerId: 8 })
  c.advance(1000)
  assert.deepEqual(t.log, ['press 5,6'])
  g.up({ pointerId: 7 })
  c.advance(1000)
  assert.deepEqual(t.log, ['press 5,6', 'click'])
})

test('the click is dropped if the page changed, the button went, or 3D went away while it waited', () => {
  for (const what of ['view', 'gone', 'flat'] as const) {
    const c = clock(); let view = 'a', on = true, here = true
    const g = new PressGate(c, () => on, () => view)
    const t = target({ ok: () => here })
    g.down(t, ev()); g.up({ pointerId: 1 })
    if (what === 'view') view = 'b'
    if (what === 'gone') here = false
    if (what === 'flat') on = false
    c.advance(1000)
    assert.deepEqual(t.log, ['press 5,6'], what)
  }
})

test('a second press while one waits is not taken, and a route change drops the wait', () => {
  const c = clock()
  const g = new PressGate(c, () => true, () => 'a')
  const t = target(), u = target()
  g.down(t, ev()); g.up({ pointerId: 1 })
  assert.equal(g.down(u, ev({ pointerId: 2 })), false)
  g.reset()
  assert.equal(g.waiting, false)
  c.advance(1000)
  assert.deepEqual(t.log, ['press 5,6'])
  assert.deepEqual(u.log, [])
})
