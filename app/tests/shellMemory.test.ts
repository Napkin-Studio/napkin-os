// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the shell keeps between documents and people: edit mode stays with
// the document it was turned on in and ends at a lock; the last document
// open is one person's, and a missing one is let go quietly.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { afterLock, editOn, setEditFor } from '../src/shell/editMode.ts'
import { docEntry, isNotFound, launchIsMine } from '../src/shell/lastOpen.ts'

test('edit mode is the document’s: a spin-off opens with it off', () => {
  const on = setEditFor({ docPath: 'brief.clan', on: false }, 'brief.clan', true)
  assert.equal(editOn(on, 'brief.clan'), true)
  assert.equal(editOn(on, 'research.clan'), false, 'the spun-off document')
  assert.equal(editOn(setEditFor(on, 'research.clan', was => !was), 'research.clan'), true, 'a flip starts from off there')
})

test('a lock ends edit mode; a later reopen does not bring it back by itself', () => {
  const on = { docPath: 'brief.clan', on: true }
  const locked = afterLock(on, 'brief.clan', false, true)
  assert.equal(editOn(locked, 'brief.clan'), false)
  assert.equal(afterLock(on, 'brief.clan', true, true), on, 'already locked: left as it is')
  assert.equal(editOn(afterLock(locked, 'brief.clan', true, false), 'brief.clan'), false)
})

test('the last document open is reopened only for the person who had it open', () => {
  assert.equal(launchIsMine(docEntry('sam@wk'), 'sam@wk'), true)
  assert.equal(launchIsMine(docEntry('sam@wk'), 'tia@tbwa'), false, 'after sign-out and someone else’s sign-in')
  assert.equal(launchIsMine(null, 'tia@tbwa'), true, 'a pasted link is theirs to try')
  assert.equal(launchIsMine({ napkinDoc: true }, 'tia@tbwa'), false, 'an entry from before people were named')
})

test('a document that is not there is told apart from other refusals', () => {
  assert.equal(isNotFound(new Error('404 Not Found')), true)
  assert.equal(isNotFound(new Error('document not found')), true)
  assert.equal(isNotFound(new Error('the store is read-only')), false)
})
