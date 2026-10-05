// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// An export the server fails to make reaches the shell as an error with the
// server's reason, so it says "Export failed", never "Exported"
// (features/pdf-export.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fetchFile } from '../src/host/fetchFile.ts'

const answer = (body: BodyInit, status: number, type: string) =>
  (async () => new Response(body, { status, headers: { 'Content-Type': type } })) as unknown as typeof fetch

test('a made file comes back as its bytes', async () => {
  const blob = await fetchFile('/x', answer('%PDF-1.4 probe', 200, 'application/pdf'))
  assert.equal(await blob.text(), '%PDF-1.4 probe')
})

test("a failed render throws with the server's reason", async () => {
  const reason = 'chromium failed to render the PDF; renderer said: no room'
  await assert.rejects(
    fetchFile('/x', answer(JSON.stringify({ ok: false, error: reason }), 500, 'application/json')),
    new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
})

test('a failure without a reason still throws, naming the status', async () => {
  await assert.rejects(fetchFile('/x', answer('gateway', 502, 'text/plain')), /502/)
})
