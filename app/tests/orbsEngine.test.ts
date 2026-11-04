// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shared Orbs engine (app/src/orbs/engine.ts) run against a pretend browser
// and a pretend WebGL (tests/orbsFakes.ts): one context for every circle, the
// flat fallback in every failing case, reduced motion, idle frames, the pointer,
// and the ring's arc. No GPU and no browser needed.

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { arcLength, createOrbs, FIXED_ARC, HUMAN_ARC, MAX_LIVE, parseColour, type OrbHost, type OrbSpec, type Orbs } from '../src/orbs/engine.ts'
import { pseudoAgent } from '../src/orbs/agents.ts'
import { FakeCanvas, FakeEl, fakeGL, installBrowser, run, type Browser } from './orbsFakes.ts'

let b: Browser | null = null
let orbs: Orbs | null = null
afterEach(() => { orbs?.dispose(); orbs = null; b?.restore(); b = null })

const host = (left = 0, top = 0, size = 100) => {
  const wrap = new FakeEl().at(left, top, size)
  const canvas = new FakeCanvas(null)
  return { wrap, canvas, h: { wrap, canvas } as unknown as OrbHost }
}
const spec = (over: Partial<OrbSpec> = {}): OrbSpec => ({ agent: 'pearl', activity: 'idle', size: 100, slot: 's1', ...over })
const start = (o: Parameters<typeof installBrowser>[0] = {}) => {
  b = installBrowser(o)
  orbs = createOrbs()
  return { b, orbs }
}
const T0 = () => performance.now()
const num = (v: unknown) => v as number

test('the first circle starts one context and draws every circle into it', () => {
  const { b, orbs } = start()
  const a = host(0, 0, 100), c = host(120, 0, 89)
  assert.ok(orbs.attach(a.h, spec({ slot: 'a' })))
  assert.ok(orbs.attach(c.h, spec({ slot: 'c', size: 89, agent: 'stone', activity: 'work' })))
  assert.equal(b.canvasesMade, 1, 'one WebGL canvas for the page')
  assert.equal(b.root.attrs['data-orbs'], 'gl')
  assert.equal(b.gl!.compiled, 2, 'the shader is compiled once, vertex and fragment')
  run(orbs.step, T0(), 3)
  const s = orbs.stats()
  assert.equal(s.circles, 2)
  assert.ok(s.draws >= 2 && s.drawn === 2, 'both drawn in the frame')
  assert.equal(a.canvas.copies.length > 0 && c.canvas.copies.length > 0, true, 'each cell is copied to its own canvas')
  assert.equal(a.wrap.attrs['data-orb'], 'on', '3D shows once the canvas has a picture')
})

test('the circle is not 3D until its canvas has a picture (no blank flash)', () => {
  const { orbs } = start()
  const a = host()
  orbs.attach(a.h, spec())
  assert.equal(a.wrap.attrs['data-orb'], undefined)
  run(orbs.step, T0(), 1)
  assert.equal(a.wrap.attrs['data-orb'], 'on')
})

test('no WebGL: nothing is attached and the page says why', () => {
  const { b, orbs } = start({ gl: null })
  assert.equal(orbs.attach(host().h, spec()), null)
  assert.equal(orbs.ok(), false)
  assert.match(orbs.stats().reason, /no WebGL/)
  assert.equal(b.root.attrs['data-orbs'], 'flat')
  assert.equal(b.root.attrs['data-orbs-gl'], '0')
  assert.equal(b.frames.length, 0, 'no frame loop for a flat page')
})

test('a shader that will not compile leaves the circles flat', () => {
  const { orbs } = start({ gl: fakeGL({ failCompile: true }) })
  assert.equal(orbs.attach(host().h, spec()), null)
  assert.match(orbs.stats().reason, /shader failed/)
})

test('a browser that asks for less data never starts a context', () => {
  const { b, orbs } = start({ media: { '(prefers-reduced-data: reduce)': true } })
  assert.equal(orbs.attach(host().h, spec()), null)
  assert.match(orbs.stats().reason, /reduced data/)
  assert.equal(b.canvasesMade, 0)
})

test('a page with no browser features stays flat and does not throw', () => {
  b = installBrowser()
  delete (globalThis as Record<string, unknown>).requestAnimationFrame
  orbs = createOrbs()
  assert.equal(orbs.attach(host().h, spec()), null)
  assert.match(orbs.stats().reason, /no browser/)
})

test('an unknown material stays the flat neutral circle', () => {
  const { orbs } = start()
  assert.equal(orbs.attach(host().h, spec({ agent: 'plutonium' })), null)
  assert.equal(orbs.attach(host().h, spec({ agent: '__proto__' })), null)
  assert.equal(orbs.attach(host().h, spec({ activity: 'dancing' as never })), null)
  assert.equal(pseudoAgent('toString'), null)
  assert.ok(orbs.attach(host().h, spec({ slot: 'ok' })), 'a known one still works')
})

test('context lost puts the flat circle back; restored brings the 3D back', () => {
  const { b, orbs } = start()
  const a = host()
  orbs.attach(a.h, spec())
  run(orbs.step, T0(), 2)
  assert.equal(a.wrap.attrs['data-orb'], 'on')
  assert.equal(b.glCanvas.fire('webglcontextlost'), true, 'default prevented, so the browser may restore it')
  assert.equal(a.wrap.attrs['data-orb'], undefined, 'flat again')
  assert.equal(orbs.ok(), false)
  assert.match(orbs.stats().reason, /context lost/)
  const draws = orbs.stats().frames
  run(orbs.step, T0() + 5000, 3)
  assert.equal(orbs.stats().frames, draws, 'nothing is drawn while lost')
  b.glCanvas.fire('webglcontextrestored')
  assert.equal(orbs.ok(), true)
  run(orbs.step, T0() + 6000, 2)
  assert.equal(a.wrap.attrs['data-orb'], 'on')
  assert.equal(b.root.attrs['data-orbs'], 'gl')
})

test('Force flat: the flat circle shows, no frame is drawn, and 3D comes back when it is switched off', () => {
  const { orbs } = start()
  const a = host()
  orbs.attach(a.h, spec())
  run(orbs.step, T0(), 2)
  orbs.setFlat(true)
  assert.equal(a.wrap.attrs['data-orb'], undefined)
  assert.equal(orbs.ok(), false)
  assert.equal(orbs.hasGL(), true, 'WebGL itself is fine')
  const f = orbs.stats().frames
  run(orbs.step, T0() + 3000, 3)
  assert.equal(orbs.stats().frames, f)
  assert.equal(orbs.press(a.wrap as never, 10, 10), false, 'a press does nothing while flat')
  orbs.setFlat(false)
  run(orbs.step, T0() + 4000, 2)
  assert.equal(a.wrap.attrs['data-orb'], 'on')
})

test('a software renderer draws at one pixel per CSS pixel; a real one at the device ratio, to 2', () => {
  let r = start({ gl: fakeGL({ renderer: 'Google SwiftShader' }), dpr: 3 })
  r.orbs.attach(host().h, spec())
  run(r.orbs.step, T0(), 2)
  assert.equal(r.orbs.stats().soft, true)
  assert.equal(r.orbs.stats().dpr, 1)
  r.orbs.dispose(); r.b.restore()
  r = start({ gl: fakeGL({ renderer: 'ANGLE (Apple M2)' }), dpr: 3 })
  r.orbs.attach(host().h, spec())
  run(r.orbs.step, T0(), 2)
  assert.equal(r.orbs.stats().soft, false)
  assert.equal(r.orbs.stats().dpr, 2, 'capped at 2 however dense the screen')
})

test('a circle that is off-screen is not drawn; it draws again when it comes back', () => {
  const { b, orbs } = start()
  const a = host(), c = host(200, 0)
  orbs.attach(a.h, spec({ slot: 'a' })); orbs.attach(c.h, spec({ slot: 'c' }))
  run(orbs.step, T0(), 2)
  const seen = (el: unknown, on: boolean) => b.io[0].cb([{ target: el, isIntersecting: on }])
  assert.ok(b.io[0].observed.has(c.wrap), 'the engine watches the circle')
  seen(c.wrap, false)
  const before = c.canvas.copies.length, beforeA = a.canvas.copies.length
  run(orbs.step, T0() + 100, 5)
  assert.equal(c.canvas.copies.length, before, 'off-screen: no copy, no draw')
  assert.ok(a.canvas.copies.length > beforeA, 'the visible one carries on')
  seen(c.wrap, true)
  run(orbs.step, T0() + 200, 2)
  assert.ok(c.canvas.copies.length > before)
})

test('idle circles are redrawn about 15 times a second, busy ones every frame', () => {
  const { orbs } = start()
  const idle = host(), busy = host(200, 0)
  orbs.attach(idle.h, spec({ slot: 'i', activity: 'idle' })); orbs.attach(busy.h, spec({ slot: 'w', activity: 'work' }))
  const t = run(orbs.step, T0(), 200) // past the first moments where everything is awake
  const i0 = idle.canvas.copies.length, w0 = busy.canvas.copies.length
  run(orbs.step, t, 60) // one second at 60 fps
  const idleDraws = idle.canvas.copies.length - i0, busyDraws = busy.canvas.copies.length - w0
  assert.ok(busyDraws >= 58, `working draws every frame (${busyDraws})`)
  assert.ok(idleDraws >= 10 && idleDraws <= 20, `idle draws about 15 a second (${idleDraws})`)
})

test('reduced motion: a still picture, redrawn only when something changes', () => {
  const { b, orbs } = start({ media: { '(prefers-reduced-motion: reduce)': true } })
  const a = host()
  const h = orbs.attach(a.h, spec({ activity: 'work' }))!
  assert.equal(orbs.isReduced(), true)
  const t = run(orbs.step, T0(), 200)
  const n0 = a.canvas.copies.length
  run(orbs.step, t, 60)
  assert.equal(a.canvas.copies.length, n0, 'nothing moves, so nothing is drawn')
  assert.ok(orbs.stats().skipped > 0)
  // a keyboard press still ripples, softer, and then settles
  h.kick()
  run(orbs.step, t + 1000, 5)
  assert.ok(a.canvas.copies.length > n0, 'a press is answered')
  // the preference can change while the page is open
  b.setMedia('(prefers-reduced-motion: reduce)', false)
  assert.equal(orbs.isReduced(), false)
})

test('reduced motion freezes the turn, the wobble and the breath', () => {
  const { orbs } = start({ media: { '(prefers-reduced-motion: reduce)': true } })
  const a = host()
  orbs.attach(a.h, spec({ activity: 'work' }))
  run(orbs.step, T0(), 30)
  // uTime is the circle's own clock: it must not advance
  const gl = b!.gl!
  const t1 = num(gl.uniforms.uTime)
  run(orbs.step, T0() + 2000, 10)
  assert.equal(num(gl.uniforms.uTime), t1)
  assert.deepEqual(gl.uniforms.uWob, [0, 0, 0, 0])
})

test('the ring says what is happening: its length is the activity, never a made-up progress', () => {
  assert.equal(arcLength('idle', null), 1, 'idle: a whole thin ring')
  assert.equal(arcLength('error', null), 0.62)
  assert.equal(arcLength('human', null), HUMAN_ARC)
  assert.equal(arcLength('work', null), FIXED_ARC, 'working with no steps reported: the fixed arc')
  assert.equal(arcLength('think', [3, 4]), 0.75, 'one run that reports its steps: the share done')
  assert.equal(arcLength('read', [9, 4]), 1)
  assert.equal(arcLength('work', [0, 4]), 0.1, 'never shorter than a mark')
  assert.equal(arcLength('check', [1, 0]), FIXED_ARC)
})

test('the ring eases to its length and look, and the idle ring is thin and still', () => {
  const { orbs } = start()
  const a = host()
  const h = orbs.attach(a.h, spec({ activity: 'idle' }))!
  run(orbs.step, T0(), 10)
  const gl = b!.gl!
  assert.equal(num((gl.uniforms.uRG as number[])[0]), 1, 'a whole ring')
  assert.ok(num((gl.uniforms.uRS as number[])[2]) < 1.5, 'thin')
  h.update(spec({ activity: 'work' }))
  const t = run(orbs.step, T0() + 3000, 240)
  const len = (gl.uniforms.uRG as number[])[0]
  assert.ok(Math.abs(len - FIXED_ARC) < 0.01, `eased to the fixed arc (${len})`)
  assert.ok(num((gl.uniforms.uRS as number[])[2]) > 3, 'thick, like work')
  h.update(spec({ activity: 'error' }))
  run(orbs.step, t, 240)
  assert.equal((gl.uniforms.uRG as number[])[2] > 0.9, true, 'the broken-arc flag')
})

test('a client sphere is blank: no arcs, no emblem circles, matte material per client', () => {
  const stone = pseudoAgent('stone')!, graphite = pseudoAgent('graphite')!
  assert.equal(stone.na, 0); assert.equal(stone.nc, 0)
  assert.ok(stone.arcF.every(v => v === 0) && stone.cirF.every(v => v === 0))
  assert.notDeepEqual(Array.from(stone.base), Array.from(graphite.base))
  assert.equal(pseudoAgent('stone'), stone, 'built once')
  const { orbs } = start()
  orbs.attach(host().h, spec({ agent: 'graphite' }))
  run(orbs.step, T0(), 2)
  const gl = b!.gl!
  assert.deepEqual((gl.uniforms.uArc1 as number[]).filter(v => v !== 0), [], 'no arc geometry sent')
  assert.deepEqual(gl.uniforms.uMatA, Array.from(graphite.mat).map(v => Math.fround(v)))
  assert.equal(num((gl.uniforms.uPingOn)), 0)
})

test('the ring state is kept by slot: a re-render, a new size or a new page does not reset it', () => {
  const { orbs } = start()
  const a = host(0, 0, 144)
  const h1 = orbs.attach(a.h, spec({ slot: 'client:1', size: 144, activity: 'work' }))!
  run(orbs.step, T0(), 120)
  const ang = num((b!.gl!.uniforms.uRG as number[])[1])
  h1.detach()
  assert.equal(orbs.stats().circles, 0)
  assert.equal(orbs.stats().slots, 1, 'the place is remembered after the circle leaves')
  const c = host(0, 0, 89)
  orbs.attach(c.h, spec({ slot: 'client:1', size: 89, activity: 'work' }))
  assert.equal(orbs.stats().slots, 1, 'the same place, another size: one state')
  run(orbs.step, T0() + 100, 1)
  const ang2 = num((b!.gl!.uniforms.uRG as number[])[1])
  assert.ok(Math.abs(ang2 - ang) < 0.5, 'the turn carried on from where it was')
})

test('two live circles never share a slot', () => {
  const { orbs } = start()
  const a = host(), c = host(200, 0)
  orbs.attach(a.h, spec({ slot: 'same' })); orbs.attach(c.h, spec({ slot: 'same' }))
  assert.equal(orbs.stats().circles, 2)
  run(orbs.step, T0(), 2)
  assert.ok(a.canvas.copies.length > 0 && c.canvas.copies.length > 0)
})

test('a hard cap: circles past it stay flat', () => {
  const { orbs } = start()
  let flat = 0
  for (let i = 0; i < MAX_LIVE + 5; i++) if (!orbs.attach(host(i * 10, 0, 64).h, spec({ slot: `n${i}`, size: 64 }))) flat++
  assert.equal(flat, 5)
  assert.equal(orbs.stats().circles, MAX_LIVE)
  run(orbs.step, T0(), 2)
  assert.equal(orbs.stats().drawn, MAX_LIVE)
})

test('many circles share one atlas and are drawn in batches that fit', () => {
  const { orbs } = start()
  for (let i = 0; i < 30; i++) orbs.attach(host(i * 10, 0, 144).h, spec({ slot: `n${i}`, size: 144 }))
  run(orbs.step, T0(), 2)
  const gl = b!.gl!
  assert.equal(b!.canvasesMade, 1, 'still one context')
  assert.ok(orbs.stats().draws === 30 && gl.draws.length >= 30)
  for (const d of gl.draws) assert.ok(d.viewport[0] + d.viewport[2] <= 2048 && d.viewport[1] + d.viewport[3] <= 1024 + 1, 'every cell inside the atlas')
})

test('the circle leans toward the pointer anywhere in the window, with no click and no distance limit', () => {
  const { b, orbs } = start()
  const a = host(500, 400, 144)
  orbs.attach(a.h, spec({ size: 144, activity: 'work' }))
  const t = run(orbs.step, T0(), 30)
  const rest = orbs.tilt(a.wrap as never)!
  assert.ok(Math.abs(rest.ox) < 0.01 && Math.abs(rest.oy) < 0.01)
  for (const [x, y] of [[0, 0], [2000, 400], [572, 3000], [572, 472]]) {
    b.fire('pointermove', { clientX: x, clientY: y, pointerType: 'mouse' })
    run(orbs.step, t + x + y, 40)
    const tl = orbs.tilt(a.wrap as never)!
    const dx = x - 572, dy = y - 472
    if (dx || dy) {
      assert.ok(Math.hypot(tl.ox, tl.oy) > 0.5, `leans for a pointer at ${x},${y}`)
      assert.ok(tl.ox * dx + tl.oy * dy > 0, 'toward it')
    }
  }
})

test('a press ripples and squishes; the pointer is then followed until released anywhere', () => {
  const { b, orbs } = start()
  const a = host(0, 0, 144)
  const h = orbs.attach(a.h, spec({ size: 144 }))!
  const t = run(orbs.step, T0(), 10)
  assert.equal(h.press(72, 72), true)
  const gl = b.gl!
  run(orbs.step, t, 20)
  const tl = orbs.tilt(a.wrap as never)!
  assert.equal(tl.drag, true)
  assert.ok(tl.press > 0.1, 'squished')
  assert.equal(num(gl.uniforms.uRipOn), 1, 'the ripple is on')
  assert.ok((gl.uniforms.uRip as number[])[3] > 0.5, 'at full strength')
  b.fire('pointermove', { clientX: 900, clientY: 700, pointerType: 'mouse' })
  run(orbs.step, t + 400, 20)
  assert.equal(orbs.tilt(a.wrap as never)!.drag, true, 'still held after the pointer left the circle')
  b.fire('pointerup', { pointerType: 'mouse', pointerId: 1 })
  assert.equal(orbs.tilt(a.wrap as never)!.drag, false, 'released anywhere')
})

test('a keyboard press is the same ripple, softer under reduced motion', () => {
  const { b, orbs } = start()
  const a = host()
  orbs.attach(a.h, spec())
  run(orbs.step, T0(), 5)
  orbs.kick(a.wrap as never)
  run(orbs.step, T0() + 100, 2)
  assert.equal(num(b.gl!.uniforms.uRipOn), 1)
  assert.ok((b.gl!.uniforms.uRip as number[])[3] >= 0.99)
  b.setMedia('(prefers-reduced-motion: reduce)', true)
  orbs.kick(a.wrap as never)
  run(orbs.step, T0() + 300, 2)
  const amps = (b.gl!.uniforms.uRip as number[]).filter((_, i) => i % 4 === 3)
  assert.ok(amps.some(v => Math.abs(v - 0.4) < 0.01), 'a reduced-motion ripple is 40%')
})

test('light and dark are read from the circle\'s own tokens, and again when the theme changes', () => {
  const { b, orbs } = start()
  const a = host()
  orbs.attach(a.h, spec({ activity: 'think' }))
  run(orbs.step, T0(), 120)
  const light = (b.gl!.uniforms.uRingCol as number[]).slice()
  assert.ok(Math.abs(light[0] - 0x7a / 255) < 0.02, 'the think colour of light')
  assert.ok(Math.abs((b.gl!.uniforms.uBg as number[])[0] - 1) < 0.01, 'the card is white')
  assert.ok(Math.abs((b.gl!.uniforms.uTrack as number[])[0] - 214 / 255) < 0.02, 'a colour-mix token is asked of the browser')
  b.tokens['--lc-ring-think'] = '#9F86FA'; b.tokens['--card'] = '#15171C'
  b.setMedia('(prefers-color-scheme: dark)', true)
  run(orbs.step, T0() + 3000, 120)
  const dark = b.gl!.uniforms.uRingCol as number[]
  assert.ok(Math.abs(dark[0] - 0x9f / 255) < 0.02, 'the think colour of dark')
  assert.ok((b.gl!.uniforms.uBg as number[])[0] < 0.2, 'the card is dark')
})

test('scan finds the circles under a root by their data attributes', () => {
  const { orbs } = start()
  const mk = (slot: string, activity: string) => {
    const el = new FakeEl(); el.attrs = { 'data-orb-agent': 'ceramic', 'data-orb-activity': activity, 'data-orb-size': '89', 'data-orb-slot': slot }
    ;(el as unknown as { querySelector: () => unknown }).querySelector = () => new FakeCanvas(null)
    return el
  }
  const els = [mk('x', 'work'), mk('y', 'idle')]
  const root = { querySelectorAll: (_q: string) => ({ forEach: (f: (e: unknown) => void) => els.forEach(f) }) }
  const hs = orbs.scan(root as never, el => (el === els[0] ? { steps: [1, 4] } : null))
  assert.equal(hs.length, 2)
  assert.deepEqual(orbs.scan(null), [])
})

test('a detached circle is dropped from the frame and nothing leaks', () => {
  const { b, orbs } = start()
  const a = host()
  orbs.attach(a.h, spec())
  run(orbs.step, T0(), 2)
  a.wrap.isConnected = false
  run(orbs.step, T0() + 100, 2)
  assert.equal(orbs.stats().circles, 0)
  assert.equal(b.io[0].observed.has(a.wrap), false)
  const n = a.canvas.copies.length
  run(orbs.step, T0() + 200, 5)
  assert.equal(a.canvas.copies.length, n)
})

test('colours parse the forms a browser gives', () => {
  assert.deepEqual(parseColour('#FF0000'), [1, 0, 0])
  assert.deepEqual(parseColour('#0f0'), [0, 1, 0])
  assert.deepEqual(parseColour('rgb(0, 0, 255)'), [0, 0, 1])
  assert.deepEqual(parseColour('rgba(255, 255, 255, 0.5)'), [1, 1, 1])
  assert.deepEqual(parseColour('color(srgb 0.5 0.25 1)'), [0.5, 0.25, 1])
  assert.equal(parseColour('color-mix(in oklab, red, blue)'), null)
  assert.equal(parseColour(''), null)
})
