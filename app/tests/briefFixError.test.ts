// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// UAT 2026-11-22 (Brief Maker): a raw `invalid_input (400): input.verdict is not a bad verdict still standing...` stood in the
// booth after a lock. The middleware's refusals to "Fix this with the agents" are put in plain words, and a note that no
// longer stands says nothing at all.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!root.pathname.endsWith('/app/')) root = new URL('..', root)
const html = readFileSync(new URL('templates/brief-maker/index.html', root), 'utf8')

function fn(name: string): string {
  const at = html.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `${name} is in the page`)
  let depth = 0
  for (let i = html.indexOf('{', at); i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1)
  }
  throw new Error('unbalanced')
}
const plainFixError = vm.runInNewContext(`${fn('plainFixError')}; plainFixError`) as (m: string) => { text: string; stale: boolean }

test('a note that no longer stands is not an error: nothing is shown', () => {
  const r = plainFixError('invalid_input (400): input.verdict is not a bad verdict still standing on a part of this brief')
  assert.deepEqual({ ...r }, { text: '', stale: true })
})

test('the other refusals are plain words, never the input path or the error code', () => {
  for (const raw of ['invalid_input (400): the brief is locked: nothing may be fixed in it', 'invalid_input (400): input.guidance must be a string', 'invalid_input (400): every part the verdict names is locked (data.locked_fields)']) {
    const r = plainFixError(raw)
    assert.ok(r.text.length > 0 && !/invalid_input|input\.|\(400\)/.test(r.text), raw)
  }
  assert.equal(plainFixError('The middleware could not be reached: offline').text, 'The middleware could not be reached: offline')
})
