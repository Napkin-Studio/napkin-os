// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's Decisions drawer never shows where something came from itself: it gets out of the way
// and asks the open document to show the item in its own side panel (owner, 2026-11-11).

import './domFakes'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openInApp, setBeforeOpen, setExportFrame } from '../src/shell/appExport'

test('the shell sends an item to the document’s panel and closes its Decisions drawer first', () => {
  const posted: { type?: string; ref?: string; path?: string }[] = []
  const order: string[] = []
  setExportFrame({ postMessage: (m: { type?: string }) => { posted.push(m); if (m.type === 'clan:open') order.push('open') } } as unknown as Window)
  let drawerOpen = true
  setBeforeOpen(() => { drawerOpen = false; order.push('close') })
  openInApp('f_1', 'brief.budget')
  assert.equal(drawerOpen, false, 'the Decisions drawer closed')
  assert.deepEqual(order, ['close', 'open'], 'closed before the document is asked')
  assert.deepEqual(posted.filter(m => m.type === 'clan:open'), [{ type: 'clan:open', ref: 'f_1', path: 'brief.budget' }])
  assert.ok(!posted.some(m => /provenance|drawer/.test(String(m.type))), 'nothing asks for a shell drawer')
  setBeforeOpen(null); setExportFrame(null)
})
