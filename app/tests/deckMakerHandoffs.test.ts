// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// deck-handoffs in the Deck Maker app: a gate request carries the person's words (edit, retry, own idea) and goes to the
// engine on the next build; what the engine did comes back in run.human; the tissue session's reactions are written to the
// document and the pitch builds from them. Invented data only (the Ballymaloe state fixtures).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { parseYaml } from './deckMakerYaml'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const html = readFileSync(new URL('templates/deck-maker/index.html', root), 'utf8')
const logicSrc = /<script id="deck-logic">([\s\S]*?)<\/script>/.exec(html)?.[1]
assert.ok(logicSrc)
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const logicRun = engine + logicSrc

type Rec = Record<string, unknown>
type Fx = Rec & { run: Rec & { gate: Rec & { territories?: Rec[]; idea?: Rec }; gate_requests?: Rec[]; human?: Rec } }
type Req = { id?: string; gate: string; kind: string; by?: string; at: string; status: string; edits?: Rec; note?: string; own?: Rec }
const L = vm.runInNewContext(`${logicRun}; DeckLogic`) as {
  gateRequest(run: unknown, gate: string, kind: string, by: string, at: string, extra?: unknown): { decisions: Rec[]; gate_requests: Req[] } | null
  gateView(run: unknown, pick?: unknown): (Rec & { asked: string[]; handled: { id: string; status: string; message: string }[]; human: string[]; tissue: boolean; picked_by: string; territories: (Rec & { own: boolean })[]; idea: (Rec & { sentence: string }) | null }) | null
  editFields(gv: unknown): { key: string; label: string; value: string }[]
  changedEdits(fields: unknown, typed: unknown): Rec | null
  reactionsPatch(routes: unknown, offered: unknown, by: string, at: string): { tissue: { reactions: { by: string; at: string; routes: Rec } } } | null
  parseReactions(text: string): { routes: Rec | null; why: string }
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v))
const fixture = (name: string) => parseYaml(readFileSync(new URL(`templates/deck-maker/example/states/${name}.yaml`, root), 'utf8')) as Fx
const at = '2026-11-20T10:00:00Z'

test('a gate request with words carries an id, who and the words; without them it is the old record', () => {
  const r = fixture('gate1').run
  const q = L.gateRequest(r, 'storyline', 'edit', 'You', at, { id: 'gr_1', edits: { proposition: ' Your tap has a story. ', insight: '  ' } })!
  assert.deepEqual(plain(q.gate_requests.at(-1)), { id: 'gr_1', gate: 'storyline', kind: 'edit', by: 'You', at, status: 'waiting', edits: { proposition: 'Your tap has a story.' } })
  assert.deepEqual(plain(q.decisions.at(-1)), { gate: 'storyline', kind: 'edit', by: 'You', at })
  assert.deepEqual(plain(L.gateRequest(r, 'storyline', 'edit', 'You', at)!.gate_requests.at(-1)), { gate: 'storyline', kind: 'edit', at, status: 'waiting' })
  assert.equal(L.gateRequest(r, 'storyline', 'edit', 'You', at, { id: 'gr_1', edits: { proposition: ' ' } }), null, 'an edit with no words')
  assert.equal(L.gateRequest(r, 'storyline', 'edit', 'You', at, { id: 'bad id', edits: { proposition: 'x' } }), null)
  assert.equal(L.gateRequest(r, 'storyline', 'own', 'You', at, { id: 'gr_2', own: { line: 'x', idea: 'y' } }), null, 'your own idea goes in at gates 2 and 3')
  const retry = L.gateRequest(r, 'storyline', 'retry', 'You', at, { id: 'gr_3', note: ' sharper ' })!
  assert.equal(retry.gate_requests.at(-1)!.note, 'sharper')
})

test('your own route at gate 2 and your own idea at gate 3 need their words', () => {
  const g2 = fixture('gate2').run, g3 = fixture('gate3').run
  const own2 = L.gateRequest(g2, 'territories', 'own', 'You', at, { id: 'gr_1', own: { name: 'Kettle Off', thought: 'Summer starts here.', extra: 'dropped' } })!
  assert.deepEqual(plain(own2.gate_requests.at(-1)!.own), { name: 'Kettle Off', thought: 'Summer starts here.' })
  assert.equal(L.gateRequest(g2, 'territories', 'own', 'You', at, { id: 'gr_1', own: { name: 'Kettle Off' } }), null)
  assert.equal(L.gateRequest(g3, 'idea', 'own', 'You', at, { id: 'gr_1', own: { line: 'L' } }), null)
  assert.equal(L.gateRequest(g3, 'idea', 'own', 'You', at, { id: 'gr_1', own: { line: 'L', idea: 'I' } })!.gate_requests.at(-1)!.kind, 'own')
  assert.equal(L.gateRequest(g3, 'idea', 'own', 'You', at), null, 'no record-only own idea')
})

test('editFields offers the words a gate may change with what they say now, and only changed words are sent', () => {
  const v2 = L.gateView(fixture('gate2').run)!
  const f2 = L.editFields(v2)
  assert.deepEqual(plain(f2.slice(0, 3).map(f => f.key)), ['territory.t1.name', 'territory.t1.thought', 'territory.t1.why'])
  assert.equal(f2[0].value, 'The one small thing')
  assert.deepEqual(plain(L.changedEdits(f2, { 'territory.t1.name': 'The one small thing', 'territory.t2.name': 'Tried and loved' })), { 'territory.t2.name': 'Tried and loved' })
  assert.equal(L.changedEdits(f2, {}), null)
  const f3 = L.editFields(L.gateView(fixture('gate3').run)!)
  assert.deepEqual(plain(f3.map(f => [f.key, f.value])), [['line', 'Tuesday\'s tea, but you tried.'], ['idea', '']])
  assert.deepEqual(plain(L.editFields(L.gateView(fixture('gate1').run)!).map(f => f.key)), ['proposition', 'insight'])
})

test('what the engine did comes back in run.human: the request is no longer waiting, and the gate says what happened', () => {
  const f = fixture('gate1')
  f.run.gate_requests = [{ id: 'gr_1', gate: 'storyline', kind: 'edit', at, status: 'waiting', edits: { proposition: 'x' } }]
  assert.deepEqual(plain(L.gateView(f.run)!.asked), ['edit'])
  f.run.human = { edits: [], requests: { gr_1: { status: 'done', message: 'changed the proposition', gate: 'storyline', kind: 'edit' } } }
  f.run.gate = { ...f.run.gate, human: ['proposition'] }
  const v = L.gateView(f.run)!
  assert.deepEqual(plain([v.asked, v.handled, v.human]), [[], [{ id: 'gr_1', kind: 'edit', status: 'done', message: 'changed the proposition' }], ['proposition']])
})

test('gate 2 marks your own route and who picked; gate 3 carries the idea sentence; a tissue gate says so', () => {
  const f = fixture('gate2')
  f.run.gate = { ...f.run.gate, tissue: true, picked: 't2', picked_by: 'the client at the tissue session', territories: [...(f.run.gate.territories || []), { id: 't_own_1', name: 'Kettle Off', origin: 'human' }] }
  const v = L.gateView(f.run)!
  assert.deepEqual(plain([v.tissue, v.picked_by, v.territories.at(-1)!.own, v.territories[0].own]), [true, 'the client at the tissue session', true, false])
  const g3 = fixture('gate3')
  g3.run.gate = { ...g3.run.gate, idea: { ...g3.run.gate.idea, sentence: 'Each home tries something new.' } }
  assert.equal(L.gateView(g3.run)!.idea!.sentence, 'Each home tries something new.')
})

test('the client\'s reactions are written as tissue.reactions, only for routes offered, and pasted JSON is checked', () => {
  const offered = [{ id: 't1' }, { id: 't2' }]
  const p = L.reactionsPatch({ t1: { verdict: 'love', comments: ' warmer ' }, t2: { verdict: null, comments: '' }, t9: { verdict: 'like' } }, offered, 'You', at)!
  assert.deepEqual(plain(p), { tissue: { reactions: { by: 'You', at, routes: { t1: { verdict: 'love', comments: 'warmer' } } } } })
  assert.equal(L.reactionsPatch({ t1: { verdict: 'meh' } }, offered, 'You', at), null)
  assert.deepEqual(plain(L.parseReactions('{"routes":{"t1":{"verdict":"like","comments":"ok"}}}').routes), { t1: { verdict: 'like', comments: 'ok' } })
  assert.match(L.parseReactions('nope').why, /not JSON/)
  assert.match(L.parseReactions('{"routes":{"t1":{"verdict":"meh"}}}').why, /love, like or not_for_us/)
})

// ── the page: with a middleware, Edit opens a panel and Send writes one request and asks for build_deck ──
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)) }
const middleware = (configured: boolean) => (url: string) =>
  Promise.resolve(String(url).endsWith('/middleware') ? { ok: true, json: () => Promise.resolve({ configured }) } : { ok: false, json: () => Promise.resolve(null) })

function mount(data: Rec, fetchImpl: unknown, els: Rec = {}) {
  const writes: { obj: Rec; action: string }[] = []
  const calls: { task: string; input: Rec }[] = []
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  const app = { innerHTML: '' }
  const toastEl = { textContent: '', classList: { add() {}, remove() {} }, _t: 0 }
  const all: Rec = { app, toast: toastEl, ...els }
  const doc = { getElementById: (id: string) => all[id] ?? null, addEventListener: (t: string, f: (e: unknown) => void) => { (handlers[t] ||= []).push(f) }, title: '' }
  const win = {
    __CLAN__: { data },
    clan: { patchData: (obj: Rec, o: { action: string }) => { writes.push({ obj: plain(obj), action: o.action }); return Promise.resolve() },
            apiProxy: (_k: string, p: { task: string; input: Rec }) => { calls.push(plain({ task: p.task, input: p.input })); return Promise.resolve({ ok: true, status: 200, data: { api: 'napkin.middleware/1', job: { id: 'job_1', state: 'done' }, change: null } }) } },
    addEventListener() {},
  }
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop()!
  const ctx = vm.createContext({ window: win, document: doc, navigator: { userAgent: 'Mac' }, fetch: fetchImpl, Promise, setTimeout: () => 0, clearTimeout: () => {}, Date })
  vm.runInContext(logicRun, ctx)
  vm.runInContext(src, ctx)
  const click = (attrs: Record<string, string>, id = '') => handlers.click.forEach(h => h({ target: { closest: () => ({ dataset: attrs, id }) } }))
  return { app, writes, calls, click, toastEl }
}

test('with a middleware, Edit opens a panel; Send writes the request with the changed words and asks for the next build', async () => {
  const m = mount(fixture('gate3'), middleware(true), { ge_0: { value: 'Tea that tries.' }, ge_1: { value: '' } })
  await settle()
  m.click({ edit: 'idea' })
  assert.ok(m.app.innerHTML.includes('data-gpanel="edit"') && m.app.innerHTML.includes('Bring your own idea instead'))
  assert.equal(m.writes.length, 0, 'opening the panel writes nothing')
  m.click({ gsend: 'edit' })
  await settle()
  assert.deepEqual(m.writes.map(w => w.action), ['edit idea'])
  const q = (m.writes[0].obj.run as { gate_requests: Req[] }).gate_requests.at(-1)!
  assert.deepEqual(plain([q.kind, q.edits, q.status, typeof q.id]), ['edit', { line: 'Tea that tries.' }, 'waiting', 'string'])
  assert.deepEqual(m.calls.map(c => c.task), ['build_deck'])
})

test('with a middleware, your own route is sent from the panel; without a middleware Edit stays a record', async () => {
  const m = mount(fixture('gate2'), middleware(true), { go_name: { value: 'Kettle Off' }, go_thought: { value: 'Summer starts when the kettle goes off.' }, go_why: { value: '' } })
  await settle()
  m.click({ gmode: 'own' })
  assert.ok(m.app.innerHTML.includes('data-gpanel="own"') && m.app.innerHTML.includes('Add my route'))
  m.click({ gsend: 'own' })
  await settle()
  const q = (m.writes[0].obj.run as { gate_requests: Req[] }).gate_requests.at(-1)!
  assert.deepEqual(plain([m.writes[0].action, q.own]), ['own territories', { name: 'Kettle Off', thought: 'Summer starts when the kettle goes off.' }])
  const off = mount(fixture('gate2'), middleware(false))
  await settle()
  off.click({ edit: 'territories' })
  assert.deepEqual(off.writes.map(w => w.action), ['edit territories'], 'the old record, nothing sent')
  assert.equal(off.calls.length, 0)
})

test('a tissue gate shows the reactions; Build the pitch writes the reactions and the pitch format, then builds', async () => {
  const f = fixture('gate2')
  f.run.gate = { ...f.run.gate, tissue: true }
  const m = mount(f, middleware(true), { rc_t1: { value: 'more of this' }, rc_t2: { value: '' }, rc_t3: { value: '' }, rjson: { value: '' } })
  await settle()
  assert.ok(m.app.innerHTML.includes('data-reactions') && m.app.innerHTML.includes('data-verdict="not_for_us"'))
  m.click({ react: 't1', verdict: 'love' })
  m.click({ rsave: 'build' })
  await settle()
  assert.deepEqual(m.writes.map(w => w.action), ['record tissue reactions'])
  assert.deepEqual(plain(m.writes[0].obj), { tissue: { reactions: { by: 'You', at: (m.writes[0].obj.tissue as { reactions: { at: string } }).reactions.at, routes: { t1: { verdict: 'love', comments: 'more of this' } } } }, inputs: { format: 'pitch' } })
  assert.deepEqual(m.calls.map(c => c.task), ['build_deck'])
})
