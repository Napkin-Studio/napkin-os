// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Update, on the 409 alert (features/align-booth.clan, review): it reads the newer version and hands it to the page before the alert
// clears; where it cannot, the alert stays and says what to do. Nothing the person typed is forced over the newer version.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSaveQueue } from '../src/components/states/saveQueue.ts'
import { takeNewerVersion } from '../src/shell/takeNewer.ts'

const changed = () => {
  const q = createSaveQueue()
  q.report({ id: 'w1', state: 'saving', field: 'audience', text: 'My unsaved words.' })
  q.report({ id: 'w1', state: 'changed', field: 'audience', text: 'My unsaved words.' })
  return q
}

test('Update reads the newer version and gives it to the page, then settles the alert', async () => {
  const q = changed(), calls: string[] = []
  const err = await takeNewerVersion({
    read: async () => { calls.push('read'); return { data: { audience: 'Their words.' } } },
    push: d => { calls.push('push:' + JSON.stringify(d)) },
    queue: { forgetChanged: () => { calls.push('forget'); q.forgetChanged() } },
  })
  assert.equal(err, null)
  assert.deepEqual(calls, ['read', 'push:{"audience":"Their words."}', 'forget'], 'read, then the page has it, then the alert clears')
  assert.equal(q.state(), 'idle')
})

test('where the newer version cannot be read, the alert stays and says what to do', async () => {
  const q = changed(); let pushed = 0
  const err = await takeNewerVersion({ read: async () => { throw new Error('offline') }, push: () => { pushed++ }, queue: q })
  assert.match(err ?? '', /Could not read the newer version\. Check your connection and press Update again\./)
  assert.equal(pushed, 0)
  assert.equal(q.state(), 'changed', 'still stale: nothing was settled')
  assert.equal(q.unsaved()[0].text, 'My unsaved words.', 'and what the person typed is kept')
})
