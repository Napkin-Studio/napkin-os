// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Deck Maker's Production picker panel (deck-prod-picker P6): the pure DeckProd block (tiles, reach and rights
// badges, the opt-in wording, the swap patch), the panel on a slide's Review aside, and the schema for production and
// review.production. Kept in its own file beside deckMaker.test.ts, as the panel is its own section of the page.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { parseYaml } from './deckMakerYaml'
import { validate, type Schema } from './schemaCheck'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/deck-maker/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const schema = JSON.parse(readFileSync(new URL('schema.json', dir), 'utf8')) as Schema
const logicSrc = /<script id="deck-logic">([\s\S]*?)<\/script>/.exec(html)![1]
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const logicRun = engine + logicSrc

type Badge = [string, string]
type Tile = { key: string; label: string; reach: Badge; rights: Badge; placeable: boolean }
type Slot = { id: string; slide: string; slot: string; chosen: Tile; by: string; candidates: Tile[]; pending: string; notReachable: boolean }
type View = { card: string; slots: Slot[]; fetchLine: string; lookLine: string; allowListEmpty: boolean }
const P = vm.runInNewContext(`${logicRun}; DeckProd`) as {
  prodView(data: unknown): View | null
  slideSlots(view: View | null, slide: string): Slot[]
  swapPatch(view: View | null, slot: string, key: string, by: string, at: string): Record<string, unknown> | null
}
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))
type Fx = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const fixture = (name: string) => parseYaml(readFileSync(new URL(`example/states/${name}.yaml`, dir), 'utf8')) as Fx

const K = (n: number) => `size_01KB${String(n).padStart(22, '0')}`
const MASTER = 'fset_01KB0000000000000000000002#master'
const hostile = '<img src=x onerror=alert(1)>'

function production(sid: string, over: Fx = {}): Fx {
  return {
    card: 'Production: 2 picked, 1 not reachable',
    source: { kind: 'clan', name: 'lumen.clan' },
    picks: [
      { slot: `${sid}.picture`, key: MASTER, label: 'Key visual · campaign-launch v2', role: 'key_visual', from: 'embedded', by: 'rule', rights: 'generated', status: 'ready',
        eligible: [{ key: MASTER, label: 'Key visual · campaign-launch v2', role: 'key_visual', reach: 'embedded', rights: 'generated', status: 'ready', aspect: '1920:1080' },
                   { key: 'fset_01KB0000000000000000000001#master', label: 'Key visual · social v2', role: 'key_visual', reach: 'https', rights: 'reference_only', status: 'ready' }] },
      { slot: 's99.picture', key: K(2), label: 'uk-6-sheet · 2:3', role: 'size', from: 'not reachable', by: 'rule', rights: 'generated', status: 'ready',
        eligible: [{ key: K(2), label: 'uk-6-sheet · 2:3', role: 'size', reach: 'https', rights: 'generated', status: 'ready' },
                   { key: K(7), label: 'lumen-bus-panel · 4:5', role: 'size', reach: 'zip', rights: 'generated', status: 'ready' }] },
    ],
    not_reachable: [{ slot: 's99.picture', key: K(2), reason: 'not reachable — re-save or export in Production: https (example.invalid): not fetched' }],
    fetch: { on: false, allow_list_empty: true }, tie_break: { on: false }, look: { on: false },
    ...over,
  }
}

// ---------------------------------------------------------------------------- the pure block

test('no production, no panel; junk never throws', () => {
  assert.equal(P.prodView({}), null)
  assert.equal(P.prodView(null), null)
  for (const junk of [{ picks: 'x' }, { picks: [null, 1, { slot: 'nope', key: 'x' }, { slot: 's01.picture' }] }, { fetch: 3, look: 'y' }]) {
    const v = P.prodView({ production: junk })!
    assert.deepEqual(plain(v.slots), [])
  }
})

test('tiles carry a reach badge (embedded, https, zip, not reachable) and a rights badge', () => {
  const v = P.prodView({ production: production('s01') })!
  const [kv, six] = v.slots
  assert.deepEqual(plain(kv.chosen.reach), ['ok', 'Embedded'])
  assert.deepEqual(plain(kv.chosen.rights), ['ok', 'Made in Production'])
  assert.deepEqual(plain(kv.candidates[0].reach), ['plain', 'https link'])
  assert.deepEqual(plain(kv.candidates[0].rights), ['warn', 'Rights to supply'])
  assert.equal(kv.candidates[0].placeable, false)
  assert.deepEqual(plain(six.chosen.reach), ['warn', 'Not reachable'])
  assert.deepEqual(plain(six.candidates[0].reach), ['ok', 'Export zip'])
  assert.equal(six.notReachable, true)
  const fetched = P.prodView({ production: production('s01', { picks: [{ ...production('s01').picks[0], from: 'https' }] }) })!
  assert.deepEqual(plain(fetched.slots[0].chosen.reach), ['ok', 'Fetched link'])
  for (const r of ['idb_only', 's3_only', 'none']) {
    const p = production('s01')
    p.picks[0].eligible[1].reach = r
    assert.deepEqual(plain(P.prodView({ production: p })!.slots[0].candidates[0].reach), ['warn', 'Not reachable'], r)
  }
})

test('fetch and the vision check are opt-in, and an empty allow-list is said plainly', () => {
  const off = P.prodView({ production: production('s01') })!
  assert.match(off.fetchLine, /off \(opt-in\)/)
  assert.match(off.fetchLine, /allow-list is empty/)
  assert.match(off.lookLine, /off \(opt-in\).*never place or remove/)
  const onEmpty = P.prodView({ production: production('s01', { fetch: { on: true, allow_list_empty: true, refused: 'fetch refused' } }) })!
  assert.match(onEmpty.fetchLine, /no provider host is on the fetch allow-list.*production_fetch\.yaml/)
  const onHosts = P.prodView({ production: production('s01', { fetch: { on: true, allow_list_empty: false }, look: { on: true } }) })!
  assert.match(onHosts.fetchLine, /only the picked pictures, only from the allowed hosts/)
  assert.match(onHosts.lookLine, /only flags/)
})

test('a swap is a review.production patch, only to one of the slot\'s own candidates', () => {
  const v = P.prodView({ production: production('s01') })
  assert.deepEqual(plain(P.swapPatch(v, 's99.picture', K(7), 'You', 't')), { review: { production: { s99: { picture: { key: K(7), by: 'You', at: 't' } } } } })
  assert.equal(P.swapPatch(v, 's99.picture', K(9), 'You', 't'), null)     // not a candidate
  assert.equal(P.swapPatch(v, 's99.picture', K(2), 'You', 't'), null)     // the pick itself is not a swap
  assert.equal(P.swapPatch(v, 's98.picture', K(7), 'You', 't'), null)     // no such slot
  assert.equal(P.swapPatch(null, 's99.picture', K(7), 'You', 't'), null)
})

test('a recorded swap that the last build has not used yet shows as pending', () => {
  const v = P.prodView({ production: production('s01'), review: { production: { s99: { picture: { key: K(7), by: 'You', at: 't' } } } } })!
  assert.equal(v.slots[1].pending, K(7))
  assert.equal(P.slideSlots(v, 's99').length, 1)
  assert.equal(P.slideSlots(v, 's42').length, 0)
})

// ---------------------------------------------------------------------------- the panel on Review

function mount(data: Fx) {
  const writes: { obj: Fx; action: string }[] = []
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  const app = { innerHTML: '' }
  const toastEl = { textContent: '', classList: { add() {}, remove() {} }, _t: 0 }
  const els: Record<string, unknown> = { app, toast: toastEl }
  const doc = { getElementById: (id: string) => els[id] ?? null, addEventListener: (t: string, f: (e: unknown) => void) => { (handlers[t] ||= []).push(f) }, title: '' }
  const win = { __CLAN__: { data }, clan: { patchData: (obj: Fx, o: { action: string }) => { writes.push({ obj, action: o.action }); return Promise.resolve() } }, addEventListener() {} }
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop()!
  const ctx = vm.createContext({ window: win, document: doc, navigator: { userAgent: 'Mac' }, fetch: undefined, Promise, setTimeout, clearTimeout, Date })
  vm.runInContext(logicRun, ctx)
  vm.runInContext(src, ctx)
  const click = (attrs: Record<string, string>) => handlers.click.forEach(h => h({ target: { closest: () => ({ dataset: attrs, id: '' }) } }))
  return { app, writes, click, toastEl }
}

test('the Review aside shows the slide\'s Production tiles, their badges and a swap per candidate', () => {
  const f = fixture('review-ready')
  const sid = f.deck.order[0] as string
  f.production = production(sid)
  const m = mount(f)
  m.click({ slide: sid })
  const h = m.app.innerHTML
  assert.ok(h.includes('data-prod-panel'))
  assert.ok(h.includes('Production: 2 picked, 1 not reachable'))
  assert.equal((h.match(/data-prod-tile=/g) || []).length, 2)
  assert.ok(h.includes('<span class="chip ok">Embedded</span>') && h.includes('<span class="chip warn">Rights to supply</span>'))
  assert.equal((h.match(/data-prod-swap="/g) || []).length, 1)
  assert.ok(h.includes('data-prod-fetch>Fetching links is off (opt-in)'))
  m.click({ prodSwap: `${sid}.picture`, prodKey: 'fset_01KB0000000000000000000001#master' })
  assert.equal(m.writes.length, 1)
  assert.equal(m.writes[0].action, `swap production picture ${sid}.picture`)
  assert.deepEqual(plain(Object.keys(m.writes[0].obj)), ['review'])
  assert.equal(m.writes[0].obj.review.production[sid].picture.key, 'fset_01KB0000000000000000000001#master')
  m.click({ prodSwap: `${sid}.picture`, prodKey: K(9) })
  assert.equal(m.writes.length, 1, 'a key that is not a candidate writes nothing')
  assert.match(m.toastEl.textContent, /not a candidate/)
})

test('without production the Review aside is unchanged, and every word the engine wrote is escaped', () => {
  const f = fixture('review-ready')
  const sid = f.deck.order[0] as string
  const m = mount(f)
  m.click({ slide: sid })
  assert.ok(!m.app.innerHTML.includes('data-prod-panel'))
  const g = fixture('review-ready')
  g.production = production(sid, { card: hostile })
  g.production.picks[0].label = hostile
  g.production.picks[0].eligible[1].label = hostile
  const n = mount(g)
  n.click({ slide: sid })
  assert.equal(n.app.innerHTML.includes('<img'), false)
  assert.ok(n.app.innerHTML.includes('&lt;img'))
})

// ---------------------------------------------------------------------------- the schema

test('schema: production and review.production check what the engine and the app write', () => {
  assert.deepEqual(validate({ production: production('s01'), review: { production: { s99: { picture: { key: K(7), by: 'You', at: 't' } } } } }, schema), [])
  const bad = (o: unknown) => validate(o, schema).length > 0
  assert.ok(bad({ review: { production: { slide1: { picture: { key: K(7), by: 'You', at: 't' } } } } }))
  assert.ok(bad({ review: { production: { s01: { picture: { key: K(7) } } } } }))
  assert.ok(bad({ production: { picks: [{ slot: 's01.picture', key: K(1), from: 'somewhere', by: 'rule' }] } }))
  assert.ok(bad({ production: { picks: [{ slot: 's01.picture', key: K(1), from: 'zip', by: 'gemini' }] } }))
  assert.ok(bad({ production: { fetch: { on: 'yes' } } }))
  assert.ok(bad({ production: { location: 'https://example.invalid/out/x.png' } }))   // never a location
})
