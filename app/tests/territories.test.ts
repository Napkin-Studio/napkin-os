// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Territories template's first screen (feature territories-spinoff-in): what a spin-off carried is on the screen, as counts and as
// the brief's own words (LESSONS 7). The fixture is what the host produced for a real spin-off
// (crates/napkin-host/tests/territories_spinoff.rs); the golden seen.json is the engine reader's output over the same data
// (engine/territory/carried.py), so the page and the engine read it the same way.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const tpl = new URL('templates/territories/', root)
const read = (rel: string) => readFileSync(new URL(rel, tpl), 'utf8')
const json = (rel: string) => JSON.parse(read(rel))
// The page as the packer makes it: the source-card helper spliced in at its marker.
const MARKER = '<!-- @napkin:source-card -->'
const html = read('index.html').replace(MARKER, readFileSync(new URL('templates/shared/source-card.html', root), 'utf8').trim())
const scripts = [...html.matchAll(/<script(?: id="([^"]+)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1] ?? '', src: m[2] }))
const helper = scripts.find(s => s.src.includes('var NapkinSource'))!.src
const logic = scripts.find(s => s.id === 'territories-logic')!.src
const view = scripts.find(s => s.id === 'territories-view')!.src

const DATA = json('example/spunoff/data.json')
const SEEN = json('example/spunoff/seen.json')
const FACTS = json('example/spunoff/facts.json')
const FINDINGS = json('example/spunoff/findings.json')

type Seen = {
  brief: null | { id: string; title: string; filled: number; total: number; fields: { id: string; label: string; text: string }[]; key_fields: { id: string; text: string }[]; mandatories: number }
  research: null | { id: string; title: string; pins: number | null; findings: number | null; verified: number | null; proposed: number | null; rejected: number | null; sources: number | null }
  from: string
}
const L = vm.runInNewContext(`${logic}; TerritoriesLogic`) as {
  seen(data: unknown): Seen
  statsOf(s: Seen): string[]
  fromWords(s: Seen): string
  BRIEF_KEYS: Record<string, string>
}

/** The page run against a fake document: what it writes into #root and #cards. */
function screen(data: unknown, title = 'Territories'): { root: string; cards: string } {
  const els: Record<string, { innerHTML: string; querySelectorAll: () => unknown[] }> = {}
  const el = (id: string) => (els[id] ??= { innerHTML: '', querySelectorAll: () => [] })
  const win: Record<string, unknown> = { __CLAN__: { data, manifest: { title } } }
  const ctx = vm.createContext({ window: win, document: { getElementById: (id: string) => el(id) } })
  vm.runInContext(`${helper}\nwindow.NapkinSource = NapkinSource;`, ctx)
  vm.runInContext(logic, ctx)
  vm.runInContext(view, ctx)
  return { root: el('root').innerHTML, cards: el('cards').innerHTML }
}

test('the page reads a spin-off exactly as the engine reader does (the golden)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(L.seen(DATA))), SEEN)
})

test('the counts on screen are the counts of the carried members', () => {
  assert.equal(SEEN.research!.pins, FACTS.facts.length)
  assert.equal(SEEN.research!.findings, FINDINGS.findings.length)
  const { root } = screen(DATA)
  assert.match(root, new RegExp(`${FACTS.facts.length} pins`))
  assert.match(root, new RegExp(`${FINDINGS.findings.length} findings`))
  assert.match(root, new RegExp(`${SEEN.brief!.filled} fields of ${SEEN.brief!.total}`))
})

test('every key brief field that arrived is on the screen in the brief\'s own words, under its name as words', () => {
  const { root } = screen(DATA)
  const keyed = SEEN.brief!.key_fields
  assert.ok(keyed.length >= 4, 'the fixture carries the key fields')
  for (const f of keyed) {
    const text = f.text.split('\n')[0].replace(/&/g, '&amp;')
    assert.ok(root.includes(text), `${f.id} is not on the screen: ${text}`)
    assert.ok(root.includes(`data-field="${f.id}"`))
  }
  assert.match(root, /Single-minded proposition/)
  assert.match(root, /The same round, the same good time\./)
})

test('the source cards are the brief\'s and the research\'s, in their own identity', () => {
  const { cards } = screen(DATA)
  assert.match(cards, /nsrc-brief/)
  assert.match(cards, /nsrc-research/)
  assert.match(cards, /Lúnasa 0\.0 launch brief/)
  assert.match(cards, new RegExp(`<b>${FACTS.facts.length}</b> facts`))
})

test('no field name, null or placeholder leaks onto the screen', () => {
  const { root, cards } = screen(DATA)
  // What a person reads: the markup's tags and attributes (data-field="smp") are not text.
  const said = (root + cards).replace(/<[^>]*>/g, ' ')
  for (const bad of ['field is null', 'null', 'undefined', 'NaN', '[object', '{{', '(to confirm)', '~~', 'single_minded_proposition', 'tone_and_world', 'smp']) {
    assert.ok(!said.includes(bad), `the screen says "${bad}"`)
  }
})

test('a brief alone, research alone, and nothing at all each say so plainly', () => {
  const briefId = SEEN.brief!.id
  const researchId = SEEN.research!.id
  const onlyBrief = screen({ upstream: { [briefId]: DATA.upstream[briefId] } }).root
  assert.match(onlyBrief, /from a brief/)
  assert.ok(!/Research · /.test(onlyBrief))
  const onlyResearch = screen({ upstream: { [researchId]: DATA.upstream[researchId] } }).root
  assert.match(onlyResearch, /from research/)
  // No projection and no members here: the count is not known, so it is not shown, never shown as 0
  assert.ok(!/0 pins|0 findings/.test(onlyResearch))
  const none = screen({}).root
  assert.match(none, /Nothing came in with this one/)
  assert.ok(!/undefined|null/.test(none))
})

test('the page says what is not built yet, and offers nothing that does nothing', () => {
  const { root } = screen(DATA)
  assert.match(root, /not been sent out/)
  assert.ok(!/<button/.test(root), 'no button on a page that cannot act yet')
})

test('the page uses only the fonts the umbrella allows and no price', () => {
  assert.ok(/Newsreader/.test(html) && /Geist/.test(html))
  assert.ok(!/(€|\$|£)\s?\d|\bUSD\b|\bEUR\b/.test(read('index.html')))
})

test('the name, the contract and the seed: the app block is the contract\'s', () => {
  const ctxmd = read('context.md')
  assert.match(ctxmd, /Cite, never copy/)
  const seed = json('seed.json')
  assert.deepEqual(seed.run.approvals, {})
  assert.equal(seed.schema_version, 1)
})
