// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The open document reads its links and its source again when another
// document changes, and takes its own name from the library once its app
// renamed it (features/spinoff-and-links).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LibraryItem } from '../src/host/types.ts'
import { listedTitle, othersStamp } from '../src/shell/docFreshness.ts'

const it = (path: string, updated_at: string, title = path): LibraryItem => ({
  path, app_id: 'ie.napkin.campaign-research', title, updated_at, client: null, run: null,
})

test('the stamp moves when another document changes, not when the open one does', () => {
  const before = othersStamp([it('r.clan', 't1'), it('b.clan', 't1')], 'r.clan')
  assert.equal(othersStamp([it('r.clan', 't2'), it('b.clan', 't1')], 'r.clan'), before, 'its own write is read by its own hooks')
  assert.notEqual(othersStamp([it('r.clan', 't1'), it('b.clan', 't2')], 'r.clan'), before, 'the brief unlinked or changed')
  assert.equal(othersStamp([it('b.clan', 't1'), it('r.clan', 't1')], 'r.clan'), before, 'order does not matter')
  assert.equal(othersStamp(null, 'r.clan'), '')
})

test('the bar takes the name the library has now', () => {
  const lib = [it('r.clan', 't1', 'Guinness 0.0 · Ireland and Great Britain')]
  assert.equal(listedTitle(lib, 'r.clan'), 'Guinness 0.0 · Ireland and Great Britain')
  assert.equal(listedTitle(lib, 'other.clan'), null)
  assert.equal(listedTitle([it('r.clan', 't1', '  ')], 'r.clan'), null)
  assert.equal(listedTitle(undefined, 'r.clan'), null)
})
