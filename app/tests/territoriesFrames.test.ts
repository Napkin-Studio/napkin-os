// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Territories Make pictures (territories-pictures-frames): the button on the route's Pictures line, the confirm (count from the engine's card,
// or its refusal and no Make), a held picture and its Needs you window. Every move is a request to the engine's steps; no price is shown anywhere.

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
const both = vm.runInNewContext(`${engine}${helper}\n${block('territories-logic')};\n${block('territories-world-logic')};\n${block('territories-pictures-logic')}; ({ L: TerritoriesLogic, W: TerritoriesWorld, P: TerritoriesPictures })`) as { L: Doc; W: Doc; P: Doc }
const { L, W, P } = both
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc
const plain = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const H = (n: number) => String(n).repeat(64).slice(0, 64)
const eq = (a: unknown, b: unknown, m?: string) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m)
const ENV = { me: { name: 'Shrey' } }


function doc(): Doc {
  const d = json('example/states/greenlight_open.json')
  d.greenlit = ['t_started', 't_sunday'].map(id => ({ territory_id: id, by: 'Shrey', at: '2026-11-23T10:00:00Z', rests_on_derived: [], derived_resolution: 'verified' }))
  return d
}
const route = (d: Doc, id = 't_started') => d.territories.find((x: Doc) => x.id === id)
const WHY = 'It has the word FERNCLIFF in it.'
const frames = (held: boolean) => ({ held: [{ key: 't_started-abc123-f3-tv', route: 't_started', place: 'pic_started_tv3', sha256: H(3), why: WHY }].filter(() => held) })
const PRICE = /\$|€|£|usd|eur|price|cost|credit|cap\b/i

test('the button is on the Pictures line of a greenlit developed route with sketches, and nowhere else', () => {
  const d = doc(), t = route(d)
  const on = W.worldBody(d, {}, t) as string
  // territories-redesign (owner decision 7): while every place is a sketch the pictures are one line, with Make pictures on it
  assert.match(on, /<section class="pline" aria-label="Pictures"><span class="psec-t">Pictures · 8 places · sketches, marked Mock-up<\/span><span class="spacer"><\/span><button type="button" class="btn-rect pic-make" data-pic-make="t_started">Make pictures<\/button>/)
  assert.doesNotMatch(on, /class="pgrid"/, 'no grid of eight sketches before the journey')
  // pictures off in this workspace (frames_status says so): Make pictures is off, with why beside it, before anyone presses it (live test T6)
  const off = W.worldBody(d, { picsOff: true }, t) as string
  assert.match(off, /<button type="button" class="btn-rect pic-make" disabled>Make pictures<\/button><span class="why lock">Pictures are not switched on in this workspace\.<\/span>/)
  const ungreen = W.worldBody(d, {}, route(d, 't_small')) as string
  assert.doesNotMatch(ungreen, /Make pictures/, 'small is developed but not greenlit')
  assert.doesNotMatch(L.dialogFor('route:t_started', d).html, /Make pictures/, 'the route window has no button')
  const made = doc(); Object.assign(route(made).pictures[0], { kind: 'frame', sha256: H(1), image: 'sha256:' + H(1), rights: 'generated' })
  assert.doesNotMatch(W.worldBody(made, {}, route(made)), /Make pictures/, 'already made')
  assert.doesNotMatch(W.worldBody(d, { frames: frames(true) }, t), /Make pictures/, 'a picture is waiting for a person')
  const dev = doc(); route(dev).state = 'sketched'
  assert.doesNotMatch(W.worldBody(dev, {}, route(dev)), /Make pictures/)
})

test('the confirm says the count from the card; a refusal is one line and has no Make; neither shows a price', () => {
  const d = doc()
  const ok = P.makeDialog('make:t_started', d, { mk: { tid: 't_started', state: 'ready', card: { id: 'c_1', frames: 4, usd: 9.5, price: 12 } } })
  assert.equal(ok.title, 'Make 4 pictures for Already Started?')
  eq([...ok.html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m: RegExpMatchArray) => m[1]), ['Cancel', 'Make'])
  assert.match(ok.html, /Illustrative, made by an outside picture tool\./)
  assert.doesNotMatch(plain(ok.title + ok.html), PRICE)
  assert.equal(P.makeDialog('make:t_started', d, { mk: { tid: 't_started', state: 'ready', card: { id: 'c_1', frames: 1 } } }).title, 'Make 1 picture for Already Started?')
  const no = P.makeDialog('make:t_started', d, { mk: { tid: 't_started', state: 'refused', refused: 'Say whether the material is invented, a demo or the client\'s.' } })
  assert.match(no.html, /Say whether the material is invented/); assert.doesNotMatch(no.html, /data-pic-go|>Make</)
  eq([...no.html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m: RegExpMatchArray) => m[1]), ['Close'])
  assert.equal(P.makeDialog('make:t_started', d, {}), null)
})

test('Make sends the card id of the card that was shown, by name; asking is never a click on Make', () => {
  const d = doc(), ui = { mk: { tid: 't_started', state: 'ready', card: { id: 'c_77', frames: 4 } } }
  const r = L.act(d, ui, { a: 'pic_go', tid: 't_started' }, ENV)
  eq(r.writes, []); eq(r.request.input, { step: 'frames', ids: ['t_started'], card_id: 'c_77', by: 'Shrey' })
  assert.equal(L.act(d, {}, { a: 'pic_go', tid: 't_started' }, ENV), null, 'no card, no make')
  assert.match(L.act(d, { ...ui, req: { key: 'gl:x', state: 'running' } }, { a: 'pic_go', tid: 't_started' }, ENV).toast, /still going through/)
})

test('a held picture is drawn dimmed in the next open place, with Needs you and no rights chip or Final button', () => {
  const d = doc(), t = route(d)
  Object.assign(t.pictures[0], { kind: 'frame', sha256: H(1), image: 'sha256:' + H(1), rights: 'generated' })
  const h = P.panel(t, { frames: frames(true) }, { green: true }) as string
  assert.equal((h.match(/class="pslot held"/g) || []).length, 1)
  assert.match(h, /data-pslot="pic_started_tv3"/)
  const slot = /<figure class="pslot held" data-pslot="pic_started_tv3">[\s\S]*?<\/figure>/.exec(h)![0]
  assert.match(slot, new RegExp(`/assets/${H(3)}`)); assert.match(slot, />Needs you<\/button>/); assert.match(slot, /Illustrative/)
  assert.doesNotMatch(slot, /data-pic-rights|data-pic-final|Generated/)
  assert.doesNotMatch(h, /Make pictures/)
  assert.doesNotMatch(P.panel(t, { frames: { held: [{ ...frames(true).held[0], place: 'pic_started_tv1' }] } }, {}), /pslot held/, 'a place that already holds a picture is not drawn over')
  assert.match(P.panel(t, { frames: { held: [{ ...frames(true).held[0], place: 'pic_started_tv4' }] } }, {}), /<figure class="pslot held" data-pslot="pic_started_tv4"/, 'the place the engine names, not the first open one')
  assert.doesNotMatch(P.panel(t, { frames: { held: [] } }, {}), /pslot held/, 'left out or approved: the status no longer lists it')
})

test('Needs you shows the held picture above the engine\'s reason; Approve calls frames_approve, Leave it out calls frames_leave', () => {
  const d = doc(), ui = { frames: frames(true) }
  const dlg = P.makeDialog('held:t_started:t_started-abc123-f3-tv', d, ui)
  assert.equal(dlg.title, 'Needs you')
  assert.ok(dlg.html.indexOf('<img') < dlg.html.indexOf(WHY), 'the picture comes first')
  assert.match(dlg.html, new RegExp(`<img class="pic-thumb" src="clan://localhost/assets/${H(3)}"`))
  eq([...dlg.html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m: RegExpMatchArray) => m[1]), ['Leave it out', 'Approve'])
  assert.doesNotMatch(plain(dlg.html), PRICE)
  const r = L.act(d, ui, { a: 'pic_ok', tid: 't_started', id: 't_started-abc123-f3-tv' }, ENV)
  eq(r.request.input, { step: 'frames_approve', keys: ['t_started-abc123-f3-tv'], by: 'Shrey' })
  assert.equal(r.request.after, 'frames')
  const lv = L.act(d, ui, { a: 'pic_leave', tid: 't_started', id: 't_started-abc123-f3-tv' }, ENV)
  eq(lv.writes, []); eq(lv.request.input, { step: 'frames_leave', keys: ['t_started-abc123-f3-tv'], by: 'Shrey' })
  assert.equal(lv.request.after, 'frames', 'the status is read again, so a reload shows the same: it is the engine that remembers')
  assert.match(dlg.html, /data-pic-leave="t_started\|t_started-abc123-f3-tv"/)
  assert.equal(P.makeDialog('held:t_started:nope', d, ui), null)
})

test('frames_status becomes the page\'s held list and the places a picture cannot fill; held ones only', () => {
  const info = { frames: { frames: [{ key: 'a', route: 't_started', place: 'pic_started_tv1', sha256: H(1), held: false, why: null }, { key: 'b', route: 't_started', place: 'pic_started_tv3', sha256: H(3), held: true, why: WHY }], card: { not_offered: [{ touchpoint: 'story', why: 'x' }] } } }
  eq(P.framesFrom(info), { held: [{ key: 'b', route: 't_started', place: 'pic_started_tv3', sha256: H(3), why: WHY }] })
  assert.equal(P.framesFrom({ frames: { refused: 'no' } }), null)
  assert.equal(P.framesFrom(undefined), null)
})

test('the page asks, makes and approves only through the engine\'s steps and keeps no price in its words', () => {
  const src = html.slice(html.indexOf('id="territories-pictures-logic"'), html.indexOf('id="territories-exports-logic"'))
  const words = [...src.matchAll(/'([^'\n]{12,})'/g)].map((m: RegExpMatchArray) => m[1]).filter((w: string) => /^[A-Z]/.test(w))
  for (const w of words) assert.doesNotMatch(w, /\$|€|£|\busd\b|\bprice\b|credits?\b/i, w)
  assert.match(src, /ask: 'frames', approve: 'frames_approve', leave: 'frames_leave', status: 'frames_status'/)
})

test('the Make pictures ask says whose look the pictures wear, and a fresh document starts on the client default (Brand Clan phase 2 (d))', () => {
  const d = doc()
  const ask = (look?: Doc) => plain(P.makeDialog('make:t_started', d, { mk: { tid: 't_started', state: 'ready', card: { id: 'c_1', frames: 4, look } } }).html)
  // the client's Brand Clan the document holds: named with its version; its logo and type stay out; what a picture tool cannot take is said
  const bc = ask({ from: 'brand_clan', name: 'Original', version: 2, document_id: 'bc1', colours: 3, imagery: true, bans: 2, left_out: [{ what: 'the 2019 campaign', why: 'it holds a digit' }] })
  assert.match(bc, /Look Original v2, the client’s Brand Clan The pictures take its colours, its imagery style and what it bans\. Its logo and type stay out/)
  assert.match(bc, /Left out, as a picture tool cannot take them: the 2019 campaign\./)
  assert.doesNotMatch(bc, PRICE)
  // none: the built-in look, said plainly (the stand-in "brand notes" wording is gone)
  for (const none of [undefined, { from: 'default' }]) {
    const t = ask(none)
    assert.match(t, /Look The built-in look This document holds no Brand Clan for the client/); assert.doesNotMatch(t, /stand-in|brand notes/)
  }
  assert.match(ask({ from: 'brand_clan', name: 'Zero', version: 1, colours: 0, imagery: false, bans: 0 }), /It holds nothing for pictures yet, so they use the built-in look\./)

  // start on the client's default: only a fresh document that holds no Brand Clan, never a locked one or over one it holds
  const fresh = json('seed.json'), T = (o: Doc) => ({ app_id: 'ie.napkin.brand', document_id: 'bc1', title: 'Tidewell · Original', ...o })
  const targets = [T({ default: false, document_id: 'bc0' }), T({ default: true }), { app_id: 'ie.napkin.campaign-research', document_id: 'r1', default: true }]
  assert.equal(L.brandToStart(fresh, targets).document_id, 'bc1')
  assert.equal(L.brandToStart(fresh, [T({ default: true, attached: true })]), null, 'it holds one already')
  assert.equal(L.brandToStart(fresh, [T({ default: true, locked: true })]), null)
  assert.equal(L.brandToStart(fresh, [T({ default: false })]), null, 'no default: nothing is picked for the person')
  assert.equal(L.brandToStart({ ...fresh, upstream: { bc9: { kit: { version: 1 }, visual: { colours: [] } } } }, targets), null, 'carried down from the brief')
  assert.equal(L.brandToStart(d, targets), null, 'work under way keeps what it has')
})
