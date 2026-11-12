// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The review link's page as functions and as markup (features/client-review-full.clan): the words of a
// round and a piece, the pin's maths at several box sizes, how marks on each piece come to one answer,
// the pager, the comment sheet and the code screen, as a phone reads them.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import ReviewLink, { CodeScreen, type Review } from '../src/clientLink/ReviewLink.tsx'
import { aiWords, answerBody, nextUnmarked, overall, pinFromPoint, pinStyle, roundWords, versionWords, whereWords, type Piece } from '../src/clientLink/reviewModel.ts'

const pieces: Piece[] = [
  { n: 1, label: 'The bar at nine', kind: 'image', ai: 'not_recorded', duration_ms: null },
  { n: 2, label: 'Reference B', kind: 'image', ai: 'ai', duration_ms: null },
  { n: 3, label: 'The pour', kind: 'film', ai: 'none', duration_ms: 8000 },
]

test('the words of a version, a round and an AI label', () => {
  assert.equal(versionWords(2), 'Version 2')
  assert.equal(versionWords(null), 'Signed version')
  assert.equal(roundWords(2, 3), 'Round 2 of 3')
  assert.equal(roundWords(2, null), 'Round 2')
  assert.equal(roundWords(4, 3), 'Round 4', 'past the rounds in scope, no "of"')
  assert.equal(aiWords('ai'), 'Made with AI')
  assert.equal(aiWords('none'), 'Not made with AI')
  assert.equal(aiWords('not_recorded'), 'AI use not recorded')
  assert.equal(aiWords('anything else'), 'AI use not recorded', 'nothing is called AI-free without a record')
})

test('a pin is a fraction of the piece own box, the same on a phone and a desk screen', () => {
  for (const [w, h] of [[390, 292], [1440, 900], [320, 640]]) {
    const box = { left: 17, top: 40, width: w, height: h }
    const p = pinFromPoint(box, 17 + w * 0.4, 40 + h * 0.25)!
    assert.deepEqual(p, { x: 0.4, y: 0.25 })
    assert.deepEqual(pinStyle(p), { left: '40.0%', top: '25.0%' })
  }
  const box = { left: 0, top: 0, width: 200, height: 100 }
  assert.deepEqual(pinFromPoint(box, -50, 500), { x: 0, y: 1 }, 'a tap outside the box is held to its edge')
  assert.equal(pinFromPoint({ ...box, width: 0 }, 1, 1), null)
  assert.equal(pinFromPoint(box, 100.3333, 33.3333)!.x, 0.502, 'three decimals')
  assert.equal(pinStyle({ t_ms: 4000 }), null)
  assert.equal(whereWords({ t_ms: 4000 }), 'At 0:04')
  assert.equal(whereWords(null), 'On the whole piece')
})

test('marks on each piece come to one answer, only when every piece has one', () => {
  assert.equal(overall(pieces, { 1: 'approve', 2: 'approve' }), null)
  assert.equal(overall(pieces, { 1: 'approve', 2: 'approve', 3: 'approve' }), 'confirm')
  assert.equal(overall(pieces, { 1: 'approve', 2: 'changes', 3: 'approve' }), 'changes')
  assert.equal(nextUnmarked(pieces, { 1: 'approve' }, 1), 2)
  assert.equal(nextUnmarked(pieces, { 2: 'approve', 3: 'approve' }, 3), 1, 'wraps round to the piece left')
  assert.equal(nextUnmarked(pieces, { 1: 'approve', 2: 'approve', 3: 'approve' }, 1), null)
  const body = answerBody(pieces, { 1: 'approve', 2: 'changes', 3: 'approve' })!
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'pieces'], 'the body holds the answer and the marks: who, version, round and channel are the link')
  assert.equal(body.pieces[1].answer, 'changes')
})

const page: Review = {
  title: 'Visual brief for Client A', client: { name: 'Pat' }, agency: { name: 'Wk' }, version: 'sha256:00', version_n: 2, expires: '2026-12-11T09:00:00Z',
  round: 2, rounds_in_scope: 3, approver: true, pieces, comments: [
    { id: 'c1', piece: 1, pin: { x: 0.25, y: 0.5 }, tag: 'preference', text: 'Warmer here' },
  ],
  points: [{ key: 'proposition', label: 'The one thing to say' }], html: '<p>x</p>',
}

test('the first piece shows its position, version, AI label and the round, with Approve before Ask for changes', () => {
  const html = renderToStaticMarkup(createElement(ReviewLink, { token: 'a.b', page, onGone: () => {}, onDone: () => {} }))
  assert.match(html, /Piece 1 of 3/)
  assert.match(html, /data-testid="piece-version">Version 2</)
  assert.match(html, /data-testid="ai-label"[^>]*>AI use not recorded</)
  assert.match(html, /Round 2 of 3/)
  assert.match(html, /src="\/c\/a\.b\/piece\/1"/, 'an image is served from the link, never from a path in the page')
  assert.ok(html.indexOf('>Approve<') < html.indexOf('>Ask for changes<'))
  assert.match(html, /data-testid="pin"/, 'the reviewer\'s own pin is drawn where it was tapped')
  assert.match(html, /left:25\.0%;top:50\.0%/)
  assert.match(html, /Warmer here/)
  assert.match(html, />Next</)
  assert.ok(!/human\/assets|sha256/.test(html))
})

test('a text piece is drawn in a frame that cannot run script', () => {
  const html = renderToStaticMarkup(createElement(ReviewLink, { token: 'a.b', page: { ...page, pieces: [{ ...pieces[0], kind: 'text' }], comments: [] }, onGone: () => {}, onDone: () => {} }))
  assert.match(html, /<iframe[^>]*sandbox=""/)
  assert.ok(!html.includes('Next'), 'one piece has no pager')
})

test('the code screen offers to email a code and shows nothing of the document', () => {
  const html = renderToStaticMarkup(createElement(CodeScreen, { token: 'a.b', agency: { name: 'Wk' }, onIn: () => {}, onGone: () => {} }))
  assert.match(html, /Email me a code/)
  assert.match(html, /WK/)
  assert.ok(!/Pat|Client A|brief/i.test(html.replace(/To open this[^<]*/, '')))
})
