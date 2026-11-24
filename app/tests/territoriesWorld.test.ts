// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Territories World view (territories-app-world; stills 16 to 18): a developed route opened as a campaign world. Both pure blocks of the
// page run together, on the contract's own fixture. What is checked: the copy follows the dials from the world block alone, a dial move makes
// no call and writes nothing, the person's writes are valid against schema.json, a request waits for a yes, and no rule is broken on the page
// (two faces, no prices, rank only).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { validate, type Schema } from './schemaCheck'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/territories/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const logicSrc = /<script id="territories-logic">([\s\S]*?)<\/script>/.exec(html)?.[1]
const worldSrc = /<script id="territories-world-logic">([\s\S]*?)<\/script>/.exec(html)?.[1]
assert.ok(logicSrc && worldSrc, 'the template has both pure blocks')

const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const helper = /<script>([\s\S]*?var NapkinSource[\s\S]*?)<\/script>/.exec(readFileSync(new URL('templates/shared/source-card.html', root), 'utf8'))![1]

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Ui = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Act = { writes: { patch: Doc; action: string; rationale: string }[]; toast?: string; clearDial?: string; move?: { what: string; input: Doc }; request?: { key: string; what: string; input: Doc } } | null
type Dial = { tone: number; energy: number; register: number; brand: number }
const both = vm.runInNewContext(`${engine}${helper}\n${logicSrc};\n${worldSrc}; ({ L: TerritoriesLogic, W: TerritoriesWorld })`) as { L: unknown; W: unknown }
const W = both.W as {
  order(d: Doc): Doc[]
  route(d: Doc, id: string): Doc | null
  dialOf(t: Doc, ui: Ui): Dial
  savedDial(t: Doc): Dial
  naturalDial(t: Doc): Dial
  feel(t: Doc, dial: Dial): Doc
  linesOf(t: Doc): string[]
  journeyOf(d: Doc): { key: string; day: string; where: string }[]
  worldBody(d: Doc, ui: Ui, t: Doc): string
  refresh(d: Doc, ui: Ui, t: Doc): { style: string; cls: string; body: string }
  sheet(d: Doc, ui: Ui, t: Doc): string
  booth(d: Doc, ui: Ui, open: boolean, t: Doc): string
  dock(d: Doc, ui: Ui): string
  animFrames(d: Doc, ui: Ui, t: Doc): { html: string; ms: number }[]
  animHtml(d: Doc, ui: Ui, t: Doc, i: number): string
  presentHtml(d: Doc, ui: Ui, i: number, react?: Doc): string
  speech(d: Doc, ui: Ui, t: Doc): { text: string; rate: number; pitch: number }
  dialog(what: string, d: Doc): { title: string; html: string } | null
  act(d: Doc, ui: Ui, e: Record<string, unknown>, env?: Doc): Act
  handles(a: string): boolean
  clean(v: unknown): string
  worldPatch(d: Doc, id: string, change: Doc): Doc | null
}
const L = both.L as {
  view(d: Doc, ui?: Ui): string
  act(d: Doc, ui: Ui, e: Record<string, unknown>, env?: Doc): Act
  dialogFor(w: string, d: Doc): { title: string; html: string } | null
}
const eq = (a: unknown, b: unknown, m?: string) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m)
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc
const text = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const ENV = { me: { name: 'Shrey' }, now: '2026-11-23T10:00:00Z' }
const doc = (): Doc => json('example/states/greenlight_open.json')

function deref(schema: Doc): Schema {
  const defs = schema.definitions as Doc
  const walk = (n: unknown, depth = 0): unknown => {
    if (Array.isArray(n)) return n.map(x => walk(x, depth))
    if (n && typeof n === 'object') {
      const o = n as Doc
      if (typeof o.$ref === 'string') { assert.ok(depth < 12); return walk(defs[o.$ref.split('/').pop()!], depth + 1) }
      const out: Doc = {}
      for (const [k, v] of Object.entries(o)) if (k !== 'allOf' && k !== 'definitions' && k !== '$schema') out[k] = walk(v, depth)
      return out
    }
    return n
  }
  return walk(schema) as Schema
}
const schema = deref(json('schema.json'))
const merge = (d: Doc, patch: Doc): Doc => ({ ...JSON.parse(JSON.stringify(d)), ...JSON.parse(JSON.stringify(patch)) })
// What the middleware does with a world choice (server/napkin/territories/moves.py), applied here so the page's later screens can be read from it.
const landed = (d: Doc, m: { input: Doc }): Doc => {
  const i = m.input, t = routeOf(d, i.territory_id as string), w = t.world
  const change: Doc = i.step === 'set_lead' ? { lead: i.line } : i.step === 'keep_feel' ? { dial_set: i.dial_set }
    : { starred: i.on ? [...(w.starred ?? []), i.line] : (w.starred ?? []).filter((x: string) => x !== i.line) }
  return merge(d, W.worldPatch(d, i.territory_id as string, change)!)
}
const apply = (d: Doc, a: Act): Doc => { assert.ok(a); return a.move ? landed(d, a.move) : a.writes.reduce((x, w) => merge(x, w.patch), d) }
const routeOf = (d: Doc, id = 't_started') => W.route(d, id)!

test('the routes walk in the gallery order, and a route that is not developed has no world', () => {
  const d = doc(), ids = W.order(d).map(t => t.id)
  assert.equal(ids.length, 8)
  assert.ok(!ids.includes('t_breakfast') && !ids.includes('t_anon'), 'found and killed routes have none')
  assert.equal(W.route(d, 't_anon'), null); assert.equal(W.route(d, 'nope'), null)
  eq(W.order({}), [])
})

test('the dials pick the copy corner and the layout from the world block alone (stills 16 and 17)', () => {
  const d = doc(), t = routeOf(d), h = t.world.headlines
  const corner = (tone: number, energy: number) => text(W.worldBody(d, { wmore: true, dials: { [t.id]: { ...W.naturalDial(t), tone, energy } } }, t))
  assert.match(corner(10, 10), new RegExp(h.wq.replace(/[.]/g, '\\.')))
  assert.match(corner(10, 90), new RegExp(h.wl.slice(0, 20)))
  assert.match(corner(90, 10), new RegExp(h.sq.slice(0, 20)))
  assert.match(corner(90, 90), new RegExp(h.sl.slice(0, 20)))
  const lay = (energy: number) => W.worldBody(d, { wmore: true, dials: { [t.id]: { ...W.naturalDial(t), energy } } }, t)
  assert.match(lay(10), /lay-quiet/); assert.match(lay(50), /lay-mid/); assert.match(lay(90), /lay-loud/)
  const reg = (register: number) => W.worldBody(d, { wview: 'wall', dials: { [t.id]: { ...W.naturalDial(t), register } } }, t)
  assert.match(reg(80), /class="frames cine"/); assert.doesNotMatch(reg(20), /class="frames cine"/)
  const br = (brand: number) => W.worldBody(d, { wmore: true, dials: { [t.id]: { ...W.naturalDial(t), brand } } }, t)
  assert.match(br(10), /bm-sm/); assert.match(br(50), /bm-md/); assert.match(br(90), /bm-lg/)
})

test('moving a dial writes nothing and makes no call: it is view state (LESSONS 18, the plan)', () => {
  const d = doc(), t = routeOf(d), ui: Ui = { dials: {} }
  const before = JSON.stringify(d)
  ui.dials[t.id] = { ...W.naturalDial(t), tone: 5 }
  const r = W.refresh(d, ui, t)
  assert.ok(r.body.includes('class="journey') && r.style.includes('--t-bg'))
  assert.equal(JSON.stringify(d), before, 'the document is the same')
  assert.equal(W.handles('dial'), false, 'there is no dial event to write or send')
  eq(W.dialOf(t, ui), { ...W.naturalDial(t), tone: 5 })
  eq(W.dialOf(t, {}), W.naturalDial(t))
  assert.match(text(W.booth(d, ui, true, t)), /Nothing is sent/)
})

test('Keep this feel writes dial_set (valid), Back to its natural feel clears it, and the kept feel is where the next visit starts', () => {
  const d = doc(), t = routeOf(d), ui: Ui = { dials: { [t.id]: { ...W.naturalDial(t), tone: 5, energy: 95 } } }
  const k = W.act(d, ui, { a: 'keep', id: t.id }, ENV)!
  eq(k.writes, []); assert.equal(k.clearDial, t.id); assert.equal(k.move!.input.step, 'keep_feel'); eq(k.move!.input.dial_set, { ...W.naturalDial(t), tone: 5, energy: 95 }); assert.equal(k.move!.input.by, 'Shrey')
  const d2 = apply(d, k); eq(validate(d2, schema), [])
  eq(routeOf(d2).world.dial_set, { ...W.naturalDial(t), tone: 5, energy: 95 }); eq(routeOf(d2).world.dial, t.world.dial, 'the natural feel stays')
  eq(W.dialOf(routeOf(d2), {}), { ...W.naturalDial(t), tone: 5, energy: 95 })
  assert.match(W.worldBody(d2, { wmore: true }, routeOf(d2)), /lay-loud/)
  assert.match(W.act(d2, {}, { a: 'keep', id: t.id }, ENV)!.toast!, /already the feel/, 'nothing to keep when nothing moved')
  const r = W.act(d2, {}, { a: 'dreset', id: t.id }, ENV)!, d3 = apply(d2, r)
  assert.ok(!('dial_set' in routeOf(d3).world)); eq(validate(d3, schema), []); eq(W.dialOf(routeOf(d3), {}), W.naturalDial(t))
  eq(W.act(d, {}, { a: 'dreset', id: t.id }, ENV)!.writes, [], 'no kept feel: the page just lets go of the moves')
})

test('the lead line overrides the dials on every touchpoint; Let the dials choose gives them back', () => {
  const d = doc(), t = routeOf(d), line = t.world.lines[1]
  const a = W.act(d, {}, { a: 'lead', id: t.id, line }, ENV)!, d2 = apply(d, a)
  assert.equal(routeOf(d2).world.lead, line); eq(validate(d2, schema), [])
  for (const tone of [5, 95]) for (const energy of [5, 95]) {
    const body = text(W.worldBody(d2, { dials: { [t.id]: { ...W.naturalDial(t), tone, energy } } }, routeOf(d2)))
    assert.ok(body.includes(line.slice(0, 18)), `the lead shows at ${tone}/${energy}`)
    for (const k of ['wq', 'wl', 'sq', 'sl']) assert.ok(!body.includes(t.world.headlines[k]) || t.world.headlines[k] === line, 'no corner overrides it')
  }
  assert.match(W.booth(d2, { wtab: 'lines' }, true, routeOf(d2)), /data-w-unlead/)
  const d3 = apply(d2, W.act(d2, {}, { a: 'unlead', id: t.id }, ENV)!)
  assert.ok(!('lead' in routeOf(d3).world)); assert.doesNotMatch(W.booth(d3, { wtab: 'lines' }, true, routeOf(d3)), /data-w-unlead/)
  assert.ok(!('lead' in routeOf(apply(d2, W.act(d2, {}, { a: 'lead', id: t.id, line }, ENV)!)).world), 'pressing the led line again lets it go')
  assert.match(W.act(d, {}, { a: 'unlead', id: t.id }, ENV)!.toast!, /already choose/)
  assert.equal(W.act(d, {}, { a: 'lead', id: t.id, line: 'a line that is not in this world' }, ENV), null)
})

test('stars are kept on the route (valid), at most sixteen, and More like the starred waits for a star and then for a yes', () => {
  const d = doc(), t = routeOf(d), line = t.world.lines[0]
  assert.match(W.act(d, {}, { a: 'more', id: t.id }, ENV)!.toast!, /Star a line/, 'no star: it says what to do, makes no request')
  const d2 = apply(d, W.act(d, {}, { a: 'star', id: t.id, line }, ENV)!)
  eq(routeOf(d2).world.starred, [line]); eq(validate(d2, schema), [])
  const dlg = W.dialog(`more:${t.id}`, d2)!
  assert.match(text(dlg.html), /one model call, so nothing happens until you say go/); assert.match(dlg.html, /data-w-go="more:t_started"/)
  const r = W.act(d2, {}, { a: 'more', id: t.id }, ENV)!
  eq(r.request, { key: 'more:t_started', what: 'More lines', input: { step: 'more', territory_id: 't_started', by: 'Shrey' } }); eq(r.writes, [])
  assert.match(W.act(d2, { req: { state: 'running' } }, { a: 'more', id: t.id }, ENV)!.toast!, /still going through/)
  eq(routeOf(apply(d2, W.act(d2, {}, { a: 'star', id: t.id, line }, ENV)!)).world.starred, [], 'a second press takes the star off')
  const full = merge(d2, { territories: d2.territories.map((x: Doc) => x.id === t.id ? { ...x, world: { ...x.world, starred: Array.from({ length: 16 }, (_, i) => `line ${i}`) } } : x) })
  assert.match(W.act(full, {}, { a: 'star', id: t.id, line }, ENV)!.toast!, /Sixteen/)
})

test('Push it asks first (three calls) and sends the instruction; both requests fail in words until the handlers are there', () => {
  const d = doc(), t = routeOf(d)
  for (const k of ['Braver', 'Safer', 'More ownable', 'More proof']) {
    const dlg = W.dialog(`push:${t.id}:${k}`, d)!
    assert.match(text(dlg.html), /three model calls, so nothing happens until you say go/); assert.ok(dlg.title.includes(k.toLowerCase()))
    const r = W.act(d, {}, { a: 'push', id: t.id, kind: k }, ENV)!
    assert.equal(r.request!.input.step, 'push'); assert.equal(r.request!.input.territory_id, t.id); assert.ok(r.request!.input.instruction.length <= 200); eq(r.writes, [])
  }
  assert.equal(W.dialog('push:t_started:Wilder', d), null); assert.equal(W.dialog('more:nope', d), null)
  // the page words a failed request, in the Why tab
  const failed = { key: 'push:t_started', state: 'failed', error: 'The push did not go through. Nothing changed.' }
  assert.match(text(W.booth(d, { wtab: 'why', req: failed }, true, t)), /The push did not go through/)
  assert.match(text(W.booth(d, { wtab: 'lines', req: failed }, true, t)), /Write more like the starred/)
})

test('the journey is the weekend\'s six stops from the document, each drawn by one template from the world block', () => {
  const d = doc(), t = routeOf(d), j = W.journeyOf(d)
  eq(j.map(s => s.key), ['tv', 'story', 'poster', 'radio', 'seat', 'email'])
  const body = W.worldBody(d, { wmore: true }, t)
  assert.equal((body.match(/class="jstep jmom j-/g) ?? []).length, 6)
  // the page shows the first two moments and names the rest, with Show the whole weekend (the mock); wmore shows all six
  const two = W.worldBody(d, {}, t)
  assert.equal((two.match(/class="jstep jmom j-/g) ?? []).length, 2)
  assert.match(text(two), /4 more moments: Poster, Radio, Table card, Email\./); assert.match(two, /data-wmore>Show the whole weekend/)
  for (const s of j) assert.ok(text(body).includes(s.day) && text(body).includes(s.where))
  // the journey is one row a moment (the mock, live test T5): day and place, its line, a small sketch; the full drawings are the Wall's
  assert.equal((body.match(/class="jstep jmom j-/g) ?? []).length, 6); assert.doesNotMatch(body, /class="fr"/)
  const wall = W.worldBody(d, { wview: 'wall' }, t)
  assert.equal((wall.match(/class="fr"/g) ?? []).length, t.world.tv.length)
  for (const r of t.world.radio.filter((x: Doc) => x.voice !== 'SFX')) assert.ok(text(wall).includes(r.text.slice(0, 20)))
  eq(W.journeyOf({}).length, 6, 'a document with none gets the six stops')
  const odd = { ...d, journey: [{ key: 'tv', day: 'Mon', where: 'x' }, { key: 'billboard', day: 'Tue', where: 'y' }] }
  eq(W.journeyOf(odd).map(s => s.key), ['tv'], 'an unknown touchpoint is left out')
  // no per-route markup: a different route comes out of the same templates
  for (const id of ['t_passenger', 'small'.replace('small', 't_small')]) assert.equal((W.worldBody(d, { wmore: true }, routeOf(d, id)).match(/class="jstep jmom j-/g) ?? []).length, 6)
})

test('the wall shows all six touchpoints at once, and the page toggles between the two views', () => {
  const d = doc(), t = routeOf(d), wall = W.worldBody(d, { wview: 'wall' }, t)
  for (const k of ['poster', 'story', 'seat', 'email', 'radio', 'tv']) assert.match(wall, new RegExp(`class="wcell w-${k}"`))
  assert.doesNotMatch(wall, /class="journey"/)
  assert.match(W.sheet(d, { wview: 'wall' }, t), /data-wv="wall" aria-pressed="true"/); assert.match(W.sheet(d, {}, t), /data-wv="journey" aria-pressed="true"/)
  assert.match(W.dock(d, { wview: 'wall' }), /data-wdock="wall" aria-pressed="true"/); assert.match(W.dock(d, {}), /data-wdock="wall" aria-pressed="false"/)
  for (const w of ['present', 'anim', 'wall']) assert.match(W.dock(d, {}), new RegExp(`data-wdock="${w}"`))
})

test('the animatic plays the TV frames with captions, then the supered line; speed follows the energy; reading aloud skips the sound effects', () => {
  const d = doc(), t = routeOf(d), fr = W.animFrames(d, {}, t)
  assert.equal(fr.length, t.world.tv.length)
  assert.match(fr[0].html, /class="sub"/); assert.match(fr[fr.length - 1].html, /class="super big"/)
  assert.match(text(fr[fr.length - 1].html), /The weekend starts when you sit down/); assert.doesNotMatch(text(fr[fr.length - 1].html), /Super:/)
  const slow = W.animFrames(d, { dials: { [t.id]: { ...W.naturalDial(t), energy: 0 } } }, t)[0].ms, fast = W.animFrames(d, { dials: { [t.id]: { ...W.naturalDial(t), energy: 100 } } }, t)[0].ms
  assert.ok(slow > fast && fast > 1000)
  assert.match(W.animHtml(d, {}, t, 0), /frame 1 of 4/); assert.match(W.animHtml(d, {}, t, 99), /frame 4 of 4/)
  assert.match(W.animHtml(d, {}, t, 0), /data-a-prev disabled/)
  const sp = W.speech(d, {}, t)
  assert.ok(!/station ambience|doors close/i.test(sp.text), 'the SFX lines are written, not spoken'); assert.match(sp.text, /Aoife/)
  assert.ok(sp.pitch === 0.95 && sp.rate > 0.85, 'sincere and quiet')
  assert.equal(W.speech(d, { dials: { [t.id]: { ...W.naturalDial(t), tone: 10 } } }, t).pitch, 1.1)
  assert.doesNotMatch(L.view(d, { world: t.id, speech: false }), /data-speak/); assert.match(L.view(d, { world: t.id, speech: true }), /data-speak="[^"]+">▶ Read it aloud/)
  assert.equal(W.animHtml(d, {}, { ...t, world: { ...t.world, tv: [] } }, 0), '')
})

test('Present shows one route at a time with no score, tier, rank or source, and a note that reactions are not saved', () => {
  const d = doc(), n = W.order(d).length, p = W.presentHtml(d, {}, 0, { t_started: 'Lean in' })
  assert.match(text(p), new RegExp(`route A of ${n}`)); assert.match(text(p), /scores and sources hidden/); assert.match(p, /data-p-react="Lean in" aria-pressed="true"/)
  assert.match(text(p), /not saved/); assert.ok(!/Judge|rank|tier|blind|f_[A-Z0-9]{6}|fi_[A-Z0-9]{6}/i.test(text(p)))
  assert.match(W.presentHtml(d, {}, n - 1), /Finish/); assert.match(W.presentHtml(d, {}, 0), /data-p-nav="-1" disabled/)
  assert.equal(W.presentHtml({}, {}, 0), '')
  assert.match(L.act(d, {}, { a: 'present' }, ENV)!.present === 0 ? 'ok' : 'no', /ok/)
})

test('the page: a route opens from the gallery as a world, with its own palette, panel, dock and a way back; nothing else changes', () => {
  const d = doc(), ui: Ui = { world: 't_started' }, page = L.view(d, ui)
  assert.match(page, /id="wsheet"/); assert.match(page, /--t-bg:#F4B942/); assert.match(page, /data-wdock="anim">▶ Play animatic/); assert.match(page, /data-dock="export">Export…/); assert.match(page, /data-w-back/)
  assert.doesNotMatch(page, /class="rrow/); assert.doesNotMatch(page, /data-dock="compare"/)
  assert.match(text(page), /1 of 8/); assert.match(page, /data-green="t_started"/)
  const gallery = L.view(d, {}); assert.match(gallery, /class="rrow/); assert.doesNotMatch(gallery, /id="wsheet"/)
  assert.doesNotMatch(L.view(d, { world: 't_anon' }), /id="wsheet"/, 'a route with no world falls back to the gallery')
  assert.doesNotMatch(L.view(d, { world: 't_started', view: 1 }), /id="wsheet"/, 'only step 3 draws it')
  for (const tab of ['feel', 'lines', 'why', 'test']) assert.match(L.view(d, { world: 't_started', wtab: tab }), new RegExp(`data-wtab="${tab}" aria-pressed="true"`))
})

test('rules on the page: the two faces only, no prices, rank only (never tier, score or the blind total), no leaked text', () => {
  const d = doc()
  for (const id of W.order(d).map(t => t.id)) for (const ui of [{ world: id }, { world: id, wview: 'wall' }, { world: id, wtab: 'lines' }, { world: id, wtab: 'why' }, { world: id, wtab: 'test' }]) {
    const page = L.view(d, ui), t = text(page)
    assert.ok(!/(€|\$|£)\s?\d|\b(usd|eur)\b|\bcost\b|\bprice\b|\bspend\b/i.test(t), `no price text: ${id}`)
    assert.ok(!/\btier\b|\/\s?35|\bblind\b[^.]*\d{2}|score/i.test(t.replace(/blind judge/gi, '')), `rank only: ${id}`)
    assert.ok(!/\(to confirm\)|\bTBC\b|\{\{|\*\*|~~|\bundefined\b|\[object|\bnull\b/.test(t), `no leaked text: ${id}`)
  }
  const fonts = new Set([...html.matchAll(/font(?:-family)?:[^;{}]*?(?:var\(--font-(?:ui|serif)\)|"Geist"|"Newsreader"|-apple-system|Georgia|serif)/g)].map(m => m[0]))
  assert.ok(fonts.size > 0)
  assert.ok(!/font-family:[^;}]*(Courier|Inter|Fraunces|Helvetica Neue"?,\s*Arial)/i.test(html.replace(/--font-(ui|mono):[^;]*;/g, '')), 'only Brief\'s faces (Newsreader, Geist, Geist Mono)')
  assert.ok(!/<form/.test(L.view(d, { world: 't_started' })))
})

test('text that must never reach a person is not drawn', () => {
  const d = doc(), t = JSON.parse(JSON.stringify(routeOf(d)))
  t.world.lines[0] = 'Tea **on** the train (to confirm)'; t.world.headlines.wq = '{{headline}}'; t.world.social = 'TBC'; t.world.tv[0].text = '~~gone~~'
  const bad = merge(d, { territories: d.territories.map((x: Doc) => x.id === t.id ? t : x) })
  const page = text(L.view(bad, { world: t.id, wtab: 'lines' }))
  assert.ok(!/\*\*|\(to confirm\)|\{\{|TBC|~~/.test(page))
  assert.equal(W.clean('null'), ''); assert.equal(W.clean('  fine  '), 'fine')
})

test('the contract\'s requests have the engine\'s step names, and every write the page makes is valid against schema.json', () => {
  const d = doc(), t = routeOf(d), line = t.world.lines[2]
  for (const e of [{ a: 'lead', line }, { a: 'star', line }, { a: 'keep' }, { a: 'dreset' }]) {
    const ui: Ui = e.a === 'keep' ? { dials: { [t.id]: { ...W.naturalDial(t), brand: 99 } } } : {}
    const base = e.a === 'dreset' ? landed(d, { input: { step: 'keep_feel', territory_id: t.id, dial_set: W.naturalDial(t) } }) : d
    const r = W.act(base, ui, { ...e, id: t.id }, ENV)!
    eq(r.writes, [], `${e.a} writes no array: it is a move`)
    assert.ok(r.move && ['set_lead', 'star_line', 'keep_feel'].includes(r.move.input.step as string) && r.move.input.territory_id === t.id && r.move.what, `${e.a} is a move`)
    eq(validate(landed(base, r.move!), schema), [], `${e.a} lands valid`)
  }
  assert.equal(W.act(d, {}, { a: 'lead', id: 'nope', line }, ENV), null)
})
