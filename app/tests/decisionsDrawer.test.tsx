// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Decisions drawer's call card, as the mock draws it: the first calls,
// then "Show all N", so Approve all and the views stay in sight.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AttentionItem } from '../src/host'
import { CALLS_SHOWN, DecisionsDrawer, type CallGroup } from '../src/shell/nui/DecisionsDrawer.tsx'

const call = (i: number): AttentionItem => ({ code: 'unverified_finding', text: `Finding ${i}`, blocks_lock: true, label: `Finding · Call ${i}`, address: `findings.f_${i}` })
const group = (n: number, key = 'doc', title = 'Window Open'): CallGroup => ({
  key, title, noun: 'brief', calls: Array.from({ length: n }, (_, i) => call(i + 1)), locked: false,
  verify: async () => {}, approve: async () => {}, open: () => {},
})
const drawer = (n: number) => renderToStaticMarkup(createElement(DecisionsDrawer, {
  title: 'McD · Window Open', groups: [group(n)], view: 'graph', onView: () => {}, onClose: () => {},
  focus: { title: 'Window Open', noun: 'brief', view: null, onShow: () => {} },
}))

test('a long list of calls is capped with "Show all N"; Approve all and the views follow', () => {
  const html = drawer(25)
  assert.equal(html.match(/data-testid="call-row"/g)?.length, CALLS_SHOWN)
  assert.match(html, /data-testid="calls-show-all"[^>]*>Show all 25</)
  assert.match(html, /25 open calls need your sign-off/)
  assert.ok(html.indexOf('calls-show-all') < html.indexOf('data-testid="approve-all"'), 'Approve all comes after the capped list')
  assert.match(html, />Graph<.*>By part<.*>By time<.*>Lineage</s)
})

test('a short list shows every call and no Show all', () => {
  const html = drawer(CALLS_SHOWN)
  assert.equal(html.match(/data-testid="call-row"/g)?.length, CALLS_SHOWN)
  assert.doesNotMatch(html, /calls-show-all/)
})

test('on the desk, Approve shows for the documents whose calls are in sight', () => {
  const html = renderToStaticMarkup(createElement(DecisionsDrawer, {
    title: 'Your desk', groups: [group(5, 'a', 'Window Open'), group(4, 'b', 'McSlurry')], view: 'graph', onView: () => {}, onClose: () => {},
  }))
  assert.equal(html.match(/data-testid="approve-all"/g)?.length, 1)
  assert.match(html, /Approve all and lock the brief · Window Open/)
  assert.match(html, />Show all 9</)
})
