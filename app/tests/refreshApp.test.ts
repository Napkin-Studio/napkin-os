// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// When the shell writes to the open document (attaching a Brand Clan), the
// app's frame must read the document as it now stands: `refreshApp` hands it
// the data from the write's reply, or nudges it with none when there is none.

import assert from 'node:assert/strict'
import { test } from 'node:test'

// appExport listens for messages as it loads, so give it a window to listen on.
;(globalThis as unknown as { window: unknown }).window = { addEventListener() {} }
const { refreshApp, setExportFrame } = await import('../src/shell/appExport.ts')

function frameWith(sent: unknown[]): Window {
  return { postMessage: (m: unknown) => { sent.push(m) } } as unknown as Window
}

test('the frame is handed the document the write returned', () => {
  const sent: unknown[] = []
  setExportFrame(frameWith(sent))
  sent.length = 0 // the frame is asked what it can run when it is set
  refreshApp({ id: 'd', data: { client: 'Lumen Water' } })
  assert.deepEqual(sent, [{ type: 'clan:dataupdated', source: 'shell', data: { client: 'Lumen Water' } }])
})

test('with no document in the reply the frame is only nudged', () => {
  const sent: unknown[] = []
  setExportFrame(frameWith(sent))
  sent.length = 0 // the frame is asked what it can run when it is set
  refreshApp()
  refreshApp({ id: 'd' })
  refreshApp({ data: 'not an object' })
  assert.deepEqual(sent, Array(3).fill({ type: 'clan:dataupdated', source: 'shell' }))
})
