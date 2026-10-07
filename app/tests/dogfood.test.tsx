// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The dogfood build's shell side (features/dogfood-telemetry.clan): nothing
// is taken or shown unless the server records and the person has agreed;
// events go in batches; the notice names the contact. Click names stay the
// same from day to day, and a thumb counts the moment it is chosen
// (features/dogfood-log-quality.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DogfoodBadge, DogfoodNotice, ResultThumbs } from '../src/dogfood/Dogfood.tsx'
import {
  CONTACT, FRAME_CAPTURE, Recorder, __test, acknowledge, feedback, feedbackNote, frameCapture, nameOf, record, recording, setScreen,
  type ShellEvent,
} from '../src/dogfood/recorder.ts'

test('a recorder sends in batches, at its size or when flushed', () => {
  const sent: ShellEvent[][] = []
  const r = new Recorder(batch => { sent.push(batch) }, 3, 60_000)
  r.push({ kind: 'click', name: 'a' })
  r.push({ kind: 'click', name: 'b' })
  assert.equal(sent.length, 0)
  r.push({ kind: 'click', name: 'c' })
  assert.deepEqual(sent.map(b => b.length), [3])
  r.push({ kind: 'nav', name: 'home' })
  r.flush(true)
  assert.deepEqual(sent.map(b => b.length), [3, 1])
  r.flush(false)
  assert.equal(sent.length, 2, 'an empty flush sends nothing')
})

test('nothing is taken until the build records and the person agrees', () => {
  const sent: ShellEvent[][] = []
  __test({ on: false, consented: false }, b => { sent.push(b) })
  record('click', 'x'); feedback('screen', 'up')
  __test({ on: true, consented: false })
  record('click', 'x'); feedback('screen', 'up')
  assert.equal(recording(), false)
  assert.equal(sent.length, 0)

  __test({ on: true, consented: true })
  setScreen({ screen: 'app', doc: 'brief.clan', app: 'brief-maker' })
  feedback('screen', 'down', { screen: 'app' })
  feedbackNote('screen', 'down', '   ')
  feedbackNote('screen', 'down', ' too slow ', { screen: 'app' })
  const events = sent.flat()
  assert.deepEqual(events.map(e => e.kind), ['nav', 'feedback', 'feedback-note'], 'an empty note is not sent')
  const [, fb, note] = events
  assert.equal(fb.doc, 'brief.clan')
  assert.equal(fb.app, 'brief-maker')
  assert.equal(fb.data?.thumb, 'down')
  assert.equal(fb.data?.note, undefined, 'the thumb stands alone')
  assert.equal(note.name, 'screen')
  assert.equal(note.data?.thumb, 'down')
  assert.equal(note.data?.note, 'too slow')
  __test({ on: false, consented: false })
})

// ── naming what was clicked ─────────────────────────────────────────────────

/** Just enough of the DOM for nameOf: elements with attributes, text, closest(). */
type Fake = { nodeType: number; textContent?: string; tagName?: string; parentNode?: Fake | null; childNodes: Fake[]; attrs?: Record<string, string>; getAttribute?: (k: string) => string | null; closest?: (sel: string) => Fake | null }
function matches(n: Fake, sel: string): boolean {
  return sel.split(',').some(one => {
    const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(one.trim())
    if (m) return m[2] === undefined ? m[1] in (n.attrs ?? {}) : n.attrs?.[m[1]] === m[2]
    return n.tagName?.toLowerCase() === one.trim()
  })
}
function h(tag: string, attrs: Record<string, string>, ...kids: (Fake | string)[]): Fake {
  const n: Fake = { nodeType: 1, tagName: tag.toUpperCase(), attrs, childNodes: [], parentNode: null }
  n.childNodes = kids.map(k => typeof k === 'string' ? { nodeType: 3, textContent: k, childNodes: [] } : k)
  n.childNodes.forEach(k => { k.parentNode = n })
  n.getAttribute = k => attrs[k] ?? null
  n.closest = sel => { for (let c: Fake | null | undefined = n; c; c = c.parentNode) if (c.nodeType === 1 && matches(c, sel)) return c; return null }
  return n
}
const asEl = (f: Fake) => f as unknown as Element
/** Send what the recorder holds (feedback() flushes; a plain record waits for its timer). */
const flushNow = () => feedback('flush', 'up')

/** The function the frame script defines, taken back out of FRAME_CAPTURE. */
const frameNameOf = (() => {
  const src = /var nameOf=([\s\S]*?);\nfunction tell/.exec(FRAME_CAPTURE)?.[1]
  assert.ok(src, 'FRAME_CAPTURE defines nameOf')
  return new Function(`return (${src})`)() as typeof nameOf
})()

test('a click is named the same way every day, in the shell and in app frames', () => {
  const card = h('button', { class: 'ln-item' },
    h('span', {}, h('b', {}, 'Bulmers · Ireland'), h('small', {}, h('span', {}, 'Research, '), 'Yesterday, 00:54')),
    h('span', {}, '1 thing to check'), h('span', {}, '→'))
  const cardToday = h('button', { class: 'ln-item' },
    h('span', {}, h('b', {}, 'Bulmers · Ireland'), h('small', {}, h('span', {}, 'Research, '), 'Today, 15:22')),
    h('span', {}, '1 thing to check'), h('span', {}, '→'))
  const named = h('button', { 'data-dogfood': 'open document' }, h('b', {}, 'Frozen Drop'), 'Yesterday, 10:02')
  const menu = h('button', { role: 'menuitem' }, 'Export', h('small', {}, 'Make a PDF of it'))
  const icon = h('button', { 'aria-label': 'Close' }, h('svg', {}))
  const titled = h('button', { title: 'Back to the studio' }, h('svg', {}))
  const bare = h('a', { href: 'blob:x' })
  const inner = h('span', {}, 'Export')
  h('button', {}, inner)
  const page = h('p', {}, 'Paste the client’s words, or drop in their notes')
  h('body', {}, h('div', {}, page))

  for (const name of [nameOf, frameNameOf]) {
    assert.equal(name(asEl(card)), 'button: Bulmers · Ireland · Research · 1 thing to check')
    assert.equal(name(asEl(cardToday)), name(asEl(card)), 'the day does not change the name')
    assert.equal(name(asEl(named)), 'button: open document')
    assert.equal(name(asEl(menu)), 'button: Export · Make a PDF of it')
    assert.equal(name(asEl(icon)), 'button: Close')
    assert.equal(name(asEl(titled)), 'button: Back to the studio')
    assert.equal(name(asEl(bare)), 'a: (no label)')
    assert.equal(name(asEl(inner)), 'button: Export', 'named by the control it is in')
    assert.equal(name(asEl(page)), 'background', 'no control: never the page’s text')
    assert.equal(name(null), 'page')
    assert.ok(name(asEl(h('button', {}, 'x'.repeat(200)))).length <= 'button: '.length + 80)
  }
})

test('clicks the page makes itself are not recorded, in the shell or in frames', async () => {
  assert.match(FRAME_CAPTURE, /if\(!e\.isTrusted\)return/)
  // the shell's listener, against a stand-in document
  const handlers: Record<string, (e: unknown) => void> = {}
  const g = globalThis as Record<string, unknown>
  const saved = { document: g.document, window: g.window, fetch: g.fetch, Element: g.Element }
  g.Element = class {}
  g.document = { addEventListener: (t: string, f: (e: unknown) => void) => { handlers[t] = f }, visibilityState: 'visible' }
  g.window = { addEventListener: () => {} }
  g.fetch = async () => ({ ok: true })
  try {
    const sent: ShellEvent[][] = []
    __test({ on: true, consented: false }, b => { sent.push(b) })
    assert.equal(await acknowledge(), true)
    handlers.click({ isTrusted: false, target: null })
    handlers.click({ isTrusted: true, target: null })
    flushNow()
    const clicks = sent.flat().filter(e => e.kind === 'click')
    assert.equal(clicks.length, 1, 'only the person’s own click')
  } finally {
    Object.assign(g, saved)
    __test({ on: false, consented: false })
  }
})

test('the frame listener is added only when recording, and only posts', () => {
  assert.equal(frameCapture(false), '')
  assert.equal(frameCapture(true), FRAME_CAPTURE)
  assert.match(FRAME_CAPTURE, /clan:interaction/)
  assert.match(FRAME_CAPTURE, /passive:true/)
  assert.doesNotMatch(FRAME_CAPTURE, /preventDefault|stopPropagation|fetch\(/)
})

test('the notice says what is recorded and who to write to', () => {
  const agree = renderToStaticMarkup(createElement(DogfoodNotice, { onAgree: () => {} }))
  assert.match(agree, /records everything you do/)
  assert.ok(agree.includes(CONTACT) && CONTACT === 'hello@napkin.ie')
  assert.match(agree, /I understand/)
  const again = renderToStaticMarkup(createElement(DogfoodNotice, { onClose: () => {} }))
  assert.match(again, /Close/)
  assert.doesNotMatch(again, /I understand/)
})

test('the Beta badge and thumbs show only in a recording build', () => {
  __test({ on: false, consented: false })
  assert.equal(renderToStaticMarkup(createElement(DogfoodBadge)), '')
  assert.equal(renderToStaticMarkup(createElement(ResultThumbs, { extra: {} })), '')

  __test({ on: true, consented: false })
  const before = renderToStaticMarkup(createElement(DogfoodBadge))
  assert.match(before, />Beta</)
  assert.doesNotMatch(before, /👍/, 'no thumbs before the person agrees')

  __test({ on: true, consented: true })
  assert.match(renderToStaticMarkup(createElement(DogfoodBadge)), /👍/)
  assert.match(renderToStaticMarkup(createElement(ResultThumbs, { extra: { action: 'set' } })), /👎/)
  __test({ on: false, consented: false })
})
