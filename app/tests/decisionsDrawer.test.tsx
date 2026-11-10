// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Decisions drawer's call card, as the mock draws it: the first calls,
// then "Show all N", so Approve all and the views stay in sight.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AttentionItem } from '../src/host'
import { CALLS_SHOWN, DecisionsDrawer, type CallGroup } from '../src/shell/nui/DecisionsDrawer.tsx'

const call = (i: number): AttentionItem => ({ code: 'unverified_finding', text: `Finding ${i}`, blocks_lock: true, label: `Finding · Call ${i}`, address: `findings.f_${i}` })
const group = (n: number, key = 'doc', title = 'Window Open'): CallGroup => ({
  key, title, noun: 'brief', calls: Array.from({ length: n }, (_, i) => call(i + 1)), locked: false,
  verify: async () => {}, approve: async () => {}, open: () => {},
})
const drawer = (n: number) => renderToStaticMarkup(createElement(DecisionsDrawer, {
  title: 'McD · Window Open', groups: [group(n)], view: 'graph', onView: () => {}, onClose: () => {},
  focus: { title: 'Window Open', noun: 'brief', view: null, onShow: () => {} },
}))

test('a long list of calls is capped with "Show all N"; Approve all and the views follow', () => {
  const html = drawer(25)
  assert.equal(html.match(/data-testid="call-row"/g)?.length, CALLS_SHOWN)
  assert.match(html, /data-testid="calls-show-all"[^>]*>Show all 25</)
  assert.match(html, /25 open calls need your sign-off/)
  assert.ok(html.indexOf('calls-show-all') < html.indexOf('data-testid="approve-all"'), 'Approve all comes after the capped list')
  assert.match(html, />Graph<.*>By part<.*>By time<.*>Lineage</s)
})

test('a short list shows every call and no Show all', () => {
  const html = drawer(CALLS_SHOWN)
  assert.equal(html.match(/data-testid="call-row"/g)?.length, CALLS_SHOWN)
  assert.doesNotMatch(html, /calls-show-all/)
})

test('on the desk, Approve shows for the documents whose calls are in sight', () => {
  const html = renderToStaticMarkup(createElement(DecisionsDrawer, {
    title: 'Your desk', groups: [group(5, 'a', 'Window Open'), group(4, 'b', 'McSlurry')], view: 'graph', onView: () => {}, onClose: () => {},
  }))
  assert.equal(html.match(/data-testid="approve-all"/g)?.length, 1)
  assert.match(html, /Approve all and lock the brief · Window Open/)
  assert.match(html, />Show all 9</)
})

// The Lineage tab holds the whole chain itself (owner, 11 Nov 2026: "Why 2
// clicks here?"): the app, where it came from, You are here, what was made
// from it, what is linked; the ids folded under Technical details.
const UUID = '7d1c2b4e-9a0f-4c3d-8e21-5b6a7c8d9e0f'
const SHA = 'a3f1c9e2b7d4058e6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8'
const lineageFocus = (over: Record<string, unknown> = {}) => ({
  title: 'McSlurry · Ireland and Great Britain', noun: 'report', onShow: () => {}, onOpenPath: () => {},
  view: { decisions: [], attention: [], cites: {}, lock: { locked: false, can_lock: false } } as never,
  manifest: {
    id: UUID, document_type: 'campaign-research',
    app: { name: 'Research Tool', app_id: 'ie.napkin.campaign-research', version: '0.5.1' },
    lineage: { parent_id: '11111111-2222-3333-4444-555555555555', parent_sha256: SHA, delta: 'middleware change from start_campaign@1.0' },
  },
  related: {
    document_id: UUID,
    upstream: [
      { document_id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Lúnasa research', path: 'docs/lunasa.clan', how: 'made_from', noun: 'report' },
      { document_id: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'Oat milk kit', path: 'docs/oat.clan', how: 'linked', noun: 'kit', taken: 3 },
    ],
    downstream: [
      { document_id: 'aaaaaaaa-0000-0000-0000-000000000003', title: 'Spring brief', path: 'docs/spring.clan', how: 'made_into', noun: 'brief' },
      { document_id: 'aaaaaaaa-0000-0000-0000-000000000004', title: 'Spring film', path: 'docs/film.clan', how: 'linked_in', noun: 'deck' },
    ],
  },
  upstream: [
    { document_id: 'aaaaaaaa-0000-0000-0000-000000000001', direct: true, in_store: true, status: 'current', how: 'made_from', title: 'Lúnasa research' },
    { document_id: 'aaaaaaaa-0000-0000-0000-000000000009', direct: false, in_store: true, status: 'not_compared', how: 'carried', title: 'Market scan', path: 'docs/scan.clan', noun: 'report' },
  ],
  ...over,
})
const lineage = (focus = lineageFocus()) => renderToStaticMarkup(createElement(DecisionsDrawer, {
  title: 'McSlurry · Ireland and Great Britain', groups: [], view: 'lineage', onView: () => {}, onClose: () => {}, focus: focus as never,
}))
const visible = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('Lineage shows the whole chain in order: app, where it came from, here, made from it, linked', () => {
  const html = lineage()
  const text = visible(html)
  const order = ['The app', 'Research Tool · v0.5.1', 'Where it came from', 'Market scan', 'Lúnasa research',
    'Written by the research run (start campaign)', 'This document', 'McSlurry · Ireland and Great Britain', 'You are here',
    'What was made from it', 'Spring brief', 'Linked documents', 'Oat milk kit', 'Spring film']
  let at = -1
  for (const w of order) {
    const i = text.indexOf(w, at + 1)
    assert.ok(i > at, `"${w}" comes after what is before it`)
    at = i
  }
  // The app's id is a quiet tooltip only.
  assert.match(html, /title="ie\.napkin\.campaign-research"/)
  // Every ancestor and child opens: Market scan, Lúnasa, Spring brief, Oat milk, Spring film.
  assert.equal(html.match(/data-testid="lineage-open"/g)?.length, 5)
})

test('Lineage says it in words: no uuid, sha or raw middleware words in sight; the ids are folded with Copy', () => {
  const html = lineage()
  const text = visible(html)
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i, 'no uuid in the visible text')
  assert.doesNotMatch(text, /[0-9a-f]{24,}/i, 'no sha256 in the visible text')
  assert.doesNotMatch(text, /ie\.napkin\.|middleware change|start_campaign|@1\.0/, 'no app id or raw delta in sight')
  const tech = /<details[^>]*data-testid="lineage-tech"[\s\S]*?<\/details>/.exec(html)?.[0] ?? ''
  assert.match(tech, /<summary>Technical details<\/summary>/)
  for (const id of [UUID, SHA, 'ie.napkin.campaign-research']) assert.ok(tech.includes(id), `${id} is in Technical details`)
  assert.ok((tech.match(/>Copy</g)?.length ?? 0) >= 3, 'each id has a copy button')
})

test('Lineage has no "Step by step": the floating Workspace panel is gone from documents', () => {
  const html = lineage()
  assert.doesNotMatch(html, /Step by step/)
  assert.doesNotMatch(html, /Workspace (&amp;|&) lineage/)
})

test('a document with nothing before or after it says so in words', () => {
  const html = lineage(lineageFocus({ manifest: { id: UUID }, related: { document_id: UUID, upstream: [], downstream: [] }, upstream: [] }))
  const text = visible(html)
  assert.match(text, /Where it came from Started here, from nothing before it\./)
  assert.match(text, /What was made from it Nothing yet\./)
  assert.doesNotMatch(text, /The app/)
})

test('a spin-off does not say its parent twice', () => {
  const f = lineageFocus()
  const html = lineage({ ...f, manifest: { ...f.manifest, lineage: { parent_id: UUID, delta: 'Spun off from "Lúnasa research" into Brief Maker v0.9.5' } } })
  assert.equal(visible(html).match(/Lúnasa research/g)?.length, 1)
})

test('a last change reads in words, whatever wrote it', async () => {
  const { changeWords } = await import('../src/shell/nui/drawerData.ts')
  assert.equal(changeWords('middleware change from start_campaign@1.0', 'Research Tool'), 'Written by the research run (start campaign)')
  assert.equal(changeWords('middleware change from write_brief', 'Brief Maker'), 'Written by the brief run (write brief)')
  assert.equal(changeWords('updated fields: audience, background, barrier, brief_input, job'), '5 parts edited (audience, background, barrier and 2 more)')
  assert.equal(changeWords('added asset logo.png'), 'A file was added (logo.png)')
  assert.doesNotMatch(changeWords(`took ${UUID} at sha256:${SHA}`), /[0-9a-f]{12,}/)
})
