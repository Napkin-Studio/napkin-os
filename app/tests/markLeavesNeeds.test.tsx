// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Back from a document that needs you, the bar's medallion rests: only a product's
// document (Brief, Research, Deck, Production) ever tells the mark "needs", and the
// desk, a client page or a tool page show it asleep or awake (owner, 10 Nov 2026).
//
// The bug this guards: React 19 wrote the mark's first paint (innerHTML) again on
// every render, so the draw loop painted detached nodes and the mark on screen froze
// in the state it mounted in. Opening a research document with open calls and going
// back to the client page left the medallion warm and ringed ("needs").

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { h1Attrs, nodePainter, paintH1, type PaintNode } from '../src/brand/deepOSvg.ts'
import { isProductApp, markTarget } from '../src/components/medallionMotion.ts'
import { modelOf, resetMark } from '../src/components/markStore.ts'

const PAL = { base: '#1E22AA', accent: '#FFB800' }

/** A stand-in for the medallion's <svg>: its `data-k` nodes, which a re-render can replace. */
function fakeSvg() {
  type Node = PaintNode & { k: string; attrs: Record<string, string>; live: boolean; getAttribute(n: string): string | null }
  let nodes: Node[] = []
  const mount = () => {
    for (const n of nodes) n.live = false
    nodes = ['arc', 'arc-halo', 'wave', 'lip'].map(k => {
      const n: Node = { k, attrs: {}, live: true, get isConnected() { return n.live },
        setAttribute(x, v) { n.attrs[x] = v }, getAttribute(x) { return x === 'data-k' ? k : null } }
      return n
    })
  }
  mount()
  return { el: { querySelectorAll: () => nodes }, remount: mount, node: (k: string) => nodes.find(n => n.k === k)! }
}

/** Run the shared model for `secs`, painting each frame as the bar's draw loop does. */
function run(secs: number, set: ReturnType<typeof nodePainter>) {
  const m = modelOf({ state: 'sleep', progress: 0 })
  for (let t = 0; t < secs; t += 1 / 30) {
    const c = m.step(1 / 30, false)
    paintH1(set, h1Attrs(PAL, c, m.S.arcTail))
  }
  return m
}

test('only product documents move the mark: Brief, Research, Deck, Production', () => {
  for (const id of ['ie.napkin.brief-maker', 'ie.napkin.campaign-research', 'ie.napkin.deck-maker', 'ie.napkin.production-tool', 'production'])
    assert.ok(isProductApp(id), id)
  for (const id of [null, undefined, '', 'ie.napkin.home', 'ie.napkin.brand', 'ie.napkin.film', 'ie.napkin.brief'])
    assert.ok(!isProductApp(id), String(id))
})

test('a research document with open calls → the client page: the mark leaves needs, on the nodes that show', () => {
  resetMark()
  const svg = fakeSvg()
  const set = nodePainter(svg.el)

  // In McSlurry's research document, 28 calls open: the document's own needs.
  const inDoc = markTarget({ inDoc: isProductApp('ie.napkin.campaign-research'), needs: 28, engaged: true })
  assert.equal(inDoc.state, 'needs')
  modelOf(inDoc).set(inDoc)
  let m = run(4, set)
  assert.equal(m.S.state, 'needs')
  assert.ok(m.c.warm > 0.9, 'the document needs you: the mark warms')
  assert.equal(svg.node('arc').attrs.opacity, '1.000', 'and the ring closes')

  // Back to the client page (Back, the client chip or the medallion): no document, so no needs.
  const landing = markTarget({ inDoc: false, needs: 28, engaged: true })
  assert.deepEqual(landing, { state: 'awake', progress: 0 })
  // The landing's bar mounts its own <svg>, and React may write the first paint again:
  // the old nodes leave the page and the painter must find the new ones.
  svg.remount()
  modelOf(landing).set(landing)
  m = run(4, set)
  assert.equal(m.S.state, 'awake')
  assert.ok(m.c.warm < 0.05, `the mark cools (warm ${m.c.warm.toFixed(3)})`)
  assert.equal(svg.node('arc').attrs.opacity, '0.000', 'the ring the page shows is out')

  // Not engaged yet: asleep, never needs.
  assert.equal(markTarget({ inDoc: false, needs: 28, engaged: false }).state, 'sleep')
})

test('a document of an app that is not a product never warms the mark', () => {
  const t = markTarget({ inDoc: isProductApp('ie.napkin.home'), needs: 5, run: { state: 'waiting' }, engaged: true })
  assert.deepEqual(t, { state: 'awake', progress: 0 })
})

test('a page that says its agents are working moves the mark to working, with its step', async () => {
  const { markTarget, pageRunOf } = await import('../src/components/medallionMotion')
  const run = pageRunOf({ mode: 'working', label: 'Working · step 1/4' })
  assert.deepEqual(run, { state: 'working', progress: [0, 4] })
  assert.equal(markTarget({ inDoc: true, needs: 0, run, engaged: false }).state, 'working')
  assert.equal(pageRunOf({ mode: 'ask', label: 'New brief' }), null)
  assert.equal(pageRunOf(null), null)
})
