// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the Brief gate says and which button a person gets (features/brief-gate.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GateItem, GateView, LibraryItem } from '../src/host/types.ts'
import {
  BRIEF_MAKER, changedBriefs, clientQuestions, headline, roleOf, signAction, signerNameProblem, teamItems, territoriesOf,
} from '../src/shell/gate/words.ts'

const item = (id: GateItem['id'], state: GateItem['state'], over: Partial<GateItem> = {}): GateItem =>
  ({ id, label: id, state, ...over })

const SIGNERS = [
  { role: 'planner', person: 'aoife@wk', signed: false },
  { role: 'creative_director', person: 'dara@wk', signed: false },
]

const view = (over: Partial<GateView> = {}): GateView => ({
  enforced: true,
  items: ['proposition', 'insight', 'objective', 'feel_or_do', 'famous', 'baseline'].map(id => item(id as GateItem['id'], 'pass')),
  missing: 0, passed: true, signers: SIGNERS, planner_signed: false, signed: false, confirmed: false,
  changed_since_lock: false, open: false, waiting_on: [], ...over,
})

test('a missing objective is one question for the client, with what the brief says', () => {
  const items = [item('objective', 'missing', { evidence: 'Grow consideration among younger drinkers.', why: 'The objective gives no number and no date.' }), item('insight', 'pass')]
  const qs = clientQuestions(items)
  assert.equal(qs.length, 1)
  assert.equal(qs[0].id, 'objective')
  assert.match(qs[0].because, /Grow consideration/)
  assert.deepEqual(teamItems(items), [])
})

test('items only the team can settle are not put to the client', () => {
  const items = [item('famous', 'missing', { why: 'x' }), item('proposition', 'missing', { why: 'y' })]
  assert.deepEqual(clientQuestions(items), [])
  assert.deepEqual(teamItems(items).map(i => i.id), ['famous', 'proposition'])
})

test('the headline counts the items and keeps Territories closed until all three are met', () => {
  const sixth = view({ items: view().items.map(i => i.id === 'baseline' ? item('baseline', 'missing') : i), missing: 1, passed: false })
  assert.match(headline(sixth, 'Client A'), /^5 of 6 gate items passed\. Territories stay closed until the brief passes, the agency signs it and Client A confirms it\.$/)
  assert.match(headline(view({ signed: true, confirmed: true, open: true }), 'Client A'), /Territories are open/)
  assert.match(headline(view({ changed_since_lock: true }), 'Client A'), /signed version stays as it was/)
})

test('the planner signs first, and the creative director cannot sign before them', () => {
  assert.deepEqual(signAction(view(), 'aoife@wk'), { kind: 'planner', label: 'Sign this version', blocked: null })
  assert.equal(signAction(view(), 'dara@wk')!.blocked, 'The planner signs first.')
  assert.equal(signAction(view({ planner_signed: true }), 'dara@wk')!.blocked, null)
  assert.match(signAction(view({ planner_signed: true }), 'aoife@wk')!.blocked!, /creative director signs next/)
})

test('a brief with a missing item cannot be signed, and the reason is the count', () => {
  const v = view({ passed: false, missing: 2 })
  assert.match(signAction(v, 'aoife@wk')!.blocked!, /^2 gate items are missing\. Signing locks this version\.$/)
  assert.match(signAction(view({ passed: false, missing: 1, planner_signed: true }), 'dara@wk')!.blocked!, /^One gate item is missing/)
})

test('nobody else gets a button, and a signed brief gets none until it changes', () => {
  assert.equal(signAction(view(), 'cian@wk'), null)
  assert.equal(signAction(view(), null), null)
  assert.equal(signAction(view({ signed: true, planner_signed: true }), 'dara@wk'), null)
  assert.equal(signAction(view({ signers: [SIGNERS[0]] }), 'aoife@wk'), null) // both signers must be named
})

const lib = (over: Partial<LibraryItem> & { gate?: object }): LibraryItem => ({
  path: 'p', app_id: BRIEF_MAKER, title: 'J001 brief', updated_at: '', client: null, run: null,
  state: { needs_you: 0, locked: false, gate: over.gate as never }, ...over,
})
const G = { enforced: true, passed: false, signed: false, confirmed: false, changed_since_lock: false, open: false }

test('Territories are closed until the host says a brief is open, and say what is waiting', () => {
  const none = territoriesOf([], 'Client A')
  assert.equal(none.open, false)
  assert.deepEqual(none.steps.map(s => s.done), [false, false, false, false])
  const signed = territoriesOf([lib({ gate: { ...G, passed: true, signed: true } })], 'Client A')
  assert.equal(signed.open, false)
  assert.deepEqual(signed.steps.map(s => s.done), [true, true, true, false])
  const open = territoriesOf([lib({ gate: { ...G, passed: true, signed: true, confirmed: true, open: true } })], 'Client A')
  assert.equal(open.open, true)
})

test('a changed brief reopens the steps, and is the desk alert', () => {
  const changed = lib({ path: 'c', gate: { ...G, passed: true, signed: true, confirmed: true, changed_since_lock: true } })
  const t = territoriesOf([changed], 'Client A')
  assert.deepEqual(t.steps.map(s => s.done), [true, true, false, false])
  assert.deepEqual(changedBriefs([changed, lib({ path: 'd', gate: G })]).map(i => i.path), ['c'])
})

test('a signer is named by their sign-in name, the name signing and Needs you find them by', () => {
  // signed in by name: a display name is refused before it is written, with what to write instead
  assert.equal(signerNameProblem('dara@wk', 'aoife@wk'), null)
  assert.equal(signerNameProblem('  dara@wk  ', 'aoife@wk'), null)
  assert.equal(signerNameProblem('Dara Byrne', 'aoife@wk'), 'Use their sign-in name, like name@wk.')
  assert.equal(signerNameProblem('dara', 'aoife@wk'), 'Use their sign-in name, like name@wk.')
  assert.equal(signerNameProblem('dara @wk', 'aoife@wk'), 'Use their sign-in name, like name@wk.')
  assert.equal(signerNameProblem('', 'aoife@wk'), null) // an empty field is the button's to hold, not an error
  // a workspace with no sign-in names its one person as it is
  assert.equal(signerNameProblem('Dara', 't-anon'), null)
  assert.equal(signerNameProblem('Dara', null), null)
  // why it matters: the person signed in is found among the signers by that exact name
  assert.equal(roleOf([{ role: 'creative_director', person: 'Dara Byrne', signed: false }], 'dara@wk'), null)
  assert.equal(roleOf([{ role: 'creative_director', person: 'dara@wk', signed: false }], 'dara@wk'), 'creative_director')
})
