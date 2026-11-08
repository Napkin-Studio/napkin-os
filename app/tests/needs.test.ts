// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one needs-your-call selector (decisions/needs.ts) the OS bar counts, the
// medallion lights on and the Decisions drawer lists, and the state pill's words.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AttentionItem, DecisionsView } from '../src/host/types.ts'
import { docStateOf, needsOf } from '../src/shell/decisions/needs.ts'

const need = (code: string, address: string, blocks = true): AttentionItem =>
  ({ code, address, text: `${code} at ${address}`, blocks_lock: blocks } as AttentionItem)
const view = (attention: AttentionItem[], lock: Partial<DecisionsView['lock']> = {}): DecisionsView =>
  ({ attention, decisions: [], cites: {}, lock: { can_lock: false, blockers: 0, ...lock } } as unknown as DecisionsView)

test('needsOf: only what blocks the lock, one per place', () => {
  const v = view([need('unverified', 'a'), need('unverified', 'a'), need('flagged', 'b', false), need('rejected', 'c')])
  assert.deepEqual(needsOf(v).map(n => n.address), ['a', 'c'])
  assert.deepEqual(needsOf(null), [])
})

test('the state pill: Draft, Needs you (n), Ready to lock, Locked, Reopened', () => {
  assert.equal(docStateOf(null), null)
  assert.equal(docStateOf({ ...view([]), problem: 'unreadable' }), null)
  assert.deepEqual(docStateOf(view([])), { label: 'Draft', tone: null, locked: false })
  assert.deepEqual(docStateOf(view([need('unverified', 'a'), need('rejected', 'c')])), { label: 'Needs you (2)', tone: 'warn', locked: false })
  assert.deepEqual(docStateOf(view([], { can_lock: true })), { label: 'Ready to lock', tone: 'ok', locked: false })
  assert.deepEqual(docStateOf(view([], { locked: true })), { label: 'Locked', tone: 'ok', locked: true })
  assert.deepEqual(docStateOf(view([], { locked: true, reopened: [{}] as never })), { label: 'Reopened', tone: 'warn', locked: false })
})
