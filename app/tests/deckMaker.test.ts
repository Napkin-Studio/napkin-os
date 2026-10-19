// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Deck Maker template: what its screens decide (the pure block, run alone), and
// that its page keeps to the host's rules and the house look.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const html = readFileSync(new URL('templates/deck-maker/index.html', root), 'utf8')

const logicSrc = /<script id="deck-logic">([\s\S]*?)<\/script>/.exec(html)?.[1]
assert.ok(logicSrc, 'the template has its pure block')
type Stage = { id: string; name: string; sub: string; status: string }
type Run = { state: string; stage: string; cost_usd: number; stages: Stage[]; gate: { id: string } | null; approvals: Record<string, unknown> }
type Check = { ok: boolean; text: string }
type Evidence = { ref: string; kind: string }
const L = vm.runInNewContext(`${logicSrc}; DeckLogic`) as {
  isPlaceholder(b: unknown): boolean
  evidenceFor(slide: unknown, evidence: unknown): Evidence[]
  statusOf(slide: unknown): string
  checksFor(id: string, slide: unknown, validation: unknown): Check[]
  approveGate(run: unknown, gate: string | null | undefined, by: string, at: string): (Run & { gate: null }) | null
  gateHolds(run: unknown): boolean
  summaryOf(inputs: unknown, deck: unknown): { title: string; note: string }
  agencyShown(inputs: unknown): string
  upstreamSummary(data: unknown): { brief: { name: string; fields_filled: number; fields_total: number; mandatories: number } | null; research: { name: string; findings: number | null; rejected: number | null } | null; any: boolean }
  documentsOf(data: unknown): { name: string }[]
  builtFrom(inputs: unknown, upstream: unknown, documents: unknown): { tier: string; documents: string[]; brief: boolean; research: boolean }
  describeBuiltFrom(bf: unknown, hasPrompt?: boolean): { line: string; missing: string[] }
  canBuild(inputs: unknown, upstream: unknown, documents: unknown): { ok: boolean; message: string }
  gapView(intake: unknown): { brief_fields: unknown[]; slide_types: unknown[]; questions: { id: string; state: string; options: { id: string }[] }[]; hasGaps: boolean }
  answerPatch(qid: string, answer: unknown, at: string): unknown
  researchRequest(at: string): unknown
  upstreamChanged(res: unknown): { title: string }[]
  DECK_TYPES: { id: string; label: string; one_line: string }[]
  deckTypeOf(data: unknown): { id: string; source: string; quote: string; skipped: boolean; hasQuestion: boolean }
  typeHints(type: string): { type: string; items: string[]; line: string }
  kindOfType(type: string): string
  typePatch(data: unknown, type: string | null, at: string): unknown
  supplyCards(data: unknown): { id: string; fills: string; state: string; lines: string[] }[]
  toSupply(data: unknown): { count: number; covered: number; ids: string[] }
  confirmList(data: unknown): { items: { ref: string; kind: string; text: string; verified: { by: string; at: string } | null }[]; total: number; verified: number; open: number }
  verifyPatch(ref: string, at: string): unknown
  sourcedCounts(data: unknown): { toSupply: number; verified: number; total: number; open: number; supplied: number; sourced: number }
}
// Results come from another realm, so their arrays are not this realm's Arrays: compare as plain JSON.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v))

const stage = (id: string, status: string) => ({ id, name: id, sub: '', status })
const run = (): Run => ({
  state: 'gate', stage: 'storyline', cost_usd: 1,
  stages: [stage('inputs', 'done'), stage('storyline', 'now'), stage('territories', 'next'), stage('copy', 'next')],
  gate: { id: 'storyline', n: 1, of: 3, beats: [], checks: [] }, approvals: {},
})

test('an open gate holds: nothing after it is running', () => {
  assert.equal(L.gateHolds(run()), true)
  const bad = run()
  bad.stages[2].status = 'now'
  assert.equal(L.gateHolds(bad), false)
})

test('approving the open gate finishes it, starts the next stage and records who', () => {
  const next = L.approveGate(run(), 'storyline', 'Sai', '2026-10-15T10:00:00Z')!
  assert.equal(next.gate, null)
  assert.deepEqual(plain(next.stages.map((s: Stage) => s.status)), ['done', 'done', 'now', 'next'])
  assert.deepEqual(plain(next.approvals.storyline), { by: 'Sai', at: '2026-10-15T10:00:00Z' })
  assert.equal(next.stage, 'territories')
})

test('only the open gate can be approved, and the old run is not changed', () => {
  const r = run()
  assert.equal(L.approveGate(r, 'territories', 'Sai', 'x'), null)
  assert.equal(L.approveGate({ ...r, gate: null }, 'storyline', 'Sai', 'x'), null)
  L.approveGate(r, 'storyline', 'Sai', 'x')
  assert.equal(r.stages[1].status, 'now')
})

test('a placeholder is text only the user can supply', () => {
  assert.equal(L.isPlaceholder({ kind: 'text', text: '[Presenter name and role]' }), true)
  assert.equal(L.isPlaceholder({ kind: 'text', text: 'Anything', human: true }), true)
  assert.equal(L.isPlaceholder({ kind: 'text', text: 'A real line [1]' }), false)
})

test('evidence lists each cited ref once, and a ref the run lacks is shown as missing', () => {
  const slide = {
    blocks: [{ refs: ['f_12', 'brief:channels'] }, { refs: ['f_12'] }],
    claims: [{ refs: ['f_99'] }, { refs: [] }],
  }
  const got = L.evidenceFor(slide, { f_12: { kind: 'research finding', text: 'x' }, 'brief:channels': { kind: 'brief', text: 'y' } })
  assert.deepEqual(plain(got.map((e: Evidence) => e.ref)), ['f_12', 'brief:channels', 'f_99'])
  assert.equal(got[2].kind, 'not found')
})

test('slide status follows the engine: needs_human is needs-you', () => {
  assert.equal(L.statusOf({ status: 'needs_human' }), 'need')
  assert.equal(L.statusOf({ status: 'drafted' }), 'draft')
  assert.equal(L.statusOf({ status: 'from_source' }), 'src')
})

test('an unsourced line is labelled, not flagged as a missing source', () => {
  const slide = { blocks: [], claims: [{ text: 'a', refs: [], basis: 'opinion' }] }
  const checks = L.checksFor('s04', slide, { findings: {} })
  assert.ok(checks.every((c: Check) => c.ok))
  assert.ok(checks.some((c: Check) => /opinion/.test(c.text)))
})

test('the agency shows as a placeholder until the user gives one', () => {
  assert.equal(L.agencyShown({ prompt: { agency: '' } }), '[Agency]')
  assert.equal(L.agencyShown({ prompt: { agency: ' Acme ' } }), 'Acme')
})

test('the summary comes from the inputs, never fixed numbers', () => {
  const pitch = L.summaryOf({ prompt: { client: 'Lumen' }, kind: 'agency', format: 'pitch' }, { order: [], slides: {} })
  assert.match(pitch.title, /agency pitch for Lumen/i)
  const full = L.summaryOf({ prompt: { client: 'Lumen' }, kind: 'investor', format: 'full' }, { order: [], slides: {} })
  assert.match(full.title, /investor deck/i)
  assert.match(full.note, /story order/)
})

// ── the page ──────────────────────────────────────────────────────────────
test('the host injects its bridge at the last </body>: the page has exactly one', () => {
  assert.equal(html.match(/<\/body>/gi)?.length, 1)
})

test('colours are tokens: no raw hex outside the token blocks and the studio mark', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]
  // The tokens live in :root rules; everything after the last token rule must use var(--…).
  const afterTokens = css.slice(css.indexOf('*,*::before'))
  const stripped = afterTokens.replace(/rgba?\([^)]*\)/g, '')
  assert.deepEqual(stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [])
})

test('the one action colour is --create and the tool identity is --tool', () => {
  assert.match(html, /--create:#FF4F2E/)
  assert.match(html, /--tool:#2F64F5/)
  assert.match(html, /\.btn\.go\{[^}]*var\(--create\)/)
})

test('light and dark both define the surface tokens', () => {
  for (const tok of ['--paper', '--ink', '--line', '--soft', '--tool-ink']) {
    assert.ok((html.match(new RegExp(`${tok}:`, 'g')) ?? []).length >= 3, `${tok} in light, dark and OS-dark`)
  }
})

test('Geist and Geist Mono are the type', () => {
  assert.match(html, /family=Geist:[^"]*family=Geist\+Mono/)
  assert.match(html, /--f-display:'Geist'/)
  assert.match(html, /--f-mono:'Geist Mono'/)
})

test('the mark is the studio mark in fixed brand colours, not theme tokens', () => {
  for (const hex of ['#FF4F2E', '#8B919E', '#14161B', '#DADDE3']) assert.ok(html.includes(`fill="${hex}"`), hex)
})

test('the only inputs are the three prompt fields, the open prompt and the file picker', () => {
  assert.deepEqual([...html.matchAll(/field\('(\w+)'/g)].map(m => m[1]), ['client', 'project', 'agency'])
  assert.equal(html.match(/<textarea/gi)?.length, 2) // the open prompt, and the free-text box of a supply card
  assert.equal(html.match(/contenteditable/gi)?.length ?? 0, 0)
})

test('the team-library shelf is off unless the document turns it on', () => {
  assert.match(html, /s\.inputs\.library \|\| !s\.inputs\.library\.enabled/)
})

// ── intake, upstream and the page, driven through a stub DOM ───────────────
const briefDoc = {
  title: 'First Light brief', objectives: 'Be first', background: 'x', insight: '', mandatories: ['a', 'b'],
}
const researchDoc = { title: 'Lumen research', projection: { findings: { f1: { status: 'verified' }, f2: { status: 'rejected' } } } }

test('upstreamSummary: none, brief only, brief and research, research only', () => {
  assert.deepEqual(plain(L.upstreamSummary({})), { brief: null, research: null, any: false })
  assert.equal(L.upstreamSummary({ upstream: 'junk' }).any, false)
  const b = L.upstreamSummary({ upstream: { d1: briefDoc } })
  assert.equal(b.brief?.name, 'First Light brief')
  assert.equal(b.brief?.fields_filled, 3)
  assert.equal(b.brief?.mandatories, 2)
  assert.equal(b.research, null)
  const both = L.upstreamSummary({ upstream: { d1: briefDoc, d2: researchDoc } })
  assert.ok(both.brief && both.research)
  assert.deepEqual(plain(both.research), { name: 'Lumen research', findings: 2, rejected: 1 })
  const r = L.upstreamSummary({ upstream: { d2: researchDoc } })
  assert.equal(r.brief, null)
  assert.equal(r.research?.rejected, 1)
})

test('builtFrom gives each tier of the shared contract', () => {
  const docs = [{ name: 'notes.txt' }]
  assert.deepEqual(plain(L.builtFrom({}, {}, [])), { tier: 'prompt', documents: [], brief: false, research: false })
  assert.deepEqual(plain(L.builtFrom({}, {}, docs)), { tier: 'prompt+documents', documents: ['notes.txt'], brief: false, research: false })
  assert.equal(L.builtFrom({}, { d2: researchDoc }, []).tier, 'research')
  assert.equal(L.builtFrom({}, { d1: briefDoc }, docs).tier, 'brief')
  const both = L.builtFrom({}, { d1: briefDoc, d2: researchDoc }, [])
  assert.deepEqual(plain(both), { tier: 'brief+research', documents: [], brief: true, research: true })
})

test('the Built from line says what is missing', () => {
  const none = L.describeBuiltFrom(L.builtFrom({}, {}, []), true)
  assert.match(none.line, /^Built from: your prompt/)
  assert.ok(none.missing.some(m => /numbers stay placeholders/.test(m)))
  const full = L.describeBuiltFrom(L.builtFrom({}, { d1: briefDoc, d2: researchDoc }, [{ name: 'a' }]), false)
  assert.equal(full.line, 'Built from: 1 document, the brief, the research')
  assert.deepEqual(plain(full.missing), [])
})

test('the Build guard refuses only when there is no text, no document and no upstream', () => {
  assert.equal(L.canBuild({ prompt: { text: '  ' } }, {}, []).ok, false)
  assert.match(L.canBuild({ prompt: {} }, {}, []).message, /something to build from/)
  assert.equal(L.canBuild({ prompt: { text: 'a line' } }, {}, []).ok, true)
  assert.equal(L.canBuild({ prompt: {} }, {}, [{ name: 'a' }]).ok, true)
  assert.equal(L.canBuild({ prompt: {} }, { d1: briefDoc }, []).ok, true)
})

test('answers and skips are patches at intake.answers.<qid>; unsafe or empty ones are refused', () => {
  assert.deepEqual(plain(L.answerPatch('q_a', { option_id: 'x' }, 't')), { intake: { answers: { q_a: { option_id: 'x', skipped: null, text: null, at: 't' } } } })
  assert.deepEqual(plain(L.answerPatch('q_a', { text: ' hi ' }, 't')), { intake: { answers: { q_a: { text: 'hi', skipped: null, option_id: null, at: 't' } } } })
  assert.deepEqual(plain(L.answerPatch('q_a', { skipped: true }, 't')), { intake: { answers: { q_a: { skipped: true, option_id: null, text: null, at: 't' } } } })
  assert.equal(L.answerPatch('q_a', { text: ' ' }, 't'), null)
  assert.equal(L.answerPatch('__proto__', { text: 'x' }, 't'), null)
})

test('gapView caps questions at 5 and a skipped question is not open', () => {
  const qs = Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i, text: 'Q' + i, options: [] }))
  const g = L.gapView({ gaps: { brief_fields: [{ field: 'f', why: 'w' }] }, questions: qs, answers: { q0: { skipped: true }, q1: { text: 'a' } } })
  assert.equal(g.questions.length, 5)
  assert.deepEqual(plain(g.questions.slice(0, 3).map(q => q.state)), ['skipped', 'answered', 'open'])
  assert.equal(g.hasGaps, true)
  assert.equal(L.gapView(undefined).hasGaps, false)
})

test('upstreamChanged lists only changed sources and survives junk', () => {
  assert.deepEqual(plain(L.upstreamChanged({ upstream: [{ status: 'changed', title: 'T' }, { status: 'same' }] })), [{ title: 'T' }])
  assert.deepEqual(plain(L.upstreamChanged(null)), [])
  assert.deepEqual(plain(L.upstreamChanged({ upstream: 5 })), [])
})

test('the researchRequest patch is only { status: asked, at }', () => {
  assert.deepEqual(plain(L.researchRequest('t')), { research_request: { status: 'asked', at: 't' } })
})

test('nothing in the app writes inputs.brief or inputs.research', () => {
  assert.equal(/inputs\.(brief|research)\b/.test(html), false)
  assert.equal(/put\(\{\s*inputs:\s*inputs/.test(html), false)
  assert.equal(/Needed/.test(html), false)
})

// A stub DOM: enough to run the page script, render, and click.
type Writes = { obj: Record<string, unknown>; action: string }[]
function mount(data: Record<string, unknown>, fetchImpl?: unknown, extraEls: Record<string, unknown> = {}) {
  const writes: Writes = []
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  const app = { innerHTML: '' }
  const toastEl = { textContent: '', classList: { add() {}, remove() {} }, _t: 0 }
  const els: Record<string, unknown> = { app, toast: toastEl, ...extraEls }
  const doc = {
    getElementById: (id: string) => els[id] ?? null,
    addEventListener: (t: string, f: (e: unknown) => void) => { (handlers[t] ||= []).push(f) },
    title: '',
  }
  const win: Record<string, unknown> = {
    __CLAN__: { data },
    clan: { patchData: (obj: Record<string, unknown>, o: { action: string }) => { writes.push({ obj, action: o.action }); return Promise.resolve() } },
    addEventListener() {},
  }
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop()!
  const ctx = vm.createContext({ window: win, document: doc, navigator: { userAgent: 'Mac' }, fetch: fetchImpl, Promise, setTimeout, clearTimeout, Date })
  vm.runInContext(logicSrc, ctx)
  vm.runInContext(src, ctx)
  const click = (attrs: Record<string, string>, id = '') =>
    handlers.click.forEach(h => h({ target: { closest: () => ({ dataset: attrs, id }) } }))
  return { app, writes, click, toastEl }
}

const hostile = '<img src=x onerror=alert(1)>'
const intakeData = {
  inputs: { prompt: { client: 'Lumen', project: 'P', text: '' }, documents: [{ name: hostile }], kind: 'agency', format: 'pitch' },
  upstream: { d1: { ...briefDoc, title: hostile } },
  intake: {
    gaps: { brief_fields: [{ field: hostile, why: 'w' }], slide_types: [{ type: 'team', why: 'none' }] },
    questions: [{ id: 'q_a', text: hostile, options: [{ id: 'o1', label: hostile }], allow_text: true }],
  },
}

test('markup in a brief name, a document name, a gap or a question is escaped', () => {
  const m = mount(intakeData)
  assert.ok(m.app.innerHTML.includes('Strengthen with research'))
  assert.ok(m.app.innerHTML.includes('Bring in a brief or research (optional)'))
  assert.equal(m.app.innerHTML.includes('<img'), false)
  assert.ok(m.app.innerHTML.includes('&lt;img'))
})

test('Start shows Optional with no upstream and offers Build with no brief', () => {
  const m = mount({ inputs: { prompt: {} } })
  assert.ok(m.app.innerHTML.includes('Optional'))
  assert.ok(m.app.innerHTML.includes('Built from:'))
  assert.ok(m.app.innerHTML.includes('numbers stay placeholders'))
})

test('Build with nothing to build from is refused and writes nothing', () => {
  const m = mount({ inputs: { prompt: {} } })
  m.click({}, 'build')
  assert.equal(m.writes.length, 0)
  assert.match(m.toastEl.textContent, /something to build from/)
})

test('Build writes the person\'s inputs and never the brief or research', () => {
  const m = mount({ inputs: { prompt: { text: 'a line' } }, upstream: { d1: briefDoc } })
  m.click({}, 'build')
  assert.equal(m.writes.length, 1)
  const inputs = (m.writes[0].obj as { inputs: Record<string, unknown> }).inputs
  assert.deepEqual(Object.keys(inputs).sort(), ['format', 'kind', 'prompt'])
})

test('the strengthen click writes research_request only', () => {
  const m = mount(intakeData)
  m.click({}, 'strengthen')
  assert.equal(m.writes.length, 1)
  assert.deepEqual(Object.keys(m.writes[0].obj), ['research_request'])
  assert.equal((m.writes[0].obj.research_request as { status: string }).status, 'asked')
  assert.match(m.toastEl.textContent, /needs the server/)
})

test('answering and skipping write at intake.answers and nothing else', () => {
  const m = mount(intakeData)
  m.click({ qopt: 'o1', q: 'q_a' })
  m.click({ qskip: 'q_a' })
  assert.equal(m.writes.length, 2)
  for (const w of m.writes) assert.deepEqual(Object.keys((w.obj as { intake: { answers: object } }).intake.answers), ['q_a'])
})

test('the upstream-changed notice shows when the host says so, escaped, and nothing when the call fails', async () => {
  const ok = mount(intakeData, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ upstream: [{ status: 'changed', title: hostile }] }) }))
  await new Promise(r => setTimeout(r, 10))
  assert.ok(ok.app.innerHTML.includes('data-up-changed'))
  assert.equal(ok.app.innerHTML.includes('<img'), false)
  const bad = mount(intakeData, () => Promise.reject(new Error('no host')))
  await new Promise(r => setTimeout(r, 10))
  assert.equal(bad.app.innerHTML.includes('data-up-changed'), false)
  const absent = mount(intakeData)
  assert.equal(absent.app.innerHTML.includes('data-up-changed'), false)
})

// ── fixes from review ──────────────────────────────────────────────────────
const spunOff = { title: 'R', campaign: { name: 'X' }, report: { headline: 'h' }, selection: {}, materials: {} }

test('a spun-off research document (no projection) shows no invented finding counts', () => {
  const r = L.upstreamSummary({ upstream: { d2: spunOff } }).research
  assert.deepEqual(plain(r), { name: 'R', findings: null, rejected: null })
  const m = mount({ inputs: { prompt: {} }, upstream: { d2: spunOff } })
  assert.equal(/0 findings|0 rejected/.test(m.app.innerHTML), false)
  assert.ok(m.app.innerHTML.includes('report brought in'))
})

test('empty or all-rejected material is not a source', () => {
  const rejected = { title: 'R', projection: { findings: { f1: { status: 'rejected' } } } }
  assert.equal(L.canBuild({ prompt: {} }, { d2: rejected }, []).ok, false)
  assert.deepEqual(plain(L.builtFrom({}, { d2: rejected }, [])), { tier: 'prompt', documents: [], brief: false, research: false })
  assert.equal(L.canBuild({ prompt: { text: '' } }, { a: { background: '', objectives: '' } }, []).ok, false)
  assert.equal(L.builtFrom({}, { a: { background: '' } }, []).brief, false)
  assert.equal(L.canBuild({ prompt: { text: '' } }, { r: { report: {} } }, []).ok, false)
  assert.equal(L.canBuild({ prompt: { text: '' } }, { r: { campaign: { name: 'X' }, report: { headline: ' ' } } }, []).ok, false)
  assert.equal(L.canBuild({ prompt: {} }, { d2: spunOff }, []).ok, true)
  assert.equal(L.builtFrom({}, { d2: spunOff }, []).tier, 'research')
})

test('gapView drops unanswerable question ids, duplicate ids and options with no id', () => {
  const g = L.gapView({ questions: [
    { id: 'a b', text: 't' }, { id: 'a/b', text: 't' }, { id: 'q1', text: 'one', options: [{}, { id: 'o', label: 'O' }] }, { id: 'q1', text: 'dup' },
  ] })
  assert.deepEqual(plain(g.questions.map(q => q.id)), ['q1'])
  assert.deepEqual(plain(g.questions[0].options.map(o => o.id)), ['o'])
})

test('a typed free-text answer survives a re-render caused by something else', () => {
  const data = { inputs: { prompt: {} }, intake: { questions: [{ id: 'q1', text: 'One' }, { id: 'q2', text: 'Two' }] } }
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  const els: Record<string, { value: string }> = { qt_q2: { value: 'half typed' } }
  const app: { innerHTML: string } = { innerHTML: '' }
  const doc = {
    getElementById: (id: string) => (id === 'app' ? app : id in els ? els[id] : null),
    addEventListener: (t: string, f: (e: unknown) => void) => { (handlers[t] ||= []).push(f) },
    title: '',
  }
  const win = { __CLAN__: { data }, clan: { patchData: () => Promise.resolve() }, addEventListener() {} }
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop()!
  const ctx = vm.createContext({ window: win, document: doc, navigator: { userAgent: 'Mac' }, Promise, setTimeout, clearTimeout, Date })
  vm.runInContext(logicSrc, ctx)
  vm.runInContext(src, ctx)
  // The re-render redraws the inputs empty; the typed text must be put back.
  Object.defineProperty(app, 'innerHTML', { set() { els.qt_q2 = { value: '' } }, get: () => '' })
  handlers.click.forEach(h => h({ target: { closest: () => ({ dataset: { tab: 'evidence' }, id: '' }) } }))
  assert.equal(els.qt_q2.value, 'half typed')
})

test('Attach keeps the files that went in when another fails, and names the one that failed', async () => {
  const writes: Record<string, unknown>[] = []
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  const toastEl = { textContent: '', classList: { add() {}, remove() {} }, _t: 0 }
  const els: Record<string, unknown> = { app: { innerHTML: '' }, toast: toastEl }
  const doc = {
    getElementById: (id: string) => els[id] ?? null,
    addEventListener: (t: string, f: (e: unknown) => void) => { (handlers[t] ||= []).push(f) },
    title: '',
  }
  const win = {
    __CLAN__: { data: { inputs: { prompt: {} } } },
    clan: {
      patchData: (obj: Record<string, unknown>) => { writes.push(obj); return Promise.resolve() },
      uploadAsset: (name: string) => (name === 'bad.pdf' ? Promise.resolve({ ok: false }) : Promise.resolve({ ok: true })),
    },
    addEventListener() {},
  }
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop()!
  const ctx = vm.createContext({ window: win, document: doc, navigator: { userAgent: 'Mac' }, Promise, setTimeout, clearTimeout, Date })
  vm.runInContext(logicSrc, ctx)
  vm.runInContext(src, ctx)
  const f = (name: string) => ({ name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) })
  const input = { id: 'attach', files: [f('a.pdf'), f('bad.pdf'), f('c.pdf')], value: 'x' }
  handlers.change.forEach(h => h({ target: input }))
  await new Promise(r => setTimeout(r, 20))
  assert.equal(writes.length, 1)
  const docs = (writes[0] as { inputs: { documents: { name: string }[] } }).inputs.documents
  assert.deepEqual(plain(docs.map(x => x.name)), ['a.pdf', 'c.pdf'])
  assert.match(toastEl.textContent, /bad\.pdf/)
  assert.equal(input.value, '')
})

// ── deck types ────────────────────────────────────────────────────────────────
const typeQ = (extra: Record<string, unknown> = {}) => ({
  id: 'q_deck_type', text: 'What kind of deck is this?', allow_text: false,
  options: [
    { id: 'agency_pitch', label: 'Agency pitch', value: 'agency_pitch', origin: 'asked' },
    { id: 'tender_response', label: 'Tender response', value: 'tender_response', origin: 'proposed', source: 'Response to ITT 4417 with scoring criteria' },
    { id: 'investor_seed', label: 'Investor seed deck', value: 'investor_seed', origin: 'asked' },
    { id: 'credentials', label: 'Credentials', value: 'credentials', origin: 'asked' },
  ],
  ...extra,
})

test('DECK_TYPES holds the four ids exactly, each with a label and a one-line use', () => {
  assert.deepEqual(plain(L.DECK_TYPES.map(t => t.id)), ['agency_pitch', 'tender_response', 'investor_seed', 'credentials'])
  for (const t of L.DECK_TYPES) assert.ok(t.label && t.one_line)
})

test('deckTypeOf: answered wins, else the inferred option, else the default and says which', () => {
  const answered = L.deckTypeOf({ intake: { questions: [typeQ()], answers: { q_deck_type: { option_id: 'credentials', at: 't' } } } })
  assert.equal(answered.id, 'credentials'); assert.equal(answered.source, 'answered')
  const inferred = L.deckTypeOf({ intake: { questions: [typeQ()] } })
  assert.equal(inferred.id, 'tender_response'); assert.equal(inferred.source, 'inferred')
  assert.equal(inferred.quote, 'Response to ITT 4417 with scoring criteria')
  const none = L.deckTypeOf({})
  assert.equal(none.id, 'agency_pitch'); assert.equal(none.source, 'default'); assert.equal(none.hasQuestion, false)
  const skipped = L.deckTypeOf({ intake: { questions: [typeQ()], answers: { q_deck_type: { skipped: true, at: 't' } } } })
  assert.equal(skipped.id, 'agency_pitch'); assert.equal(skipped.source, 'default'); assert.equal(skipped.skipped, true)
  assert.equal(L.deckTypeOf({ intake: { answers: { q_deck_type: { option_id: 'nonsense' } } } }).source, 'default')
})

test('typeHints names what to bring for each of the four types', () => {
  assert.match(L.typeHints('tender_response').line, /scoring criteria.*page limit/)
  assert.match(L.typeHints('investor_seed').line, /traction figures.*the ask/)
  assert.match(L.typeHints('credentials').line, /team.*two examples/)
  assert.match(L.typeHints('agency_pitch').line, /brief.*budget/)
  assert.ok(L.typeHints('agency_pitch').line.startsWith('To make this one stronger, bring: '))
  assert.equal(L.typeHints('bogus').type, 'agency_pitch')
})

test('kind is derived from the type: investor_seed is investor, the others agency', () => {
  assert.equal(L.kindOfType('investor_seed'), 'investor')
  for (const t of ['agency_pitch', 'tender_response', 'credentials']) assert.equal(L.kindOfType(t), 'agency')
})

test('builtFrom shows the type when given one, and describeBuiltFrom names it', () => {
  const bf = L.builtFrom({}, {}, [], 'tender_response')
  assert.equal((bf as { type?: string }).type, 'tender_response')
  assert.equal(L.describeBuiltFrom(bf).type, 'Tender response')
  assert.equal('type' in L.builtFrom({}, {}, []), false)
})

test('Start shows the selector with the inferred type highlighted and its quote, escaped', () => {
  const m = mount({ inputs: { prompt: {} }, intake: { questions: [typeQ()] } })
  assert.ok(m.app.innerHTML.includes('What kind of deck?'))
  assert.ok(m.app.innerHTML.includes('Looks like a tender: you wrote &quot;Response to ITT 4417 with scoring criteria&quot;'))
  assert.ok(m.app.innerHTML.includes('To make this one stronger, bring: the buyer'))
  assert.ok(/data-dtype="tender_response" aria-pressed="true"/.test(m.app.innerHTML))
  const bad = mount({ inputs: { prompt: {} }, intake: { questions: [typeQ({ options: [{ id: 'tender_response', label: 'T', value: 'tender_response', origin: 'proposed', source: hostile }] })] } })
  assert.equal(bad.app.innerHTML.includes('<img'), false)
  assert.ok(bad.app.innerHTML.includes('&lt;img'))
})

test('with no type question Start defaults to agency pitch', () => {
  const m = mount({ inputs: { prompt: {} } })
  assert.ok(m.app.innerHTML.includes('Defaults to agency pitch'))
})

test('choosing a type writes only intake.answers.q_deck_type', () => {
  const m = mount({ inputs: { prompt: { text: 'x' } }, intake: { questions: [typeQ()] } })
  m.click({ dtype: 'investor_seed' })
  assert.equal(m.writes.length, 1)
  assert.deepEqual(Object.keys(m.writes[0].obj), ['intake'])
  const answers = (m.writes[0].obj as { intake: { answers: Record<string, { option_id: string; at: string }> } }).intake.answers
  assert.deepEqual(Object.keys(answers), ['q_deck_type'])
  assert.equal(answers.q_deck_type.option_id, 'investor_seed')
  assert.ok(answers.q_deck_type.at)
  assert.equal(JSON.stringify(m.writes[0].obj).includes('"inputs"'), false)
})

test('skipping the type question is allowed and writes a skip', () => {
  const m = mount({ inputs: { prompt: {} }, intake: { questions: [typeQ()] } })
  m.click({ dtskip: '1' })
  const answers = (m.writes[0].obj as { intake: { answers: Record<string, { skipped: boolean }> } }).intake.answers
  assert.equal(answers.q_deck_type.skipped, true)
})

test('Build derives inputs.kind from the chosen type and writes nothing else', () => {
  const data = (id: string) => ({ inputs: { prompt: { text: 'a line' }, kind: 'agency' }, upstream: { d1: briefDoc }, intake: { questions: [typeQ()], answers: { q_deck_type: { option_id: id, at: 't' } } } })
  const inv = mount(data('investor_seed')); inv.click({}, 'build')
  const i1 = (inv.writes[0].obj as { inputs: Record<string, unknown> }).inputs
  assert.equal(i1.kind, 'investor')
  assert.deepEqual(Object.keys(i1).sort(), ['format', 'kind', 'prompt'])
  const ten = mount(data('tender_response')); ten.click({}, 'build')
  assert.equal((ten.writes[0].obj as { inputs: { kind: string } }).inputs.kind, 'agency')
  for (const w of [inv.writes[0], ten.writes[0]]) {
    assert.deepEqual(Object.keys(w.obj), ['inputs'])
    const j = JSON.stringify(w.obj)
    assert.equal(j.includes('"brief"'), false); assert.equal(j.includes('"research"'), false)
  }
})

test('the type question is not repeated in the Check panel', () => {
  const g = L.gapView({ questions: [typeQ(), { id: 'q_b', text: 'Budget?', options: [] }] })
  assert.deepEqual(plain(g.questions.map(q => q.id)), ['q_b'])
})

// RFC 7396 merge, as the store applies a put().
type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v)
function merge(t: unknown, p: unknown): unknown {
  if (!isRec(p)) return p
  const o: Rec = isRec(t) ? { ...t } : {}
  for (const k of Object.keys(p)) { if (p[k] === null) delete o[k]; else o[k] = merge(o[k], p[k]) }
  return o
}
// The shape the two tests below read back out of a merged document.
type Doc = { intake: { answers: Record<string, { skipped?: boolean; option_id?: string }> } }

test('skip then choose leaves one coherent answer, and so does choose then skip', () => {
  const skip = plain(L.typePatch({ intake: { questions: [typeQ()] } }, null, 't1'))
  const pick = plain(L.typePatch({ intake: { questions: [typeQ()] } }, 'tender_response', 't2'))
  const a = merge(merge({ intake: { questions: [typeQ()] } }, skip), pick) as Doc
  assert.equal(a.intake.answers.q_deck_type.skipped, undefined)
  assert.equal(L.deckTypeOf(a).id, 'tender_response'); assert.equal(L.deckTypeOf(a).source, 'answered')
  const b = merge(a, skip) as Doc
  assert.equal(b.intake.answers.q_deck_type.option_id, undefined)
  assert.equal(L.deckTypeOf(b).source, 'default'); assert.equal(L.deckTypeOf(b).skipped, true)
})

test('deckTypeOf checks skipped first, as the engine does', () => {
  const t = L.deckTypeOf({ intake: { questions: [typeQ()], answers: { q_deck_type: { skipped: true, option_id: 'tender_response' } } } })
  assert.equal(t.id, 'agency_pitch'); assert.equal(t.source, 'default')
})

test('Build does not turn an inferred or unanswered type into inputs.kind', () => {
  const base = (answers?: object) => ({ inputs: { prompt: { text: 'a line' }, kind: 'investor' }, upstream: { d1: briefDoc }, intake: { questions: [typeQ()], ...(answers ? { answers } : {}) } })
  for (const d of [base(), base({ q_deck_type: { skipped: true, at: 't' } })]) {
    const m = mount(d); m.click({}, 'build')
    assert.equal((m.writes[0].obj as { inputs: Record<string, unknown> }).inputs.kind, 'investor')
  }
})

test('gapView keeps questions whose ids are Object.prototype names', () => {
  const ids = L.gapView({ questions: [{ id: 'constructor', text: 't' }, { id: 'toString', text: 't' }, { id: 'ok', text: 't' }, { id: 'ok', text: 'dup' }] }).questions.map((q: { id: string }) => q.id)
  assert.deepEqual(plain(ids), ['constructor', 'toString', 'ok'])
})

// ── supply cards and the confirm list (the engine never invents what only the person knows) ──
const supplyQs = [
  { id: 'q_deck_type', text: 'What kind of deck is this?', options: [] },
  { id: 'q_supply_team', text: 'Who would work on this?', kind: 'supply', fills: 'team', allow_text: true, options: [] },
  { id: 'q_supply_credentials', text: 'Which past cases?', kind: 'supply', fills: 'credentials', allow_text: true, options: [] },
  { id: 'q_supply_decision_date', text: 'When will they decide?', kind: 'supply', fills: 'next_step', allow_text: true, options: [] },
]
const ph = (text: string) => ({ kind: 'bullets', items: [{ text, human: true }, { text: text + ' 2', human: true }] })
const slideOf = (type: string, status: string, blocks: unknown[] = []) => ({ type, section: type, title: type + ' title', status, blocks, claims: [], requirements: [] })
const deckWith = (extra: Record<string, unknown> = {}) => ({
  meta: { client: 'Lumen', confirm: [
    { ref: 'slide:team', kind: 'slide', text: 'The team you would work with', why: 'still needs a person', slide: 's02', verified: null },
    { ref: 'prompt:2', kind: 'figure', text: 'We have 12,000 members', why: 'only your own statement supports this figure', slide: 's01', verified: null },
    { ref: 'brief:insight', kind: 'proposal', text: hostile, why: hostile, slide: null, verified: null },
  ], ...extra },
  order: ['s01', 's02', 's03'],
  slides: { s01: slideOf('insight', 'drafted'), s02: slideOf('team', 'needs_human', [ph('Proposed: a person')]), s03: slideOf('next_step', 'needs_human', [ph('Proposed: a date')]) },
})
const runData = (answers: Record<string, unknown> = {}, verified: Record<string, unknown> = {}, deck: unknown = deckWith()) => ({
  inputs: { prompt: { client: 'Lumen', project: 'P', text: 'x' } }, run: { state: 'done', stages: [], gate: null, approvals: {} },
  deck, validation: { errors: 0, to_supply: 4 }, intake: { questions: supplyQs, answers, verified },
})

test('supplyCards are the engine\'s supply questions with the person\'s answer as lines, bullets taken off', () => {
  const cards = L.supplyCards(runData({ q_supply_team: { text: '- Aoife Byrne, Strategy\n2) Cian Doyle, Creative\n\n', at: 't' }, q_supply_credentials: { skipped: true, at: 't' } }))
  assert.deepEqual(plain(cards.map(c => [c.id, c.fills, c.state])), [['q_supply_team', 'team', 'answered'], ['q_supply_credentials', 'credentials', 'skipped'], ['q_supply_decision_date', 'next_step', 'open']])
  assert.deepEqual(plain(cards[0].lines), ['Aoife Byrne, Strategy', 'Cian Doyle, Creative'])
  assert.deepEqual(plain(L.supplyCards({})), [])
})

test('the To supply count falls as supply cards are answered and a skip leaves it', () => {
  assert.equal(L.toSupply(runData()).count, 4)
  const team = { q_supply_team: { text: 'A, B', at: 't' } }
  assert.equal(L.toSupply(runData(team)).count, 4) // the pitch merges credentials into the team slide: both answers fill it
  const both = L.toSupply(runData({ ...team, q_supply_credentials: { text: 'Case', at: 't' } }))
  assert.deepEqual(plain([both.count, both.covered, both.ids]), [2, 2, ['s03']])
  const all = L.toSupply(runData({ ...team, q_supply_credentials: { text: 'Case', at: 't' }, q_supply_decision_date: { text: '12 March', at: 't' } }))
  assert.equal(all.count, 0)
  assert.equal(L.toSupply(runData({ q_supply_decision_date: { skipped: true, at: 't' } })).count, 4)
  const rebuilt = deckWith(); rebuilt.slides.s02.status = 'from_source'
  assert.equal(L.toSupply(runData({}, {}, rebuilt)).ids.length, 1) // a rebuilt deck is read as the engine wrote it
  assert.equal(L.toSupply({}).count, 0)
})

test('the confirm list shows the engine\'s items with the person\'s verify decisions laid over them', () => {
  const c = L.confirmList(runData({}, { 'slide:team': { by: 'human', at: 't1' } }))
  assert.deepEqual(plain([c.total, c.verified, c.open]), [3, 1, 2])
  assert.deepEqual(plain(c.items.map(i => [i.ref, i.kind, i.verified])), [['slide:team', 'slide', { by: 'human', at: 't1' }], ['prompt:2', 'figure', null], ['brief:insight', 'proposal', null]])
  assert.equal(L.confirmList({}).total, 0)
  assert.equal(L.confirmList({ deck: { meta: { confirm: [{ ref: '__proto__', text: 'x' }, { text: 'no ref' }, 'junk', { ref: 'a' }, { ref: 'a' }] } } }).total, 1)
  const old = deckWith(); delete (old.meta as Record<string, unknown>).confirm
  assert.equal(L.confirmList(runData({}, {}, old)).total, 0) // an old deck has no list: nothing is added to it
})

test('a verify decision is { by: human, at } at intake.verified.<ref>, and nothing else', () => {
  assert.deepEqual(plain(L.verifyPatch('doc:agency#p2', 't')), { intake: { verified: { 'doc:agency#p2': { by: 'human', at: 't' } } } })
  assert.equal(L.verifyPatch('', 't'), null)
  assert.equal(L.verifyPatch('__proto__', 't'), null)
  assert.equal(L.verifyPatch('a\nb', 't'), null)
})

test('only verified or supplied items count as sourced', () => {
  const c = L.sourcedCounts(runData({ q_supply_team: { text: 'A', at: 't' } }, { 'prompt:2': { by: 'human', at: 't' } }))
  assert.deepEqual(plain(c), { toSupply: 4, verified: 1, total: 3, open: 2, supplied: 1, sourced: 2 })
  assert.equal(L.sourcedCounts(runData()).sourced, 0)
})

test('Review shows the supply cards and the confirm list, escaped, and Verify writes only intake.verified', () => {
  const m = mount(runData())
  assert.ok(m.app.innerHTML.includes('data-to-supply') && m.app.innerHTML.includes('4 to supply'))
  assert.ok(m.app.innerHTML.includes('Confirm list') && m.app.innerHTML.includes('0 of 3 verified'))
  assert.equal(m.app.innerHTML.includes('<img'), false)
  assert.ok(m.app.innerHTML.includes('&lt;img'))
  assert.equal((m.app.innerHTML.match(/data-supply="/g) || []).length, 3)
  m.click({ verify: 'prompt:2' })
  assert.equal(m.writes.length, 1)
  const w = m.writes[0].obj as { intake: { verified: Record<string, { by: string; at: string }> } }
  assert.deepEqual(Object.keys(w), ['intake'])
  assert.deepEqual(Object.keys(w.intake), ['verified'])
  assert.deepEqual(Object.keys(w.intake.verified), ['prompt:2'])
  assert.equal(w.intake.verified['prompt:2'].by, 'human')
  assert.equal(m.writes[0].action, 'verify prompt:2')
})

test('a verified item shows as verified with no button, and the count follows', () => {
  const m = mount(runData({}, { 'slide:team': { by: 'human', at: 't' } }))
  assert.ok(m.app.innerHTML.includes('1 of 3 verified'))
  assert.equal(m.app.innerHTML.includes('data-verify="slide:team"'), false)
  assert.ok(m.app.innerHTML.includes('data-verify="prompt:2"'))
})

test('saving or skipping a supply card writes at intake.answers.<qid> only, and an empty box writes nothing', () => {
  const box = { value: 'Aoife Byrne, Strategy Director\nCian Doyle, Creative Lead' }
  const m = mount(runData(), undefined, { qt_q_supply_team: box })
  m.click({ qtext: 'q_supply_team' })
  m.click({ qskip: 'q_supply_credentials' })
  assert.equal(m.writes.length, 2)
  const a = (m.writes[0].obj as { intake: { answers: Record<string, { text: string }> } }).intake
  assert.deepEqual(Object.keys(a), ['answers'])
  assert.equal(a.answers.q_supply_team.text, 'Aoife Byrne, Strategy Director\nCian Doyle, Creative Lead')
  assert.equal(m.writes[0].action, 'supply question q_supply_team')
  assert.equal((m.writes[1].obj as { intake: { answers: Record<string, { skipped: boolean }> } }).intake.answers.q_supply_credentials.skipped, true)
  const empty = mount(runData())
  empty.click({ qtext: 'q_supply_team' })
  assert.equal(empty.writes.length, 0)
})

test('an answered supply card shows the person\'s lines, escaped', () => {
  const m = mount(runData({ q_supply_team: { text: hostile + '\nSecond', at: 't' } }))
  assert.ok(m.app.innerHTML.includes('Supplied by you'))
  assert.equal(m.app.innerHTML.includes('<img'), false)
  assert.ok(m.app.innerHTML.includes('&lt;img src=x'))
})

test('an old deck with no supply cards and no confirm list shows neither panel', () => {
  const old = deckWith(); delete (old.meta as Record<string, unknown>).confirm
  const m = mount({ ...runData({}, {}, old), intake: {} })
  assert.equal(m.app.innerHTML.includes('Confirm list'), false)
  assert.equal(m.app.innerHTML.includes('data-supply'), false)
})

test('Present lists the confirm items before Export and says what counts as sourced', () => {
  const m = mount(runData({ q_supply_team: { text: 'A', at: 't' } }))
  m.click({ go: 'present' })
  const h = m.app.innerHTML
  assert.ok(h.indexOf('Confirm list') > -1 && h.indexOf('Confirm list') < h.indexOf('>Export<'))
  assert.ok(h.includes('data-sourced') && h.includes('counted as sourced'))
})
