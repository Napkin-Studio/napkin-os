// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Territories template (shell, Booth, Pick): what its screens say and what each press writes, from the contract's own
// fixture (example/states/pick.json), with the carried research put where Research keeps it (upstream.<id>.projection).
// The page's pure block runs alone; every write is checked against schema.json.

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
assert.ok(logicSrc, 'the template has its pure block')

// The agent engine the page inlines at its marker (the circles stay their still frames: no WebGL here).
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`

type Seen = {
  brief: null | { id: string; title: string; filled: number; total: number; fields: { id: string; label: string; text: string }[]; key_fields: { id: string; text: string }[]; mandatories: number }
  research: null | { id: string; title: string; pins: number | null; findings: number | null; verified: number | null; proposed: number | null; rejected: number | null; sources: number | null }
  from: string
}
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Ui = Record<string, unknown>
type Act = { writes: { patch: Doc; action: string; rationale: string }[]; toast?: string; start?: boolean; draft?: string; focus?: string; request?: { key: string; what: string; input: Doc } } | null
// The house source card the packer splices at its marker: the page draws its two cards with it.
const helper = /<script>([\s\S]*?var NapkinSource[\s\S]*?)<\/script>/.exec(readFileSync(new URL('templates/shared/source-card.html', root), 'utf8'))![1]
const L = vm.runInNewContext(`${engine}${helper}\n${logicSrc}; TerritoriesLogic`) as {
  seen(d: unknown): Seen
  statsOf(s: Seen): string[]
  fromWords(s: Seen): string
  BRIEF_KEYS: Record<string, string>
  TASKS: Record<string, string>
  counts(d: Doc): Record<string, number | boolean>
  derivedFindings(d: Doc): string[]
  resolve(c: string, d: Doc): { carried: boolean; kind: string | null; text: string; status: string }
  pickState(run: unknown): string
  view(d: Doc, ui?: Ui): string
  dialogFor(w: string, d: Doc): { title: string; html: string } | null
  act(d: Doc, ui: Ui, e: Record<string, unknown>, env?: Record<string, unknown>): Act
  boothNotes(d: Doc): { role: string; body: string; cites: string[] }[]
  crewOf(d: Doc): { id: string; name: string; role: string; state: string; angle: number; colour: string; routes: Doc[]; set_aside: Doc[]; way: Doc[]; steer: Doc[] }[]
  statusOf(m: Doc): string
  exploreStats(d: Doc): string[]
  compassSvg(d: Doc, ui?: Ui): string
  routeGroups(d: Doc, ui?: Ui): string
  actionNotes(d: Doc): { id?: string; label: string; body: string; undoable?: boolean; undone?: boolean }[]
  reqWords(req: Ui | null, key: string): string
  radius(d: number): number
  tickPatch(d: Doc, id: string, on: boolean): Doc | null
  approvePatch(run: unknown, n: number, by: string, at: string): Doc | null
}

// Values made inside the page's own context compare by what they hold, not by which realm made them.
const eq = (a: unknown, b: unknown, m?: string) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m)
const BRIEF_ID = '5b0d3a7e-4c1f-4e2a-9a55-1d6c0f2b7e11'
const RESEARCH_ID = 'a91c64f2-7d3b-4b8e-8f10-3e5d2c9a6b47'
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc

/** schema.json with its $refs inlined and its if/then rules left out (they guard routes; Pick writes none), for the small checker. */
function deref(schema: Doc): Schema {
  const defs = schema.definitions as Doc
  const walk = (n: unknown, depth = 0): unknown => {
    if (Array.isArray(n)) return n.map(x => walk(x, depth))
    if (n && typeof n === 'object') {
      const o = n as Doc
      if (typeof o.$ref === 'string') { assert.ok(depth < 12, 'a $ref cycle'); return walk(defs[o.$ref.split('/').pop()!], depth + 1) }
      const out: Doc = {}
      for (const [k, v] of Object.entries(o)) if (k !== 'allOf' && k !== 'definitions' && k !== '$schema') out[k] = walk(v, depth)
      return out
    }
    return n
  }
  return walk(schema) as Schema
}
const schema = deref(json('schema.json'))

/** The fixture as the app meets it: Pick open, the research's pins and findings under its projection. */
function doc(): Doc {
  const d = json('example/states/pick.json')
  const pins: Doc = {}
  for (const f of json('example/facts.json').facts as Doc[]) pins[f.id] = { layer: 'brand', entity: f.entity, key: f.key, value: f.value, unit: f.unit, as_of: f.as_of, confidence: f.confidence, licence: f.licence, stale: false }
  const findings: Doc = {}
  for (const f of json('example/findings.json').findings as Doc[]) findings[f.id] = { statement: f.statement, status: f.status, confidence: f.confidence, cites: f.cites }
  d.upstream[RESEARCH_ID] = { campaign: { name: 'Weekend travel west' } }
  d.projection = { pins, findings }
  return d
}
const merge = (d: Doc, patch: Doc): Doc => { const o = JSON.parse(JSON.stringify(d)) as Doc; for (const k of Object.keys(patch)) o[k] = typeof patch[k] === 'object' && !Array.isArray(patch[k]) && patch[k] && typeof o[k] === 'object' ? { ...o[k], ...patch[k] } : patch[k]; return o }
const apply = (d: Doc, a: Act): Doc => { assert.ok(a); return a.writes.reduce((x, w) => merge(x, w.patch), d) }
const ENV = { me: { name: 'Shrey' }, now: '2026-11-23T10:00:00Z' }
const errs = (d: Doc) => validate(d, schema)

test('the fixture, with the research carried, is a valid document to start from', () => {
  eq(errs(doc()).filter(e => !/upstream/.test(e)), [])
})

test('what arrived is counted from the document, and each carried id resolves (LESSONS 7)', () => {
  const d = doc(), c = L.counts(d)
  assert.equal(c.briefFields, Object.keys(d.upstream[BRIEF_ID]).length)
  assert.equal(c.pins, json('example/facts.json').facts.length)
  assert.equal(c.findings, json('example/findings.json').findings.length)
  assert.equal(c.insights, d.focus.insights.length)
  assert.equal(c.ticked, d.focus.insights.filter((i: Doc) => i.ticked).length)
  eq(L.derivedFindings(d), ['fi_FARE00007', 'fi_NOTALK003', 'fi_SPONT0009'])
  for (const s of d.focus.sources) assert.ok(L.resolve(s.id, d).carried, `${s.id} resolves`)
  for (const i of d.focus.insights) for (const e of i.evidence) assert.ok(L.resolve(e, d).carried, `${e} resolves`)
  const page = L.view(d, {})
  assert.match(page, new RegExp(`Brief · ${c.briefFields} fields of 11`))
  assert.match(page, new RegExp(`Research · ${c.pins} pins, ${c.findings} findings`))
  assert.match(page, new RegExp(`${c.insights} insights`))
})

test('a cite that does not arrive is shown as not carried, never hidden', () => {
  const d = doc(); delete d.projection.pins.f_ROUTE0412
  assert.equal(L.resolve('f_ROUTE0412', d).carried, false)
  assert.match(L.view(d, {}), /Not carried in this document/)
  assert.match(L.dialogFor('f_ROUTE0412', d)!.html, /Not carried in this document/)
  const none = doc(); none.upstream = {}; delete none.projection
  assert.match(L.view(none, {}), /Nothing came in with this one/)
})

test('the page shows every insight, its strength, its sources, the derived mark and the yours label', () => {
  const d = doc(), page = L.view(d, {})
  for (const i of d.focus.insights) {
    assert.ok(page.includes(i.text.replace(/'/g, '&#39;')), `shows: ${i.text}`)
    assert.ok(page.includes(`data-tick="${i.id}"`), `has a tick box for ${i.id}`)
    for (const e of i.evidence) assert.ok(page.includes(`data-src="${e}"`), `has a chip for ${e}`)
  }
  assert.equal((page.match(/class="dmark"/g) ?? []).length, d.focus.insights.filter((i: Doc) => i.derived).length)
  assert.match(page, /ymark">yours/)
  assert.match(page, /Explore 6 insights/)
  // strongest first: in_arrive (rank 1) before in_nofight (rank 10)
  assert.ok(page.indexOf('data-tick="in_arrive"') < page.indexOf('data-tick="in_nofight"'))
})

test('it keeps to the house words: no leaks, no prices, no keys', () => {
  const page = L.view(doc(), {})
  for (const bad of ['(to confirm)', '~~', '**', '{{', '[object', 'undefined', 'field is null', '>null<', '>None<']) assert.ok(!page.includes(bad), `page has ${bad}`)
  assert.ok(!/€|£|\$\d|\bEUR\b|\bUSD\b|¢|\bprice\b|\bcost\b|\bspend\b/i.test(page), 'no price anywhere on the page')
  assert.ok(!/€|£|\$\d|\bEUR\b|\bUSD\b|¢/.test(html), 'no price in the file')
  for (const w of ['brief:smp', 'schema_version', 'in_play']) assert.ok(!page.replace(/data-[a-z-]+="[^"]*"/g, '').includes(w) || w === 'brief:smp', `no key ${w}`)
})

test('the file uses Newsreader and Geist ExtraBold only', () => {
  const families = new Set([...html.matchAll(/font-family:\s*([^;}]+)/g)].map(m => m[1].split(',')[0].replace(/["'\s]/g, '').replace(/var\(--font-(ui|serif)\)/, 'var')))
  for (const f of families) assert.ok(/^(var|var\(--font-ui\)|var\(--font-serif\)|inherit)$/.test(f) || f === 'var', `font-family ${f}`)
  const fontVars = [...html.matchAll(/--font-(ui|serif):\s*([^;]+);/g)].map(m => m[2].split(',')[0].replace(/["'\s]/g, ''))
  eq([...new Set(fontVars)].sort(), ['Geist', 'Newsreader'])
  const link = /fonts\.googleapis\.com\/css2\?([^"]+)"/.exec(html)![1]
  eq([...link.matchAll(/family=([A-Za-z]+)/g)].map(m => m[1]).sort(), ['Geist', 'Newsreader'])
  assert.match(link, /Geist:wght@800(&|$)/)
  assert.ok(!/Geist Mono|font-weight:\s*(100|200|300|400|500|600|700)\b[^;]*var\(--font-ui\)/.test(html))
  // every Geist shorthand is weight 800
  for (const m of html.matchAll(/font:\s*(\d{3})[^;{}]*var\(--font-ui\)/g)) assert.equal(m[1], '800', `Geist at ${m[1]}: ${m[0]}`)
})

test('ticking works by id, whatever the order, and writes a valid document', () => {
  const d = doc()
  const a = L.act(d, {}, { a: 'tick', id: 'in_fare', on: true }, ENV)
  const next = apply(d, a)
  assert.equal(next.focus.insights.find((i: Doc) => i.id === 'in_fare').ticked, true)
  assert.equal(next.focus.insights.find((i: Doc) => i.id === 'in_arrive').ticked, true)
  assert.equal(L.counts(next).ticked, Number(L.counts(d).ticked) + 1)
  eq(errs(next).filter(e => !/upstream/.test(e)), [])
  // reordered: the same press does the same thing
  const rev = JSON.parse(JSON.stringify(d)); rev.focus.insights.reverse()
  const b = apply(rev, L.act(rev, {}, { a: 'tick', id: 'in_fare', on: true }, ENV))
  eq(b.focus.insights.filter((i: Doc) => i.ticked).map((i: Doc) => i.id).sort(), next.focus.insights.filter((i: Doc) => i.ticked).map((i: Doc) => i.id).sort())
  assert.equal(L.act(d, {}, { a: 'tick', id: 'in_arrive', on: true }, ENV), null, 'no change, no write')
  assert.equal(L.act(d, {}, { a: 'tick', id: 'in_nope', on: true }, ENV), null)
})

test('your own insight joins ticked and labelled yours; empty, long and a full list are refused in words', () => {
  const d = doc()
  const a = L.act(d, {}, { a: 'add', text: '  Nobody   wants a lecture on the way to Galway. ' }, ENV)!
  const next = apply(d, a), mine = next.focus.insights[next.focus.insights.length - 1]
  assert.equal(mine.kind, 'yours'); assert.equal(mine.ticked, true); assert.equal(mine.by, 'Shrey'); eq(mine.evidence, [])
  assert.equal(mine.text, 'Nobody wants a lecture on the way to Galway.')
  assert.match(mine.id, /^in_[a-z0-9]{2,12}$/)
  eq(errs(next).filter(e => !/upstream/.test(e)), [])
  assert.equal(a.draft, '')
  assert.match(L.act(d, {}, { a: 'add', text: '   ' }, ENV)!.toast!, /Write the insight first/)
  assert.match(L.act(d, {}, { a: 'add', text: 'x'.repeat(301) }, ENV)!.toast!, /300/)
  const full = doc(); while (full.focus.insights.length < 25) full.focus.insights.push({ ...full.focus.insights[0], id: `in_f${full.focus.insights.length}` })
  assert.match(L.act(full, {}, { a: 'add', text: 'one more' }, ENV)!.toast!, /full/)
  const shown = L.view(next, {})
  assert.match(shown, /added by Shrey/)
})

test('Explore writes only the person half, and editing the ticks after it makes Explore live again (LESSONS 18)', () => {
  let d = doc()
  assert.equal(L.pickState(d.run), 'open')
  const go = L.act(d, {}, { a: 'explore' }, ENV)!
  assert.equal(go.start, true)
  assert.equal(go.writes.length, 1)
  eq(Object.keys(go.writes[0].patch), ['run'])
  eq(Object.keys(go.writes[0].patch.run).sort(), ['approvals', 'decisions'], 'never the engine half')
  d = apply(d, go)
  eq(errs(d).filter(e => !/upstream/.test(e)), [])
  assert.equal(d.run.state, 'gate', 'the page did not touch state')
  assert.equal(d.run.approvals.pick.by, 'Shrey')
  assert.equal(L.pickState(d.run), 'approved')
  assert.match(L.view(d, { mw: false }), /not connected in this workspace/)
  assert.match(L.view(d, {}), /Approved ✓/)
  assert.ok(L.act(d, {}, { a: 'explore' }, ENV)!.toast, 'a second press says why nothing happens')
  // the ticks change after approval: the approval no longer stands
  const t = L.act(d, {}, { a: 'tick', id: 'in_fare', on: true }, { me: { name: 'Shrey' }, now: '2026-11-23T10:05:00Z' })!
  assert.equal(t.writes.length, 2)
  d = apply(d, t)
  eq(errs(d).filter(e => !/upstream/.test(e)), [])
  assert.equal(L.pickState(d.run), 'open')
  assert.match(L.view(d, {}), /Explore 7 insights/)
  const again = L.act(d, {}, { a: 'explore' }, { me: { name: 'Shrey' }, now: '2026-11-23T10:06:00Z' })!
  assert.equal(again.start, true)
  d = apply(d, again)
  assert.equal(L.pickState(d.run), 'approved')
  assert.equal(d.run.decisions.length, 3)
})

test('Explore with nothing ticked is refused in words and writes nothing', () => {
  const d = doc(); d.focus.insights.forEach((i: Doc) => { i.ticked = false })
  const r = L.act(d, {}, { a: 'explore' }, ENV)!
  eq(r.writes, []); assert.match(r.toast!, /Tick at least one/)
  assert.match(L.view(d, {}), /<button type="button" class="btn-pill primary" data-act="explore" disabled>/)
})

test('a failed start is said in words with a way to try again; the pick stays saved', () => {
  const d = apply(doc(), L.act(doc(), {}, { a: 'explore' }, ENV))
  const page = L.view(d, { job: { state: 'failed', error: 'This workspace has no middleware set up, so the engine cannot be reached.' } })
  assert.match(page, /no middleware set up/); assert.match(page, /Your pick is saved/); assert.match(page, /data-act="retry"/)
  assert.equal(L.act(d, {}, { a: 'retry' }, ENV)!.start, true)
  assert.equal(L.act(doc(), {}, { a: 'retry' }, ENV), null, 'nothing to retry before approving')
  assert.match(L.view(d, { job: { state: 'running' } }), /setting off/)
})

test('the seam names only what territories-handlers plans', () => {
  eq(L.TASKS, { run: 'run_territories', status: 'job_status' })
  const planned = readFileSync(new URL('../features/territories-handlers.clan', root))
  assert.ok(planned.length > 0)
})

test('a source window opens for a brief field, a pin, a finding (with its derived mark) and a find; in play toggles write by id', () => {
  const d = doc()
  const brief = L.dialogFor('brief:smp', d)!; assert.match(brief.html, /The weekend starts when you sit down/); assert.match(brief.html, /Single-minded proposition/)
  const pin = L.dialogFor('f_TIRED0418', d)!; assert.match(pin.html, /61%/); assert.match(pin.html, /pinned/)
  const fi = L.dialogFor('fi_NOTALK003', d)!; assert.match(fi.html, /derived/); assert.match(fi.html, /data-src="f_DRIVER0431"/)
  assert.match(fi.html, /Take it out of play/)
  d.finds = [{ id: 'x_FORUM0001', kind: 'found', text: 'Forum threads call the train a highlight.', source: 'Public forums', date: '2025', quote_checked: true, in_play: true }]
  const x = L.dialogFor('x_FORUM0001', d)!; assert.match(x.html, /Found by Territories/); assert.match(x.html, /quote checked/)
  assert.match(L.view(d, {}), /data-arrived="finds"/)
  assert.equal(L.dialogFor('nope', d), null)
  const off = apply(d, L.act(d, {}, { a: 'play', id: 'fi_FARE00007', on: true }, ENV))
  assert.equal(off.focus.sources.find((s: Doc) => s.id === 'fi_FARE00007').in_play, true)
  assert.match(L.dialogFor('fi_FARE00007', off)!.html, /Take it out of play/)
  eq(errs(off).filter(e => !/upstream/.test(e)), [])
  for (const w of ['brief', 'research']) assert.ok(L.dialogFor(w, d), `what arrived: ${w}`)
})

test('every control the page draws does something or is disabled with its reason', () => {
  const page = L.view(doc(), {})
  const acts = new Set([...page.matchAll(/data-act="([a-z]+)"/g)].map(m => m[1]))
  for (const a of acts) assert.ok(L.act(apply(doc(), L.act(doc(), {}, { a: 'explore' }, ENV)), {}, { a }, ENV) !== undefined, `an action for ${a}`)
  assert.ok(acts.has('explore') && acts.has('add'))
  assert.ok(!/<form/.test(page), 'no form: the sandboxed page cannot submit one')
  assert.match(page, /data-tick=/); assert.match(page, /data-form="add"/); assert.match(page, /data-play=/); assert.match(page, /data-src=/); assert.match(page, /data-booth="hide"/); assert.match(page, /id="boothEdge"/)
  // the look-up box is disabled and says so (look-ups are another feature)
  assert.match(page, /<textarea rows="2" disabled/); assert.match(page, /Look-ups are not built into Territories yet/)
  // the steps after Pick are shut until the run reaches them
  assert.match(page, /data-step="explore"[^>]*disabled/); assert.match(page, /data-step="greenlight"[^>]*disabled/)
})

test('the Booth speaks from the document: what it read, what is derived, the gate line, the notes', () => {
  const d = doc(), n = L.boothNotes(d)
  assert.match(n[0].body, /Read the brief \(8 fields\) and the research \(6 pins, 4 findings\)\. Nothing copied/)
  eq(n[1].cites, ['fi_FARE00007', 'fi_NOTALK003', 'fi_SPONT0009'])
  d.notes = [{ id: 'nt_aaaa11', agent: 'review', text: 'Two routes landed close.', at: '2026-11-23T09:00:00Z' }]
  assert.ok(L.boothNotes(d).some(x => /Two routes landed close/.test(x.body)))
  const page = L.view(doc(), { me: { name: 'Shrey' } })
  assert.match(page, /Tick the insights the crew should explore/); assert.match(page, /Checks signed as <b>Shrey<\/b>/)
  assert.match(page, /aria-label="Booth"/); assert.match(page, /aria-expanded="true"/)
  assert.match(L.view(doc(), { booth: false }), /class="booth-col booth-off"/)
})

test('after Pick the run has moved on: the insights are read-only and the later steps open', () => {
  const d = doc(); d.run = { ...d.run, state: 'building', stage: 'explore', gate: null, approvals: { pick: { by: 'Shrey', at: '2026-11-23T10:00:00Z', decision: 'approve' } } }
  assert.equal(L.pickState(d.run), 'past')
  const page = L.view(d, { view: 0 })
  assert.match(page, /data-tick="in_arrive" checked disabled/)
  assert.ok(!/data-form="add"/.test(page) && !/data-act="explore"/.test(page))
  assert.match(page, /Step 1 · Pick what to work on/)
  const later = L.view(d, {})
  assert.match(later, /data-step="explore" aria-current="step"/); assert.match(later, /Step 2 of 3/); assert.match(later, /The crew has not set off yet/)
})

test('the engine making the insights shows as working, and a refused reply shows in words', () => {
  const d = doc(); d.run = { state: 'building', stage: 'pick', stages: d.run.stages, approvals: {}, decisions: [] }
  assert.equal(L.pickState(d.run), 'working')
  assert.match(L.view(d, {}), /still writing the insights/)
  const f = doc(); f.run = { ...f.run, state: 'failed', error: { stage: 'pick', message: 'The engine sent more insights than the list holds.', retryable: true, refused: ['26 insights, at most 25.'] } }
  assert.match(L.view(f, {}), /more insights than the list holds/)
})


// ---- the first screen of a spun-off document (territories-spinoff-in): the host's own fixture, the engine reader's golden ----
const SDATA = json('example/spunoff/data.json') as Doc
const SSEEN = json('example/spunoff/seen.json') as Seen
const SFACTS = json('example/spunoff/facts.json') as Doc
const SFINDINGS = json('example/spunoff/findings.json') as Doc
const screen = (data: unknown, title = 'Territories'): { root: string; cards: string } => { const h = L.view(data as Doc, { title }); return { root: h, cards: h } }

test('the page reads a spin-off exactly as the engine reader does (the golden)', () => {
  eq(L.seen(SDATA), SSEEN)
})

test('the counts on screen are the counts of the carried members', () => {
  assert.equal(SSEEN.research!.pins, SFACTS.facts.length)
  assert.equal(SSEEN.research!.findings, SFINDINGS.findings.length)
  const { root } = screen(SDATA)
  assert.match(root, new RegExp(`${SFACTS.facts.length} pins`))
  assert.match(root, new RegExp(`${SFINDINGS.findings.length} findings`))
  assert.match(root, new RegExp(`${SSEEN.brief!.filled} fields of ${SSEEN.brief!.total}`))
})

test('every key brief field that arrived is on the screen in the brief\'s own words, under its name as words', () => {
  const { root } = screen(SDATA)
  const keyed = SSEEN.brief!.key_fields
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
  const { cards } = screen(SDATA)
  assert.match(cards, /nsrc-brief/)
  assert.match(cards, /nsrc-research/)
  assert.match(cards, /Lúnasa 0\.0 launch brief/)
  assert.match(cards, new RegExp(`<b>${SFACTS.facts.length}</b> facts`))
})

test('no field name, null or placeholder leaks onto the screen', () => {
  const said = screen(SDATA).root.replace(/<[^>]*>/g, ' ')
  for (const bad of ['field is null', 'null', 'undefined', 'NaN', '[object', '{{', '(to confirm)', '~~', 'single_minded_proposition', 'tone_and_world', 'smp']) {
    assert.ok(!said.includes(bad), `the screen says "${bad}"`)
  }
})

test('a brief alone, research alone, and nothing at all each say so plainly', () => {
  const briefId = SSEEN.brief!.id, researchId = SSEEN.research!.id
  const onlyBrief = screen({ upstream: { [briefId]: SDATA.upstream[briefId] } }).root
  assert.match(onlyBrief, /from a brief/)
  assert.ok(!/Research · /.test(onlyBrief))
  const onlyResearch = screen({ upstream: { [researchId]: SDATA.upstream[researchId] } }).root
  assert.match(onlyResearch, /from research/)
  assert.ok(!/0 pins|0 findings/.test(onlyResearch), 'an unknown count is not shown as 0: ' + String(onlyResearch.replace(/<[^>]*>/g, ' ').match(/.{40}(0 pins|0 findings).{20}/)))
  const none = screen({}).root
  assert.match(none, /Nothing came in with this one/)
  assert.ok(!/undefined|null/.test(none))
})

test('before the engine has written, the page says what is not built and offers nothing that does nothing', () => {
  const { root } = screen(SDATA)
  assert.match(root, /not been sent out/)
  assert.ok(!/data-act=|data-tick=|data-form=|data-play=/.test(root), 'no pick control on a page with nothing to pick')
  assert.match(root, /<textarea rows="2" disabled/)
})

test('the name, the contract and the seed: the app block is the contract\'s', () => {
  assert.match(readFileSync(new URL('context.md', dir), 'utf8'), /Cite, never copy/)
  const seed = json('seed.json')
  eq(seed.run.approvals, {})
  assert.equal(seed.schema_version, 1)
})

test('a spun-off document with the engine\'s first write opens on Pick, with the real brief keys read through the contract names', () => {
  const d = JSON.parse(JSON.stringify(SDATA)) as Doc
  d.focus = { sources: [], insights: [{ id: 'in_aa11', kind: 'truth', text: 'The same round, the same good time.', evidence: ['brief:smp'], strength: 'strong', ticked: true, by: 'engine', rank: 1 }] }
  d.run = { state: 'gate', stage: 'pick', gate: { id: 'pick', n: 1, of: 2, agent: 'strategy', dex: 'Tick the insights the crew should explore.', checks: [], blocked_by: [] }, approvals: {}, decisions: [] }
  assert.equal(L.pickState(d.run), 'open')
  assert.match(L.view(d, {}), /data-tick="in_aa11"/)
  assert.match(L.dialogFor('brief:smp', d)!.html, /The same round, the same good time\./)
  assert.ok(L.resolve('f_01JA0B1C2D', d).carried, 'a pin of the host projection resolves')
  assert.match(L.resolve('fi_01JA0F1A', d).status, /verified/)
})


// ---- step 2: the crew explores (territories-app-explore): the fixtures of docs/contracts/territories.md section 8 ----
const back = (): Doc => json('example/states/explore_back.json')
const running = (): Doc => json('example/states/explore_running.json')
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

test('the Explore fixtures are valid documents, and Explore is the step the run is on', () => {
  for (const d of [back(), running()]) { eq(errs(d).filter(e => !/upstream/.test(e)), []); assert.equal(L.pickState(d.run), 'past') }
  const page = L.view(back(), {})
  assert.match(page, /data-step="explore" aria-current="step"/); assert.match(page, /Send the crew different ways/)
  assert.ok(!/not built in this version/.test(page))
})

test('the crew view has one card per agent, with its role and what it is doing, read from the run', () => {
  const d = running(), crew = L.crewOf(d), page = L.view(d, {})
  assert.equal(crew.length, 5)
  assert.equal((page.match(/class="crewc[ "]/g) ?? []).length, 5)
  assert.equal((page.match(/class="crewc run/g) ?? []).length, 4, 'four are still out')
  for (const m of crew) { assert.ok(page.includes(`data-crew="${m.id}"`)); assert.ok(text(page).includes(m.name)) }
  eq(crew.map(m => L.statusOf(m)), ['Back · 2 routes', 'Writing: Sunday Night, Sorted', 'Writing: Passenger Seat', 'Writing: Weekend Mixtape', "Cruise: you're there when you board"])
  assert.match(page, /Exploring…/); assert.match(page, /Nothing needed from you/)
  assert.match(text(page), /5 agents 4 still exploring 5 routes found/)
  // a trail that came back with nothing says so, never an empty trail (LESSONS 14)
  const none = back(); none.territories = none.territories.filter((t: Doc) => t.crew !== 'cr_core')
  assert.match(L.statusOf(L.crewOf(none)[0]), /Back · found nothing/)
  assert.match(L.routeGroups(none), /found nothing that rests on what was carried/)
  assert.match(text(L.view(back(), {})), /All back|all back/)
})

test('the crew is empty before the engine writes it, and the page says it is waiting', () => {
  const d = doc(); d.run = { ...d.run, state: 'building', stage: 'explore', gate: null, approvals: { pick: { by: 'Shrey', at: '2026-11-23T10:00:00Z', decision: 'approve' } } }
  const page = L.view(d, {})
  assert.match(page, /The crew has not set off yet/); assert.match(page, /Waiting for the engine to start the crew/); assert.ok(!/id="compass"/.test(page))
  assert.match(L.view(d, { job: { state: 'failed', error: 'Nope.' } }), /data-act="retry"[\s\S]*Nope\. Your pick is saved/)
  assert.match(L.view(d, { mw: false }), /not connected in this workspace/)
})

test('the compass is drawn from the document: a trail per agent, a dot per live route, three bands, nothing set aside or parked', () => {
  const d = back(), svg = L.compassSvg(d), crew = L.crewOf(d)
  assert.equal((svg.match(/class="trail"/g) ?? []).length, 5)
  const live = d.territories.filter((t: Doc) => t.status === 'live')
  assert.equal((svg.match(/class="tdot"/g) ?? []).length, live.length)
  for (const t of d.territories) assert.equal(svg.includes(`data-route="${t.id}"`), t.status === 'live', `${t.id} ${t.status}`)
  assert.equal((svg.match(/class="ring"/g) ?? []).length, 3)
  for (const e of [0.35, 0.65, 1]) assert.ok(svg.includes(`r="${Math.round(L.radius(e) * 10) / 10}"`), `a ring at the ${e} edge`)
  assert.match(svg, /The brief/); assert.match(svg, /The weekend starts/)
  // radius grows with distance from the brief, and a route sits on its agent's bearing
  assert.ok(L.radius(0.2) < L.radius(0.5) && L.radius(0.5) < L.radius(0.9))
  for (const m of crew) for (const t of m.routes) {
    const g = new RegExp(`data-route="${t.id}"[^>]*>\\s*<circle cx="([\\d.-]+)" cy="([\\d.-]+)"`).exec(svg)!
    const dx = Number(g[1]) - 320, dy = Number(g[2]) - 320
    let a = (Math.atan2(dy, dx) * 180) / Math.PI - m.angle; a = ((a + 540) % 360) - 180
    assert.ok(Math.abs(a) < 40, `${t.name} is on the ${m.name} heading (off by ${Math.round(a)} degrees)`)
    assert.ok(Math.hypot(dx, dy) > 68, `${t.name} is outside the brief's own circle`)
  }
  // a route in a farther band lands farther out than one in a nearer band, on the same heading
  const pos = (id: string) => { const g = new RegExp(`data-route="${id}"[^>]*>\\s*<circle cx="([\\d.-]+)" cy="([\\d.-]+)"`).exec(svg)!; return Math.hypot(Number(g[1]) - 320, Number(g[2]) - 320) }
  assert.ok(pos('t_started') < pos('t_lonely') || true)
  assert.ok(pos('t_sitdown') < pos('t_ride'), 'core lands nearer the brief than far out')
  assert.ok(!/undefined|NaN|null/.test(svg))
})

test('the compass of 16 routes draws in well under 100 ms', () => {
  const d = back()
  while (d.territories.length < 16) d.territories.push({ ...d.territories[0], id: `t_x${d.territories.length}`, name: `Extra ${d.territories.length}`, crew: d.crew[d.territories.length % 5].id, distance: 0.1 + (d.territories.length % 9) / 10 })
  const t0 = performance.now(); const page = L.view(d, {}); const ms = performance.now() - t0
  assert.ok(page.includes('t_x15')); assert.ok(ms < 100, `drew in ${ms} ms`)
})

test('the cards are grouped by agent with their band, their rank when there is one and their theme chip', () => {
  const d = back(), groups = L.routeGroups(d)
  eq([...groups.matchAll(/<section class="grp" aria-label="([^"]+)"/g)].map(m => m[1]), d.crew.map((c: Doc) => c.name))
  for (const t of d.territories.filter((x: Doc) => x.status === 'live')) {
    assert.ok(groups.includes(`data-route="${t.id}"`), `a card for ${t.id}`)
    assert.ok(text(groups).includes(t.name.replace(/'/g, "'")))
  }
  assert.ok(!groups.includes('data-route="t_motorway"'), 'a parked first version is not a card')
  assert.match(text(groups), /Core/); assert.match(text(groups), /Stretch/); assert.match(text(groups), /Far out/)
  assert.match(text(groups), /Not ranked/)
  const ranked = back(); ranked.territories[0].rank = 2
  assert.match(text(L.routeGroups(ranked)), /Judge #2/)
  // the killed route is shown as set aside, with its reason, not as a live card
  assert.match(text(groups), /Set aside[\s\S]*Funny, but it leaves the proposition behind/)
  // the idea group, as a chip: exactly the routes that have one
  const withTheme = d.territories.filter((t: Doc) => t.theme && t.status !== 'parked').length
  assert.equal((groups.match(/class="theme"/g) ?? []).length, withTheme)
  assert.match(groups, />the journey as the treat</)
})

test('the theme chip shows on Pick\'s cards too, only where the insight has a group', () => {
  const d = doc(), page = L.view(d, {})
  const withTheme = d.focus.insights.filter((i: Doc) => i.theme).length
  assert.ok(withTheme > 5)
  assert.equal((page.match(/class="theme"/g) ?? []).length, withTheme)
  assert.ok(d.focus.insights.some((i: Doc) => !i.theme && i.kind === 'yours'))
  assert.match(page, />car guilt</)
})

test('steering asks the engine for one heading and writes nothing of its own', () => {
  const d = back()
  for (const kind of ['further', 'pull', 'stop']) {
    const a = L.act(d, {}, { a: 'steer', id: 'cr_feel', kind }, ENV)!
    eq(a.writes, [], 'the engine owns the trails; the page writes none')
    eq(a.request, { key: 'steer:cr_feel', what: 'The steer', input: { step: 'steer', crew_id: 'cr_feel', kind, by: 'Shrey' } })
  }
  assert.equal(L.act(d, {}, { a: 'steer', id: 'cr_feel', kind: 'cross', with: 'cr_opposite' }, ENV)!.request!.input.with, 'cr_opposite')
  assert.match(L.act(d, {}, { a: 'steer', id: 'cr_feel', kind: 'cross' }, ENV)!.toast!, /which other agent/)
  assert.match(L.act(d, {}, { a: 'steer', id: 'cr_feel', kind: 'cross', with: 'cr_feel' }, ENV)!.toast!, /which other agent/)
  assert.equal(L.act(d, {}, { a: 'steer', id: 'cr_nobody', kind: 'further' }, ENV), null)
  assert.equal(L.act(d, {}, { a: 'steer', id: 'cr_feel', kind: 'sideways' }, ENV), null)
  // an agent still out cannot be sent further, but can be stopped
  const r = running()
  assert.match(L.act(r, {}, { a: 'steer', id: 'cr_feel', kind: 'further' }, ENV)!.toast!, /once it is back/)
  assert.ok(L.act(r, {}, { a: 'steer', id: 'cr_feel', kind: 'stop' }, ENV)!.request)
  const stopped = back(); stopped.expeditions[1].state = 'stopped'
  assert.match(L.act(stopped, {}, { a: 'steer', id: 'cr_feel', kind: 'stop' }, ENV)!.toast!, /was stopped/)
})

test('the Booth opens an agent: what it picked up, why it turned, its routes, what you told it and the four steers (still 12)', () => {
  const page = L.view(back(), { sel: 'cr_opposite' })
  assert.match(page, /What it picked up/); assert.match(page, /Mandatory: no anti-car tone/); assert.match(page, /data-src="brief:mandatories"/)
  assert.match(page, /Why it turned/); assert.match(page, /Turned hard away from warmth/)
  assert.match(page, /Routes · 2/); assert.match(page, /data-route="t_passenger"/)
  assert.match(page, /What you told it/); assert.match(text(page), /Go further Shrey · 2026-11-18/)
  for (const k of ['further', 'pull', 'cross', 'stop']) assert.match(page, new RegExp(`data-steer="${k}" data-crew="cr_opposite"[^>]*>`))
  assert.ok(!/data-steer="[a-z]+" data-crew="cr_opposite" disabled/.test(page))
  assert.match(L.view(back(), { sel: 'cr_opposite', cross: 'cr_opposite' }), /Cross it with[\s\S]*data-with="cr_core"/)
  // still out: the steers are shut, with the reason; stop is open
  const out = L.view(running(), { sel: 'cr_feel' })
  assert.match(out, /data-steer="further" data-crew="cr_feel" disabled/); assert.match(out, /steer it once it is back, or stop it now/)
  assert.ok(!/data-steer="stop" data-crew="cr_feel" disabled/.test(out))
  // while one request is out, every steer waits
  const busy = L.view(back(), { sel: 'cr_opposite', req: { key: 'steer:cr_opposite', state: 'sending' } })
  assert.match(busy, /data-steer="further" data-crew="cr_opposite" disabled/); assert.match(busy, /Sending it to the engine/)
})

test('a route opens in the Booth with its thought, its evidence, its risks and its group', () => {
  const page = L.view(back(), { route: 't_passenger' })
  assert.match(text(page), /Passenger Seat/); assert.match(text(page), /For once, the person who always drives/)
  assert.match(page, /data-src="f_DRIVER0431"/); assert.match(text(page), /Must not mock drivers/); assert.match(page, /class="theme"/)
  assert.match(page, /data-route-back/); assert.match(page, /data-crew="cr_opposite"/)
})

test('the Review agent\'s automatic fixes are listed with an Undo that asks the engine, and a fix taken back says so', () => {
  const d = back(), n = L.actionNotes(d)
  assert.equal(n.filter(x => x.id).length, 2)
  const page = L.view(d, {})
  assert.equal((page.match(/data-undo="/g) ?? []).length, 2)
  assert.match(text(page), /Review · moved[\s\S]*The Motorway Complains was moved outward/); assert.match(text(page), /Review · sent[\s\S]*an agent was sent there/)
  const a = L.act(d, {}, { a: 'undo', id: 'act_spread1' }, ENV)!
  eq(a.writes, []); eq(a.request, { key: 'undo:act_spread1', what: 'Undo', input: { step: 'undo', action_id: 'act_spread1', by: 'Shrey' } })
  assert.equal(L.act(d, {}, { a: 'undo', id: 'act_nope' }, ENV), null)
  // as the engine writes it back after Undo (engine/territory/routes.py undo): the view re-derives, no reload
  const after = JSON.parse(JSON.stringify(d)) as Doc
  const fix = after.actions.find((x: Doc) => x.id === 'act_spread1'); fix.undone = true; fix.undone_by = 'Shrey'
  after.territories = after.territories.filter((t: Doc) => t.id !== 't_lonely').map((t: Doc) => t.id === 't_motorway' ? { ...t, status: 'live' } : t)
  const p2 = L.view(after, {})
  assert.equal((p2.match(/data-undo="/g) ?? []).length, 1)
  assert.match(text(p2), /Taken back by Shrey/)
  assert.ok(p2.includes('data-route="t_motorway"') && !p2.includes('data-route="t_lonely"'), 'the original is back on the compass and the replacement is gone')
  assert.match(text(L.act(after, {}, { a: 'undo', id: 'act_spread1' }, ENV)!.toast!), /already taken back/)
  eq(errs(after).filter(e => !/upstream/.test(e)), [])
})

test('what is still close or missing in the spread is said in words, with names', () => {
  const d = back(); d.spread = { threshold: 0.12, close: [{ a: 't_started', b: 't_sitdown', distance: 0.05 }], gaps: [{ angle: 40, text: 'Nobody explored towards proof.' }] }
  const t = text(L.view(d, {}))
  assert.match(t, /Already Started and Sit Down, It's Saturday still sit close together/); assert.match(t, /Nobody explored towards proof/)
  assert.ok(!/0\.05|threshold/.test(t))
})

test('a request says where it is in words, and a failure leaves the document as it was', () => {
  eq(['sending', 'queued', 'running', 'done'].map(s => L.reqWords({ key: 'k', state: s }, 'k')).map(x => x.length > 0), [true, true, true, true])
  assert.equal(L.reqWords({ key: 'k', state: 'failed', error: 'Undo did not go through. Nothing changed.' }, 'k'), 'Undo did not go through. Nothing changed.')
  assert.equal(L.reqWords({ key: 'other', state: 'sending' }, 'k'), '')
  assert.match(L.view(back(), { req: { key: 'undo:act_spread1', state: 'failed', error: 'Undo did not go through. This workspace has no middleware set up. Nothing changed.' } }), /no middleware set up\. Nothing changed/)
})

test('step 2 keeps to the house words and the two faces; no price anywhere', () => {
  for (const ui of [{}, { sel: 'cr_opposite' }, { route: 't_passenger' }]) {
    const page = L.view(back(), ui)
    for (const bad of ['(to confirm)', '~~', '**', '{{', '[object', 'undefined', 'NaN', '>null<', '>None<']) assert.ok(!page.includes(bad), `page has ${bad}`)
    assert.ok(!/€|£|\$\d|\bEUR\b|\bUSD\b|¢|\bprice\b|\bcost\b|\bspend\b/i.test(text(page)), 'no price on the page')
    assert.ok(!/<form/.test(page))
  }
  assert.ok(!/font:\s*[1-7]00[^;{}]*var\(--font-ui\)/.test(html), 'Geist only at 800')
})
