// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Territories look-ups (territories-lookups): the Booth's box, the OK card that comes first, the note and quote cards a look-up leaves, and
// Pin / Unpin. Every press is a request or a move to the middleware (steps lookup and pin_quote), never a document write, and no price is drawn.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/territories/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const block = (id: string) => new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html)![1]
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const helper = /<script>([\s\S]*?var NapkinSource[\s\S]*?)<\/script>/.exec(readFileSync(new URL('templates/shared/source-card.html', root), 'utf8'))![1]

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const { L, K } = vm.runInNewContext(`${engine}${helper}\n${block('territories-logic')};\n${block('territories-lookups-logic')}; ({ L: TerritoriesLogic, K: TerritoriesLookups })`) as Doc
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc
const plain = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const ME = { name: 'Shrey' }, ENV = { me: ME }

function doc(): Doc {
  const d = json('example/data.json')
  d.finds = [
    { id: 'x_RAIL0001', kind: 'found', text: 'Table seats can be reserved 30 days ahead.', source: 'Example Rail Operator', date: '2026-03', quote_checked: true, lookup: 'lq_forum', in_play: false, url: 'https://railoperator.example/tables' },
    { id: 'x_RAIL0002', kind: 'found', text: 'Families booked table seats first.', source: 'Example Rail Operator', date: '2026-03', quote_checked: true, lookup: 'lq_forum', in_play: true, url: 'https://railoperator.example/tables' },
    { id: 'x_FORUM003', kind: 'found', text: 'The table seat is the most requested seat in Europe.', source: 'A travel forum', date: 'read 2026-11-23', quote_checked: false, lookup: 'lq_forum', in_play: false, url: 'https://forum.example/threads/seats' },
  ]
  d.lookups = [
    { id: 'lq_forum', q: 'Can families book table seats on weekend trains?', status: 'done', by: 'Shrey', ok_by: 'Shrey', found: ['x_RAIL0001', 'x_RAIL0002', 'x_FORUM003'], at: '2026-11-23T09:00:00Z' },
    { id: 'lq_nap', q: 'Do people describe the journey as part of the holiday?', status: 'ask', by: 'Napkin, to back up a finding' },
    { id: 'lq_mine', q: 'Is the table seat popular?', status: 'ask', by: 'Shrey' },
  ]
  d.notes = [{ id: 'nt_look01', agent: 'research', text: 'Looked up: can families book table seats? Found 3 quotes on 2 pages, 2 checked against the page. Pin the ones worth keeping.', at: '2026-11-23T09:00:00Z', cite: ['x_RAIL0001', 'x_RAIL0002', 'x_FORUM003'] },
    { id: 'nt_plain1', agent: 'review', text: 'Plain note.', at: '2026-11-23T09:01:00Z' }]
  return d
}

test('the box is live: a typed question and a named person turn the button on; nothing else asks', () => {
  const off = K.box(doc(), { me: ME })
  assert.match(off, /<textarea rows="2" data-lq-draft/); assert.match(off, /data-act="lookup" disabled/)
  assert.match(K.box(doc(), { me: ME, lq: 'Is it so?' }), /data-act="lookup">Look it up/)
  assert.match(K.box(doc(), { lq: 'Is it so?' }), /Sign in first/); assert.match(K.box(doc(), { lq: 'Is it so?' }), /data-act="lookup" disabled/)
  assert.doesNotMatch(K.box(doc(), { me: ME, lq: 'Is the table seat popular?' }), /Is the table seat popular/, 'a question that became a card leaves the box')
})

test('the question is a request that only asks: the step lookup with q, by the signed-in person', () => {
  const r = K.act(doc(), { me: ME, lq: '  Is it  so? ' }, { a: 'lookup' }, ENV)
  assert.deepEqual(JSON.parse(JSON.stringify(r.request)), { key: 'lq:new', what: 'The question', input: { step: 'lookup', q: 'Is it so?', by: 'Shrey' } })
  assert.deepEqual(JSON.parse(JSON.stringify(r.writes)), [])
  assert.match(K.act(doc(), { lq: '' }, { a: 'lookup' }, ENV).toast, /Say what to look up/)
  assert.match(K.act(doc(), { lq: 'x' }, { a: 'lookup' }, {}).toast, /Sign in first/)
  assert.match(K.act(doc(), { lq: 'x', req: { key: 'gl:x', state: 'running' } }, { a: 'lookup' }, ENV).toast, /still going/)
})

test('the OK card says what will be looked up and who wants it, and has no price', () => {
  const d = doc(), h = K.section(d, { me: ME }) as string, p = plain(h)
  assert.match(p, /Look this up on the open web\?/); assert.match(p, /Is the table seat popular\?/); assert.match(p, /Asked by Shrey\./)
  assert.match(p, /Napkin would like this, to back up a finding\./); assert.match(p, /Nothing is searched until you say OK/)
  assert.equal((h.match(/data-lq-ok="/g) || []).length, 2); assert.equal((h.match(/data-lq-no="/g) || []).length, 2)
  assert.doesNotMatch(p, /[$€£]\s?\d|\bUSD\b|\bcost\b|\bprice\b/i)
})

test('OK and Not now are requests to the lookup step for that card; a settled card has none', () => {
  const ok = K.act(doc(), { me: ME }, { a: 'lq_ok', id: 'lq_mine' }, ENV).request
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), { key: 'lq:lq_mine', what: 'The look-up', input: { step: 'lookup', lookup_id: 'lq_mine', ok: true, by: 'Shrey' } })
  assert.equal(K.act(doc(), { me: ME }, { a: 'lq_no', id: 'lq_mine' }, ENV).request.input.ok, false)
  assert.equal(K.act(doc(), { me: ME }, { a: 'lq_ok', id: 'lq_forum' }, ENV), null, 'already done')
})

test('a look-up that could not run says why in the engine\'s words and the card stays; the limit card offers no retry', () => {
  const failed = (msg: string) => ({ me: ME, req: { key: 'lq:lq_mine', state: 'failed', error: `The look-up did not go through. ${msg} Nothing changed.` } })
  const a = K.okCard(doc().lookups[2], failed('Searching is not set up here, so nothing was looked up and nothing was spent.'))
  assert.match(plain(a), /Research · not looked up/); assert.match(plain(a), /Searching is not set up here/); assert.doesNotMatch(plain(a), /did not go through|Nothing changed/)
  assert.match(a, /Try again/)
  const b = K.okCard(doc().lookups[2], failed('This document reached the number of look-ups the team allows, so nothing was looked up.'))
  assert.doesNotMatch(b, /Try again/); assert.match(b, /Not now/)
})

test('the result is a Research note and a card per quote; the plain notes list leaves the look-up note out', () => {
  const d = doc(), h = K.section(d, { me: ME }) as string, p = plain(h)
  assert.match(p, /Research · looked up/); assert.match(p, /Found 3 quotes on 2 pages, 2 checked against the page/)
  assert.equal((h.match(/data-find-card=/g) || []).length, 3)
  assert.match(h, /href="https:\/\/railoperator\.example\/tables"/); assert.match(h, /target="_blank" rel="noopener noreferrer"/)
  assert.equal(K.isLookupNote(d.notes[0], d), true); assert.equal(K.isLookupNote(d.notes[1], d), false)
  const notes = (L.boothNotes(d) as Doc[]).map(n => n.body).join(' | ')
  assert.doesNotMatch(notes, /Pin the ones worth keeping/); assert.match(notes, /Plain note/)
})

test('a checked quote has Pin it, a pinned one has Unpin, an unchecked one is marked and has no Pin', () => {
  const d = doc(), card = (id: string) => K.findCard(d.finds.find((f: Doc) => f.id === id), { me: ME }) as string
  assert.match(card('x_RAIL0001'), /data-pin="x_RAIL0001" data-on="1"/); assert.match(plain(card('x_RAIL0001')), /Checked against the page/)
  assert.match(card('x_RAIL0002'), /data-pin="x_RAIL0002" data-on="0"/); assert.match(plain(card('x_RAIL0002')), /Pinned/)
  const un = card('x_FORUM003')
  assert.doesNotMatch(un, /data-pin=/); assert.match(un, /<button type="button" class="btn"\s+disabled>Pin it/); assert.match(plain(un), /not checked/); assert.match(plain(un), /cannot be pinned/)
  assert.match(K.findCard(d.finds[0], {}), /data-pin="x_RAIL0001" data-on="1" disabled/, 'nobody signed in: off')
})

test('Pin is a small move with the quote as shown; an unchecked quote is refused here too, in words', () => {
  const m = K.act(doc(), { me: ME }, { a: 'pin', id: 'x_RAIL0001', on: true }, ENV).move
  assert.deepEqual(JSON.parse(JSON.stringify(m.input)), { step: 'pin_quote', find_id: 'x_RAIL0001', on: true, by: 'Shrey', text: 'Table seats can be reserved 30 days ahead.' })
  assert.equal(K.act(doc(), { me: ME }, { a: 'pin', id: 'x_RAIL0002', on: false }, ENV).move.input.on, false)
  assert.match(K.act(doc(), { me: ME }, { a: 'pin', id: 'x_FORUM003', on: true }, ENV).toast, /cannot be pinned/)
  assert.equal(K.act(doc(), { me: ME }, { a: 'pin', id: 'x_NOPE0000', on: true }, ENV), null)
})

test('a pinned find is a source card with its page: the chip opens it, with the link', () => {
  const d = doc(), dlg = L.dialogFor('x_RAIL0002', d)
  assert.match(dlg.html, /Found by Territories/); assert.match(dlg.html, /Families booked table seats first/); assert.match(dlg.html, /href="https:\/\/railoperator\.example\/tables"/)
  assert.match(L.dialogFor('finds', d).html, /railoperator\.example/)
  d.finds[0].url = 'javascript:alert(1)'
  assert.doesNotMatch(L.dialogFor('x_RAIL0001', d).html, /javascript:/, 'only an http(s) page is linked')
})

test('the Booth carries the box on Pick and Explore, and the page draws no price', () => {
  const d = doc(), pick = json('example/states/pick.json')
  Object.assign(pick, { lookups: d.lookups, finds: d.finds, notes: d.notes })
  const page = L.view(pick, { me: ME })
  assert.match(page, /data-lq-draft/); assert.match(page, /data-lq-ok="lq_mine"/); assert.match(page, /data-find-card="x_RAIL0001"/)
  assert.doesNotMatch(plain(page), /Look-ups are not built|[$€£]\s?\d/)
  assert.doesNotMatch(L.view(d, { me: ME }), /data-lq-draft/, 'Greenlight has no box')
})
