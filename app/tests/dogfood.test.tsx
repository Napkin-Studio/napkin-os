// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The dogfood build's shell side (features/dogfood-telemetry.clan): nothing
// is taken or shown unless the server records and the person has agreed;
// events go in batches; the notice names the contact.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DogfoodBadge, DogfoodNotice, ResultThumbs } from '../src/dogfood/Dogfood.tsx'
import {
  CONTACT, FRAME_CAPTURE, Recorder, __test, feedback, frameCapture, record, recording, setScreen,
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
  record('click', 'x'); feedback('screen', 'up', '')
  __test({ on: true, consented: false })
  record('click', 'x'); feedback('screen', 'up', '')
  assert.equal(recording(), false)
  assert.equal(sent.length, 0)

  __test({ on: true, consented: true })
  setScreen({ screen: 'app', doc: 'brief.clan', app: 'brief-maker' })
  feedback('screen', 'down', ' too slow ', { screen: 'app' })
  const events = sent.flat()
  assert.deepEqual(events.map(e => e.kind), ['nav', 'feedback'])
  const fb = events[1]
  assert.equal(fb.doc, 'brief.clan')
  assert.equal(fb.app, 'brief-maker')
  assert.equal(fb.data?.thumb, 'down')
  assert.equal(fb.data?.note, 'too slow')
  __test({ on: false, consented: false })
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
