// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Territories pictures (territories-pictures-rights): the slot's label, rights chip, Final pill and rights menu, and the Booth card when a Final
// has no rights. The words must be engine/territory/pictures.py's. Writes are requests (steps set_final, set_rights), never document writes.

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
  const t = d.territories.find((x: Doc) => x.id === 't_started')
  const [a, b, c, e] = t.pictures
  Object.assign(a, { kind: 'frame', image: 'sha256:' + H(1), sha256: H(1), rights: 'generated', final: true, source: 'Production: Hollow Oak' }); delete a.scene
  Object.assign(b, { kind: 'frame', image: 'sha256:' + H(2), sha256: H(2), rights: 'unknown' }); delete b.scene
  Object.assign(c, { kind: 'frame', image: 'sha256:' + H(3), sha256: H(3), rights: 'licensed' }); delete c.scene
  Object.assign(e, { kind: 'gap', gap_reason: 'The same picture was already placed on this route; this place needs its own.' }); delete e.scene
  return d
}
const route = (d: Doc) => d.territories.find((x: Doc) => x.id === 't_started')

test('every picture shows its label, hash and rights in the engine\'s words; unknown reads Rights to supply', () => {
  const v = P.view(route(doc())) as Doc[]
  assert.equal(v[0].rights_word, 'Generated'); assert.equal(v[0].trusted, true); assert.equal(v[0].label, 'Illustrative'); assert.equal(v[0].hash, H(1).slice(0, 8)); assert.equal(v[0].final, true)
  assert.equal(v[1].rights_word, 'Rights to supply'); assert.equal(v[1].trusted, false)
  assert.equal(v[2].rights_word, 'Licensed')
  assert.equal(v[3].kind, 'gap'); assert.equal(v[3].label, null); assert.match(v[3].gap_reason, /needs its own/)
  assert.equal(v[4].kind, 'sketch'); assert.equal(v[4].label, 'Mock-up'); assert.equal(v[4].rights_word, null)
  for (const w of ['mock', 'client_supplied', 'reference_only', '', undefined, 'supplied']) assert.equal(P.rightsWord(w), 'Rights to supply')
  eq(P.CHOICES.map((c: Doc) => c.rights), ['generated', 'own', 'licensed', 'unknown'])
})

test('the route panel draws the Final pill once, the chips, the hash, the gap reason and a Final button on pictures only', () => {
  const d = doc(), h = P.panel(route(d), {}) as string
  assert.equal((h.match(/class="pfinal"/g) || []).length, 1)
  assert.equal((h.match(/class="pchip /g) || []).length, 3)
  assert.match(h, /Rights to supply/); assert.match(h, new RegExp(H(2).slice(0, 8))); assert.match(h, /needs its own/)
  assert.equal((h.match(/data-pic-final=/g) || []).length, 3, 'a sketch and a gap have no Final button')
  assert.equal((h.match(/Mock-up/g) || []).length, 4)
  assert.doesNotMatch(plain(h), /sha256|undefined|null|\[object/)
})

test('the World view and the route window carry the panel; the gallery card carries a strip', () => {
  const d = doc(), t = route(d)
  assert.match(W.worldBody(d, {}, t), /class="ppanel"/)
  assert.match(W.worldBody(d, { wview: 'wall' }, t), /class="ppanel"/)
  assert.match(L.dialogFor('route:t_started', d).html, /class="ppanel"/)
  const strip = plain(P.strip(t))
  assert.match(strip, /3 pictures/); assert.match(strip, /1 Final/); assert.match(strip, /1 Rights to supply/)
  assert.equal(P.strip(d.territories.find((x: Doc) => x.id === 't_sunday')), '', 'sketches only: no strip')
})

test('Final and rights are requests with the step names, never writes; Final is held to pictures; nothing is asked twice', () => {
  const d = doc()
  const fin = L.act(d, {}, { a: 'pic_final', tid: 't_started', id: route(d).pictures[1].id }, ENV)
  eq(fin.writes, [])
  eq(fin.request.input, { step: 'set_final', territory_id: 't_started', picture_id: route(d).pictures[1].id, on: true, by: 'Shrey' })
  const off = L.act(d, {}, { a: 'pic_final', tid: 't_started', id: route(d).pictures[0].id }, ENV)
  assert.equal(off.request.input.on, false, 'a toggle on a Final takes it off')
  assert.equal(L.act(d, {}, { a: 'pic_final', tid: 't_started', id: route(d).pictures[0].id, on: false }, ENV).request.input.on, false)
  const r = L.act(d, {}, { a: 'pic_rights', tid: 't_started', id: route(d).pictures[1].id, rights: 'own' }, ENV)
  eq(r.request.input, { step: 'set_rights', territory_id: 't_started', picture_id: route(d).pictures[1].id, rights: 'own', by: 'Shrey' })
  eq(L.act(d, {}, { a: 'pic_rights', tid: 't_started', id: route(d).pictures[1].id, rights: 'unknown' }, ENV).writes, [], 'no change, no call')
  assert.equal(L.act(d, {}, { a: 'pic_rights', tid: 't_started', id: route(d).pictures[1].id, rights: 'mock' }, ENV), null)
  assert.equal(L.act(d, {}, { a: 'pic_final', tid: 't_started', id: route(d).pictures[4].id }, ENV), null, 'a sketch is never Final')
  assert.equal(L.act(d, {}, { a: 'pic_final', tid: 't_started', id: 'pic_nope' }, ENV), null)
  assert.match(L.act(d, { req: { key: 'gl:t_x', state: 'running' } }, { a: 'pic_final', tid: 't_started', id: route(d).pictures[1].id }, ENV).toast, /still going through/)
})

test('the rights menu lists the four choices with the current one checked, and only for a picture', () => {
  const d = doc(), id = route(d).pictures[1].id, dlg = L.dialogFor('rights:t_started:' + id, d)
  assert.equal(dlg.title, 'Whose picture is this?')
  const labels = [...dlg.html.matchAll(/<b>([^<]+)<\/b>/g)].map((m: RegExpMatchArray) => m[1])
  eq(labels, ['Generated', 'Own', 'Licensed', 'Rights to supply'])
  assert.match(dlg.html, /aria-checked="true" class="prow on" data-pic-set="unknown"/)
  assert.match(dlg.html, /Nobody has said yet/)
  assert.equal(L.dialogFor('rights:t_started:' + route(d).pictures[4].id, d), null)
})

test('the Booth card for a Final with no rights offers Choose rights and Take it off Final, and Send reads Send N →', () => {
  const d = doc(); route(d).pictures[0].rights = 'unknown'
  d.run.gate = { id: 'greenlight', blocked_by: [{ kind: 'picture_rights', ids: ['t_started'], text: 'Already Started has a Final picture with no rights chosen. Say whose it is, or take it off Final.' }] }
  const b = L.greenlightBooth(d, {}) as string
  assert.match(b, /class="bc ask"/); assert.match(plain(b), /Final picture with no rights chosen/); assert.match(plain(b), /Choose rights/); assert.match(plain(b), /Take it off Final/)
  assert.match(b, /data-pic-rights="t_started\|pic_/); assert.match(b, /data-pic-off="1"/)
  assert.match(b, /data-send disabled>Send →<\/button>/, 'held while a Final has no rights')
  assert.doesNotMatch(b, /to production →/)
})

test('a picture is drawn by its link and falls back to the palette; no schema field is invented', () => {
  const d = doc(), h = P.panel(route(d), {}) as string
  assert.match(h, new RegExp(`<img src="clan://localhost/assets/${H(1)}"`))
  const schema = json('schema.json'), props = Object.keys(schema.definitions.picture.properties)
  for (const k of ['final', 'source', 'sha256', 'image', 'rights', 'gap_reason', 'kind']) assert.ok(props.includes(k), k)
  eq(schema.definitions.rights.enum, ['generated', 'own', 'licensed', 'unknown'])
})
