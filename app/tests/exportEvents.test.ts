// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A tab acts only on export events meant for it (features/pdf-export.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isMyExport } from '../src/host/exportEvents.ts'

test("another tab's export is ignored", () => {
  assert.equal(isMyExport({ frame: 'theirs' }, 'mine'), false)
  assert.equal(isMyExport({ frame: 'theirs' }, null), false)
})

test("this tab's export is taken", () => {
  assert.equal(isMyExport({ frame: 'mine' }, 'mine'), true)
})

test('an export from a one-tab host (the desktop) carries no frame and is taken', () => {
  assert.equal(isMyExport({}, 'mine'), true)
  assert.equal(isMyExport(null, 'mine'), false)
})
