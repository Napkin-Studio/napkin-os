// The one agent scene (templates/shared/agent-sphere/scene.js) draws every sphere on one fixed canvas, each in
// its element's box. Owner, 2026-11-09: stray spheres floated in the brief's side panel, over "Logos" and the
// hint text; an agent shows in one place only. These tests run scene.js in a pretend browser and hold:
//  - a view whose element is hidden (display:none, visibility:hidden, a closed <details>), zero-size or not on
//    the page is not drawn; one whose element left the page is dropped from the scene and its pixels cleared;
//  - rects are read again after a scroll anywhere (captured, so a side panel's own scroll counts), and each
//    view is clipped to its scroll container, so a sphere never draws outside the box it lives in.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const src = readFileSync(new URL('templates/shared/agent-sphere/scene.js', root), 'utf8')

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })

interface FakeEl {
  isConnected: boolean
  parentElement: FakeEl | null
  r: Rect
  shown: boolean
  cs: { overflowX: string; overflowY: string; position: string }
  style: Record<string, string>
  getBoundingClientRect(): Rect
  checkVisibility(): boolean
  offsetParent: unknown
  setAttribute(): void
  [k: string]: unknown
}
function el(r: Rect, parent: FakeEl | null = null, o: Partial<FakeEl> = {}): FakeEl {
  const e: FakeEl = {
    isConnected: true, parentElement: parent, r, shown: true, cs: { overflowX: 'visible', overflowY: 'visible', position: 'static' }, style: {},
    getBoundingClientRect() { return e.r }, checkVisibility() { return e.shown && e.isConnected }, offsetParent: {}, setAttribute() {}, ...o,
  }
  return e
}

type Draw = { id: string; rect: Rect; box: number[] }
function world() {
  const listeners: Record<string, Array<{ fn: () => void; capture: boolean }>> = {}
  const winListeners: Record<string, Array<() => void>> = {}
  const scissors: number[][] = []
  const clears: number[][] = []
  let cur = [0, 0, 0, 0]
  const gl = {
    ARRAY_BUFFER: 1, STATIC_DRAW: 2, FLOAT: 3, DEPTH_TEST: 4, BLEND: 5, ONE: 6, ONE_MINUS_SRC_ALPHA: 7, SCISSOR_TEST: 8, COLOR_BUFFER_BIT: 9,
    bindBuffer() {}, createBuffer() { return {} }, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, clearColor() {},
    disable() {}, enable() {}, blendFunc() {}, finish() {},
    scissor(...a: number[]) { cur = a; scissors.push(a) }, clear() { clears.push(cur) },
  }
  const canvas = el(rect(0, 0, 1000, 800), null, { getContext: () => gl, width: 0, height: 0 })
  const body = el(rect(0, 0, 1000, 800))
  const html = el(rect(0, 0, 1000, 800))
  body.parentElement = html
  let mo: (() => void) | null = null
  let rafs: Array<(t: number) => void> = []
  const document = {
    body: Object.assign(body, { appendChild() {} }), documentElement: html, hidden: false,
    createElement: () => canvas,
    addEventListener(t: string, fn: () => void, o?: { capture?: boolean } | boolean) { (listeners[t] ||= []).push({ fn, capture: typeof o === 'object' ? !!o.capture : !!o }) },
  }
  const ctx: Record<string, unknown> = {
    document, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1, location: { search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: (e: FakeEl) => e.cs,
    requestAnimationFrame: (f: (t: number) => void) => { rafs.push(f); return rafs.length },
    cancelAnimationFrame: () => {}, setTimeout: () => 1, clearTimeout: () => {},
    performance: { now: () => 1000 },
    addEventListener: (t: string, fn: () => void) => { (winListeners[t] ||= []).push(fn) },
    MutationObserver: class { constructor(f: () => void) { mo = f } observe() {} },
  }
  ctx.window = ctx
  vm.runInNewContext(src, ctx)
  const S = ctx.NapkinScene as {
    add(v: unknown): unknown; remove(v: unknown): void; drawNow(): void; views: unknown[]; ENG: { ox: number; oy: number }
  }
  const draws: Draw[] = []
  function view(id: string, e: FakeEl) {
    return {
      id, el: e, kind: 'agent', fps: () => 30, visible: () => true,
      draw(_gl: unknown, r: Rect, _d: number, _w: number, _h: number, b: number[]) { draws.push({ id, rect: { ...r }, box: [...b] }) },
    }
  }
  return {
    S, draws, scissors, clears, canvas, body, listeners, winListeners, view,
    frame() { draws.length = 0; S.drawNow(); return draws.map(d => d.id) },
    mutate() { mo?.() },
    rafsPending: () => rafs.length, clearRafs() { rafs = [] },
  }
}

test('a hidden, zero-size or never-attached view is not drawn; a shown one is', () => {
  const w = world()
  const ok = el(rect(10, 10, 30, 30), w.body)
  const closedDetails = el(rect(10, 400, 23, 23), w.body)
  closedDetails.shown = false               // inside a closed <details>: offsetParent set, rect real, not visible
  closedDetails.offsetParent = {}
  const none = el(rect(0, 0, 0, 0), w.body)  // display:none or empty
  const notYet = el(rect(10, 500, 30, 30), w.body, { isConnected: false })
  for (const [id, e] of [['ok', ok], ['details', closedDetails], ['none', none], ['notYet', notYet]] as const) w.S.add(w.view(id, e))
  assert.deepEqual(w.frame(), ['ok'])
  assert.equal(w.S.views.length, 4, 'a view not yet on the page is kept for when it lands')
})

test('a view that was drawn and then hidden is cleared and not drawn again', () => {
  const w = world()
  const e = el(rect(100, 100, 20, 20), w.body)
  w.S.add(w.view('a', e))
  assert.deepEqual(w.frame(), ['a'])
  e.shown = false                            // its <details> closed, its panel hidden
  w.clears.length = 0
  assert.deepEqual(w.frame(), [])
  assert.ok(w.clears.some(b => b[0] <= 100 && b[0] + b[2] >= 120 && b[2] > 0), 'its last box is cleared')
})

test('a view whose element left the page is dropped from the scene, and destroying it after is harmless', () => {
  const w = world()
  const a = el(rect(10, 10, 20, 20), w.body), b = el(rect(60, 10, 20, 20), w.body)
  const va = w.view('a', a) as { detached?: boolean }, vb = w.view('b', b)
  w.S.add(va); w.S.add(vb)
  assert.deepEqual(w.frame(), ['a', 'b'])
  a.isConnected = false                      // its placeholder was replaced by innerHTML
  w.clears.length = 0
  assert.deepEqual(w.frame(), ['b'])
  assert.equal(w.S.views.length, 1)
  assert.equal(va.detached, true)
  assert.ok(w.clears.some(c => c[2] === 1000 && c[3] === 800), 'the whole canvas is cleared, so its pixels go')
  w.S.remove(va)                             // its owner destroys it later: the other view stays
  assert.deepEqual(w.frame(), ['b'])
})

test('a scroll inside a panel wakes the scene, and the sphere is drawn at its new place', () => {
  const w = world()
  const scroller = el(rect(700, 0, 300, 800), w.body)
  scroller.cs = { overflowX: 'hidden', overflowY: 'auto', position: 'sticky' }
  const e = el(rect(720, 300, 30, 30), scroller)
  w.S.add(w.view('a', e))
  assert.deepEqual(w.frame(), ['a'])
  const cap = (w.listeners.scroll || []).filter(l => l.capture)
  assert.equal(cap.length, 1, 'scroll is heard in the capture phase (it does not bubble from a panel)')
  w.clearRafs()
  e.r = rect(720, 180, 30, 30)              // the panel scrolled 120px
  cap[0].fn()
  assert.ok(w.rafsPending() > 0, 'a frame is asked for')
  w.frame()
  assert.equal(w.draws[0].rect.top, 180)
})

test('a sphere is clipped to its scroll container and not drawn once scrolled out of it', () => {
  const w = world()
  const scroller = el(rect(700, 100, 300, 400), w.body)
  scroller.cs = { overflowX: 'hidden', overflowY: 'auto', position: 'static' }
  const e = el(rect(720, 480, 40, 40), scroller)   // half below the panel's bottom (500)
  w.S.add(w.view('a', e))
  w.frame()
  const [x, y, bw, bh] = w.draws[0].box
  assert.deepEqual([x, bw], [720, 40])
  assert.equal(bh, 20, 'only the part inside the panel')
  assert.equal(800 - y - bh, 480, 'GL origin bottom left: top of the box is the sphere top')
  e.r = rect(720, 520, 40, 40)              // wholly below the panel
  assert.deepEqual(w.frame(), [])
})

test('a container that starts clipping later is found (the clip ancestor is not cached for good)', () => {
  const w = world()
  const panel = el(rect(700, 100, 300, 200), w.body)
  const e = el(rect(720, 280, 40, 40), panel)
  w.S.add(w.view('a', e))
  w.frame()
  assert.equal(w.draws[0].box[3], 40)
  panel.cs = { overflowX: 'hidden', overflowY: 'auto', position: 'static' }   // a class made it scroll
  w.mutate()
  w.frame()
  assert.equal(w.draws[0].box[3], 20)
})

test('the canvas offset is subtracted, so a sphere stays on its element', () => {
  const w = world()
  w.canvas.r = rect(0, 40, 1000, 800)       // a transformed ancestor moved the fixed canvas down 40px
  const e = el(rect(100, 100, 20, 20), w.body)
  w.S.add(w.view('a', e))
  w.frame()
  const [, y, , h] = w.draws[0].box
  assert.equal(800 - y - h, 60)
})

test('the brief and the research draw no sphere on the open sheet or in its side tab but the job line', () => {
  const brief = readFileSync(new URL('templates/brief-maker/index.html', root), 'utf8')
  assert.match(brief, /#structured \.nk-ag\{display:none!important\}/)
  assert.match(brief, /#structured \.side-agent \.nk-ag\{display:inline-block!important\}/)
  const research = readFileSync(new URL('templates/campaign-research/index.html', root), 'utf8')
  assert.match(research, /\.insp \.nk-ag,#report \.nk-ag\{display:none!important\}/)
  assert.match(research, /\.insp \.side-agent \.nk-ag\{display:inline-block!important\}/)
  assert.doesNotMatch(research, /class="jb-in">'\+sphereTag/, 'no "needs you" sphere beside the checks')
})
