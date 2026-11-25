// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Acceptance A31: "Edit beats" at the storyline gate dropped the Deck's Build view to "Waiting for the engine · Not connected": the bridge put
// the patch {run: {decisions, gate_requests}} over the page's run, wiping run.gate, while the host merged it. The page's copy now takes a patch as
// the host does (napkin-host json_merge: a JSON merge patch).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function appRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'src', 'shell', 'bridge'))) dir = dirname(dir)
  return dir
}
const src = readFileSync(join(appRoot(), 'src/shell/bridge/structuredEditBridge.js'), 'utf8').replace(/^(\/\/[^\n]*\n)+/, '')

function frame(data: Record<string, unknown>) {
  const events: string[] = []
  const win: Record<string, unknown> = {
    __CLAN__: { data },
    parent: { postMessage: () => {} },
    navigator: { userAgent: 'test' },
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: (e: { type: string }) => { events.push(e.type); return true },
  }
  const fetch = (url: string) => Promise.resolve({ json: () => Promise.resolve(url.endsWith('/patch-data') ? { ok: true } : {}) })
  const doc = { documentElement: { setAttribute() {}, style: {}, outerHTML: '' }, querySelectorAll: () => [] }
  class CE { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail } }
  class MO { observe() {} disconnect() {} }
  new Function('window', 'document', 'CustomEvent', 'MutationObserver', 'setInterval', 'setTimeout', 'clearTimeout', 'fetch', src)(
    win, doc, CE, MO, () => 0, () => 0, () => {}, fetch)
  return { win, events, clan: win.clan as { patchData: (p: unknown, o?: unknown) => Promise<unknown> } }
}

test('a patch of one part of a nested object keeps its other parts on the page, as the host does', async () => {
  const gate = { id: 'storyline', n: 1, of: 3, beats: [{ title: 'Copperell wins by …' }] }
  const f = frame({ run: { state: 'gate', gate, stages: [{ id: 'storyline', status: 'now' }], approvals: {} }, inputs: { prompt: { text: 'x' } } })
  await f.clan.patchData({ run: { decisions: [{ gate: 'storyline', kind: 'edit' }], gate_requests: [{ gate: 'storyline', kind: 'edit', status: 'waiting' }] } })
  const data = (f.win.__CLAN__ as { data: Record<string, Record<string, unknown>> }).data
  assert.deepEqual(data.run.gate, gate)   // A31: the gate was wiped and the Build view said "Waiting for the engine"
  assert.equal(data.run.state, 'gate')
  assert.equal((data.run.gate_requests as unknown[]).length, 1)
  assert.deepEqual(data.inputs, { prompt: { text: 'x' } })
  assert.ok(f.events.includes('clan:dataupdated'))
})

test('null removes a key, arrays and scalars replace, as a JSON merge patch does', async () => {
  const f = frame({ a: { keep: 1, drop: 2, list: [1, 2] }, b: 'old' })
  await f.clan.patchData({ a: { drop: null, list: [3] }, b: 'new', c: { d: 1 } })
  assert.deepEqual((f.win.__CLAN__ as { data: unknown }).data, { a: { keep: 1, list: [3] }, b: 'new', c: { d: 1 } })
})
