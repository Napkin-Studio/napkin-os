// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Deck Maker template: what its screens decide (the pure block, run alone), and
// that its page keeps to the host's rules and the house look.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { parseYaml } from './deckMakerYaml'

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
  approveGate(run: unknown, gate: string | null | undefined, by: string, at: string, choice?: unknown): (Run & { gate: null }) | null
  gateRequest(run: unknown, gate: string, kind: string, by: string, at: string): { decisions: unknown[]; gate_requests: unknown[] } | null
  GATES: Record<string, { body: string; title: string }>
  gateView(run: unknown, pick?: unknown): GateView | null
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
  AGENTS: Record<string, { n: number; name: string; mat: string; role: string; arcs: number[][]; circs: number[][] }>
  ACTIVITY_WORD: Record<string, string>
  circleSvg(opts: unknown): string
  agentState(run: unknown): { agent: string | null; activity: string; word: string; role: string; step_index: number | null; step_total: number | null; handoff: boolean; to: string | null }
  arcPath(cx: number, cy: number, rho: number, a0: number, sweep: number): string
  blend(from: unknown, to: unknown, p?: unknown): string
  runView(run: unknown, deck: unknown): RunView
}
type GateView = {
  id: string; body: string; title: string; lede: string; approve: string; edit_key: string; edit_label: string; hold: string; next: string
  dex: string; dex_proposed: boolean; known: boolean; first_pick: string | null; picked: string | null; asked: string[]
  territories: { id: string; n: string; name: string; thought: string; why: string }[]
  idea: { line: string; basis: string; basis_tone: string; territory: string; executions: { n: string; channel: string; summary: string; tag: string; tone: string }[]; rests_on: { label: string; tone: string }[] } | null
}
type RunRow = { n: string; title: string; sub: string; status: string; pill: string }
type RunView = { kind: string; title: string; lede: string; head: string; grid: boolean; items: RunRow[]; tail: string[]; stage: string; retryable: boolean }
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
  assert.deepEqual(plain(next.approvals.storyline), { by: 'Sai', at: '2026-10-15T10:00:00Z', decision: 'approve' })
  assert.equal(next.stage, 'territories')
  assert.deepEqual(plain((next as unknown as { decisions: unknown }).decisions), [{ gate: 'storyline', kind: 'approve', by: 'Sai', at: '2026-10-15T10:00:00Z' }])
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

// ── the agent circle (features/deck-maker-circle-ui.clan, phase 1) ──────────────
const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]
const used = { brief: 1, research: 2, strategy: 3, idea: 7, copy: 9, deck: 21, review: 23, approval: 24 }

test('the circle carries the eight agents\' geometry, rounded to 3 decimals', () => {
  assert.deepEqual(plain(Object.keys(L.AGENTS).sort()), Object.keys(used).sort())
  for (const [k, n] of Object.entries(used)) {
    const a = L.AGENTS[k]
    assert.equal(a.n, n, k)
    assert.ok(a.arcs.length && a.circs.length, k)
    for (const v of [...a.arcs, ...a.circs].flat()) assert.equal(Math.round(v * 1000) / 1000, v, `${k} ${v}`)
  }
})

test('circleSvg: a flat SVG with role img, the name and state word, the size and data-activity', () => {
  const s = L.circleSvg({ agent: 'strategy', activity: 'human', size: 60 })
  assert.match(s, /^<svg class="cir s60" width="60" height="60" viewBox="-1\.15 -1\.15 2\.3 2\.3" role="img"/)
  assert.match(s, /aria-label="Strategy, Needs you"/)
  assert.match(s, /data-activity="human"/)
  assert.match(s, /data-agent="strategy"/)
  const small = L.circleSvg({ agent: 'idea', activity: 'think', size: 32 })
  assert.match(small, /class="cir s32" width="32" height="32"/)
  assert.match(small, /aria-label="Idea, Thinking"/)
  for (const [act, word] of Object.entries(L.ACTIVITY_WORD)) {
    const x = L.circleSvg({ agent: 'copy', activity: act, size: 60 })
    assert.ok(x.includes(`aria-label="Copy, ${word}"`), act)
    assert.ok(x.includes(`data-activity="${act}"`), act)
  }
  assert.match(L.circleSvg({ agent: 'deck', activity: 'work', size: 60, label: 'Dex' }), /aria-label="Dex, Working"/)
  assert.equal(L.circleSvg({ agent: 'deck', activity: 'work', label: hostile }).includes('<img'), false)
})

test('circleSvg: an unknown agent or activity is a neutral waiting circle, and junk never throws', () => {
  for (const o of [{ agent: 'nobody', activity: 'work' }, { agent: '__proto__' }, { agent: 'constructor', activity: 'human' }, null, undefined, 5, 'x', { activity: 'toString', agent: 'deck', size: -3 }]) {
    const s = L.circleSvg(o)
    assert.match(s, /^<svg class="cir/)
    assert.match(s, /data-activity="waiting"/)
    assert.match(s, /role="img"/)
  }
  assert.match(L.circleSvg({ agent: 'nobody' }), /data-agent="none"[^>]*>/)
  assert.match(L.circleSvg({ agent: 'nobody' }), /aria-label="Agent, Waiting"/)
  assert.match(L.circleSvg({}), /width="60" height="60"/)
})

test('arcPath draws a partial arc with the right flags and a full turn as two halves', () => {
  assert.equal(L.arcPath(0, 0, 1, 0, Math.PI / 2), 'M1 0A1 1 0 0 1 0 1')
  assert.match(L.arcPath(0, 0, 1, 0, 4), /A1 1 0 1 1 /)
  assert.equal((L.arcPath(0, 0, 1, 0, 2 * Math.PI).match(/A/g) || []).length, 2)
})

const stg = (pairs: [string, string][]) => pairs.map(([id, status]) => ({ id, name: id, sub: '', status }))
const all = ['inputs', 'scans', 'storyline', 'territories', 'idea', 'copy', 'check', 'review']
const withNow = (id: string) => stg(all.map(x => [x, all.indexOf(x) < all.indexOf(id) ? 'done' : x === id ? 'now' : 'next'] as [string, string]))

test('agentState: every row of the table', () => {
  const pick = (r: unknown) => { const s = L.agentState(r); return [s.agent, s.activity, s.word] }
  // an open gate always needs a person: the gate's agent, else Strategy for gates 1 and 2, Idea for 3
  assert.deepEqual(plain(pick({ state: 'gate', stages: withNow('storyline'), gate: { id: 'storyline' } })), ['strategy', 'human', 'Needs you'])
  assert.deepEqual(plain(pick({ state: 'gate', stages: withNow('idea'), gate: { id: 'idea' } })), ['idea', 'human', 'Needs you'])
  assert.deepEqual(plain(pick({ state: 'gate', stages: [], gate: { id: 'storyline', agent: 'review' } })), ['review', 'human', 'Needs you'])
  assert.deepEqual(plain(pick({ state: 'gate', stages: [], gate: { id: 'x' }, agent: { key: 'copy', activity: 'write' } })), ['copy', 'human', 'Needs you'])
  // failed is an error, on the failed stage's agent
  assert.deepEqual(plain(pick({ state: 'building', stages: stg([['inputs', 'done'], ['copy', 'failed']]) })), ['copy', 'error', 'Failed, retrying'])
  assert.deepEqual(plain(pick({ state: 'failed', stages: [] })), ['deck', 'error', 'Failed, retrying'])
  // done is complete
  assert.deepEqual(plain(pick({ state: 'done', stages: [] })), ['deck', 'complete', 'Done'])
  // nothing running (no live feed): the stage's agent, waiting
  assert.deepEqual(plain(pick({ state: 'building', stages: withNow('territories'), gate: null })), ['idea', 'waiting', 'Waiting'])
  assert.deepEqual(plain(pick({ state: 'building', stages: withNow('check') })), ['review', 'waiting', 'Waiting'])
  assert.deepEqual(plain(pick({ state: 'draft', stages: [] })), ['brief', 'waiting', 'Waiting'])
  // the server's run.agent names who works and how
  for (const [act, word] of [['work', 'Working'], ['write', 'Writing'], ['think', 'Thinking'], ['read', 'Reading'], ['check', 'Checking']]) {
    assert.deepEqual(plain(pick({ state: 'building', stages: withNow('copy'), agent: { key: 'copy', activity: act } })), ['copy', act, word])
  }
  assert.deepEqual(plain(pick({ state: 'building', stages: [], agent: { key: 'copy' } })), ['copy', 'work', 'Working'])
  const slow = L.agentState({ state: 'building', stages: [], agent: { key: 'idea', activity: 'think', slow: true, step_index: 2, step_total: 4 } })
  assert.equal(slow.word, 'Thinking · taking longer than usual')
  assert.deepEqual(plain([slow.step_index, slow.step_total, slow.role]), [2, 4, 'Opens directions'])
  const ho = L.agentState({ state: 'building', stages: [], agent: { key: 'strategy', activity: 'write', to: 'idea' } })
  assert.deepEqual(plain([ho.agent, ho.activity, ho.word, ho.handoff]), ['strategy', 'handoff', 'Handing off', true])
  // an agent this app does not know: neutral, waiting
  assert.deepEqual(plain(pick({ state: 'building', stages: withNow('copy'), agent: { key: 'dex', activity: 'work' } })), [null, 'waiting', 'Waiting'])
  assert.deepEqual(plain(pick({ state: 'building', stages: [], agent: { key: '__proto__' } })), [null, 'waiting', 'Waiting'])
})

test('agentState never throws on junk', () => {
  for (const r of [null, undefined, 1, 'x', [], { stages: 'x' }, { stages: [null, 1] }, { gate: 5 }, { agent: [] }, { agent: { key: 'idea', step_index: 9, step_total: 2 } }]) {
    const s = L.agentState(r)
    assert.ok(s && typeof s.word === 'string' && s.word.length)
  }
  assert.equal(L.agentState({ agent: { key: 'idea', step_index: 9, step_total: 2 } }).step_index, null)
})

const gateRun = () => ({
  state: 'gate', stage: 'storyline', cost_usd: 1.14, stages: withNow('storyline'), approvals: {},
  gate: {
    id: 'storyline', n: 1, of: 3, dex: 'I put the answer to the brief first.', more_beats: 4,
    beats: [{ n: '01', title: 'First beat', src: 'Brief · objective', basis: 'brief' }],
    checks: [{ ok: true, text: 'Every number traces to a source' }, { ok: false, text: '2 beats need details only you have' }],
  },
})
const buildData = (r: unknown) => ({ inputs: { prompt: { client: 'Lumen', project: 'P', text: 'x' } }, run: r })
const statusCard = (h: string) => /<aside class="stack"><div class="card" style="padding:20px">([\s\S]*?)<div class="rule"><\/div>/.exec(h)?.[1] ?? ''

test('gate 1: the status card shows the 60px circle with the same words, and Dex is a 32px circle', () => {
  const h = mount(buildData(gateRun())).app.innerHTML
  const card = statusCard(h)
  assert.match(card, /<svg class="cir s60" width="60" height="60"[^>]*aria-label="Strategy, Needs you"[^>]*data-activity="human"/)
  assert.ok(card.includes('>Waiting for you<') && card.includes('>Nothing runs until you approve<'))
  assert.match(h, /<div class="dex"><svg class="cir s32" width="32" height="32"[^>]*aria-label="Strategy, Needs you"[^>]*>[\s\S]*?<\/svg><span class="mono" style="font-size:12px">Dex · directs<\/span>/)
  assert.equal(h.includes('class="av"'), false)
  assert.equal(/class="spin"|qspin/.test(h), false)
  // the gate keeps its controls
  for (const want of ['id="approve"', 'data-edit="beats"', 'data-retry="storyline"', 'Approve the storyline', 'Gate 1 of 3', '+ 4 more beats']) assert.ok(h.includes(want), want)
})

test('with no gate the status card shows the waiting circle and still says it waits for the engine', () => {
  const m = mount(buildData(gateRun()))
  m.click({}, 'approve')
  const next = (m.writes[0].obj as { run: unknown }).run
  const h = mount(buildData(next)).app.innerHTML
  const card = statusCard(h)
  assert.match(card, /<svg class="cir s60"[^>]*aria-label="Idea, Waiting"[^>]*data-activity="waiting"/)
  assert.ok(card.includes('>Waiting for the engine<') && card.includes('>Not connected to this document yet<'))
  assert.equal(h.includes('class="dex"'), false)
})

test('the build screens show no percentage and no time range', () => {
  const m = mount(buildData(gateRun()))
  m.click({}, 'approve')
  const runs = [gateRun(), (m.writes[0].obj as { run: unknown }).run, { state: 'building', stages: stg([['inputs', 'done'], ['copy', 'failed']]), gate: null, approvals: {} },
    { state: 'building', stages: withNow('copy'), gate: null, approvals: {}, agent: { key: 'copy', activity: 'write', slow: true } }]
  for (const r of runs) {
    const h = mount(buildData(r)).app.innerHTML
    assert.ok(h.includes('class="cir s60"'))
    assert.equal(/\d\s?%/.test(h), false)
    assert.equal(/\d+\s?(min|sec|hours?)\b/.test(h), false)
  }
})

test('the ring turns only when motion is allowed, and the spinner is gone', () => {
  assert.equal(/MARK_SPIN|qspin|\.spin\{/.test(html), false)
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important/)
  const anims = [...css.matchAll(/animation:cir-turn/g)].map(m => m.index!)
  const block = /@media \(prefers-reduced-motion:no-preference\)\{[\s\S]*?\n\}/.exec(css)!
  assert.ok(anims.length > 0)
  for (const i of anims) assert.ok(i > block.index && i < block.index + block[0].length, 'every turn is inside the no-preference block')
  assert.equal(/data-activity="human"\] \.act\{animation/.test(css), false)
})

test('the ring colours are tokens in light, dark and OS-dark', () => {
  for (const tok of ['--ring-work', '--ring-think', '--ring-read', '--ring-check', '--ring-human', '--ring-error', '--ring-wait', '--ring-track', '--ring-edge']) {
    assert.equal((css.match(new RegExp(`${tok}:`, 'g')) ?? []).length, 3, tok)
    assert.ok(L.circleSvg({ agent: 'deck', activity: 'work' }).includes('var(--ring-track)'))
  }
})

// ── the running Build screen (phase 2): driven by the state fixtures in example/states/ ──────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fx = Record<string, any>
const fixture = (name: string) => parseYaml(readFileSync(new URL(`templates/deck-maker/example/states/${name}.yaml`, root), 'utf8')) as Fx
const RUNNING = ['reading', 'handoff', 'storyline', 'territories', 'slow', 'idea', 'copy', 'deck', 'check']
const rightAside = (h: string) => /<\/section><aside class="stack">([\s\S]*)<\/aside><\/main>/.exec(h)?.[1] ?? ''
const box = (h: string) => /<div class="card cbox[^"]*" data-run="(\w+)">([\s\S]*?)<\/section>/.exec(h)

test('runView: each fixture is the view its name says, and junk never throws', () => {
  for (const n of RUNNING) assert.equal(L.runView(fixture(n).run, fixture(n).deck).kind, 'running', n)
  for (const n of ['gate1', 'gate2', 'gate3']) assert.equal(L.runView(fixture(n).run, fixture(n).deck).kind, 'gate', n)
  assert.equal(L.runView(fixture('failed').run, fixture('failed').deck).kind, 'failed')
  assert.equal(L.runView(fixture('done').run, fixture('done').deck).kind, 'done')
  // with no live feed and no items, nothing reports progress: the engine is not connected
  assert.equal(L.runView({ state: 'building', stages: withNow('copy'), gate: null }, null).kind, 'waiting')
  for (const j of [null, undefined, 5, 'x', [], { stages: 'x' }, { stages: [null, { status: 'now', items: 'x' }] }, { state: 'failed' }, { state: 'done', done: 3 }]) {
    const v = L.runView(j, j)
    assert.ok(v && typeof v.kind === 'string' && Array.isArray(v.items))
  }
})

test('runView: the running stage\'s items are the content box rows, split at " · ", in the stage\'s words', () => {
  const r = L.runView(fixture('reading').run, null)
  assert.deepEqual(plain([r.title, r.head]), ['Reading your inputs', 'What it is reading'])
  assert.deepEqual(plain(r.items.map(x => [x.title, x.status, x.pill])), [
    ['Ballymaloe brief', 'done', 'Read'], ['Ballymaloe research', 'done', 'Read'], ['Image-only pages', 'now', 'Reading now']])
  assert.equal(r.items[2].sub, 'Scanned pages with no text layer')
  const st = L.runView(fixture('storyline').run, null)
  assert.deepEqual(plain(st.items.map(x => x.n)), ['01', '02', '03', '04', '05', '06'])
  assert.deepEqual(plain(st.items.slice(3).map(x => x.pill)), ['Writing now', 'Not yet written', 'Not yet written'])
  assert.equal(L.runView(fixture('check').run, null).items[0].pill, 'Checked')
})

test('runView: the Deck agent builds a grid of slides by their titles, and the appendix line goes under it', () => {
  const f = fixture('deck'), v = L.runView(f.run, f.deck)
  assert.equal(v.grid, true)
  assert.equal(v.title, 'Building the slides')
  assert.equal(v.items.length, 7)
  assert.equal(v.items[4].title, f.deck.slides[f.deck.order[4]].title)
  assert.deepEqual(plain([v.items[4].n, v.items[4].status, v.items[4].pill]), ['05', 'now', 'Building now'])
  assert.deepEqual(plain(v.tail), ['Appendix: 5 slides to follow'])
})

test('runView: slow says nothing is wrong, with no time; a hand-off names who takes over', () => {
  const slow = L.runView(fixture('slow').run, null)
  assert.match(slow.lede, /longer than usual\. Nothing is wrong/)
  const ho = L.runView(fixture('handoff').run, null)
  assert.deepEqual(plain([ho.title, ho.head]), ['Passing the work on', 'Handed over to Strategy'])
  assert.match(ho.lede, /^Brief hands the work to Strategy/)
  assert.equal(ho.items.at(-1)!.pill, 'Passing on')
})

test('runView: a failure shows the failed stage\'s items, the one running marked failed, and whether it retries', () => {
  const f = fixture('failed'), v = L.runView(f.run, f.deck)
  assert.deepEqual(plain([v.title, v.stage, v.retryable, v.lede]), ['Something failed', 'check', true, f.run.error.message])
  assert.deepEqual(plain(v.items.map(x => x.status)), ['done', 'done', 'failed', 'pending', 'pending'])
  assert.equal(v.items[2].pill, 'Failed, retrying')
  const hard = { ...f.run, error: { stage: 'check', message: 'x', retryable: false } }
  assert.equal(L.runView(hard, f.deck).items[2].pill, 'Failed')
  assert.equal(L.agentState(hard).word, 'Failed') // never "retrying" when it will not
  assert.equal(L.agentState(f.run).word, 'Failed, retrying')
})

test('runView: done lists the pitch and appendix slides, then each fact to supply by its slide', () => {
  const f = fixture('done'), v = L.runView(f.run, f.deck)
  assert.deepEqual(plain([v.title, v.lede]), ['The deck is ready for you', 'Seven slides and five appendix slides. Two facts are still to supply.'])
  assert.deepEqual(plain(v.items.map(x => [x.title, x.pill])), [
    ['7 pitch slides', 'Ready'], ['5 appendix slides', 'Ready'], ['Presenter name and role', 'To supply'], ['Split between TV and social', 'To supply']])
  assert.equal(v.items[2].sub, 'Slide 06 · needs a person')
  assert.match(v.items[1].sub, /^Audience \(to confirm\), Competitors/)
  // an old deck with only appendix_count still counts its appendix
  const old = { ...f.deck, appendix_ids: undefined, slides: { ...f.deck.slides } }
  for (const k of Object.keys(old.slides)) if (old.slides[k].appendix) delete old.slides[k]
  assert.equal(L.runView({ state: 'done', stages: [] }, old).items[1].title, '5 appendix slides')
})

test('agentState names who takes over at a hand-off, and only then', () => {
  const ho = L.agentState(fixture('handoff').run)
  assert.deepEqual(plain([ho.agent, ho.to, ho.activity, ho.handoff, ho.word]), ['brief', 'strategy', 'handoff', true, 'Handing off'])
  assert.equal(L.agentState(fixture('storyline').run).to, null)
  assert.equal(L.agentState({ state: 'done', stages: [], agent: { key: 'copy', activity: 'complete', to: 'deck' } }).handoff, false)
})

test('the hand-off circle is a flat blend: both agents, unique clip ids, no gradient', () => {
  const a = L.circleSvg({ agent: 'brief', to: 'strategy', activity: 'handoff', size: 60 })
  const b = L.circleSvg({ agent: 'brief', to: 'strategy', activity: 'handoff', size: 60 })
  assert.match(a, /aria-label="Brief to Strategy, Handing off"/)
  assert.match(a, /data-agent="brief" data-to="strategy" data-activity="handoff"/)
  assert.equal(/Gradient/.test(a), false)
  const ids = (s: string) => [...s.matchAll(/<clipPath id="([^"]+)"/g)].map(m => m[1])
  assert.equal(ids(a).length, 2)
  assert.equal(new Set([...ids(a), ...ids(b)]).size, 4, 'two circles on one page never share a clip id')
  for (const id of ids(a)) assert.ok(a.includes(`clip-path="url(#${id})"`))
  assert.ok(a.includes('#242936') && a.includes('#EEECE7'), 'Strategy graphite below, Brief pearl above')
  // the front sits at p; junk p is the middle; no "to", or the same agent, is the plain circle
  assert.match(L.blend('brief', 'strategy', 1), /<clipPath id="[^"]+b"><rect x="-1.2" y="-1"/)
  assert.match(L.blend('brief', 'strategy', 'x'), /<line x1="-1" y1="0"/)
  assert.equal(/clipPath/.test(L.circleSvg({ agent: 'brief', activity: 'handoff' })), false)
  assert.equal(/clipPath/.test(L.circleSvg({ agent: 'brief', to: 'brief', activity: 'handoff' })), false)
  assert.equal(/clipPath/.test(L.circleSvg({ agent: 'brief', to: 'strategy', activity: 'work' })), false)
})

for (const n of RUNNING) {
  test(`Build, ${n}: the status card comes first, then the content box shows what is being done`, () => {
    const f = fixture(n), h = mount(f).app.innerHTML, who = L.agentState(f.run)
    const aside = rightAside(h)
    assert.ok(aside.startsWith('<div class="card status"'), 'the status card is first')
    assert.match(aside, new RegExp(`^<div class="card status" style="padding:20px" data-status="${who.activity}"><div[^>]*><svg class="cir s60" width="60" height="60"[^>]*role="img" aria-label="[^"]+, ${who.word}"`))
    assert.ok(aside.includes(`<div class="sword">${who.word}</div>`), 'the state word is text, not colour alone')
    assert.ok(aside.includes(`Step ${f.run.agent.step_index} of 7`))
    assert.ok(aside.includes('Checked so far'))
    const b = box(h)!
    assert.equal(b[1], 'running')
    const items = f.run.stages.find((s: Fx) => s.status === 'now').items.filter((x: Fx) => !/^Appendix/.test(x.text))
    assert.equal((b[2].match(/class="(crow|cslide) /g) || []).length, items.length)
    assert.equal((b[2].match(/class="mk now"|class="cslide now"/g) || []).length, 1, 'one thing is being done now')
    assert.equal(/\d\s?%/.test(h), false)
    assert.equal(/\d+\s?(min|sec|hours?)\b/i.test(h), false)
    assert.equal(h.includes('Waiting for the engine'), false)
    assert.equal(h.includes('class="dex"'), false)
  })
}

test('Build, hand-off: the card names both agents over one blended circle', () => {
  const h = mount(fixture('handoff')).app.innerHTML
  const aside = rightAside(h)
  assert.ok(aside.includes('>Brief → Strategy<') && aside.includes('Shapes the ask → Builds territories'))
  assert.match(aside, /aria-label="Brief to Strategy, Handing off"/)
  assert.ok(h.includes('<h1 class="sm" style="margin-bottom:6px">Passing the work on</h1>'))
})

test('Build, slow: the state word says it takes longer, the line says nothing is wrong', () => {
  const h = mount(fixture('slow')).app.innerHTML
  assert.ok(rightAside(h).includes('<div class="sword">Writing · taking longer than usual</div>'))
  assert.ok(h.includes('Nothing is wrong'))
})

test('Build, deck: a grid of slides with the one being built marked, and the appendix line under it', () => {
  const b = box(mount(fixture('deck')).app.innerHTML)!
  assert.equal((b[2].match(/class="cslide /g) || []).length, 7)
  assert.ok(b[2].includes('class="cslide now"') && b[2].includes('Building now'))
  assert.ok(b[2].includes('<div class="ctail">Appendix: 5 slides to follow</div>'))
})

test('Build, failed: a failed run opens on Build with the failure, the failed row and a retry that writes nothing', () => {
  const f = fixture('failed'), m = mount(f), h = m.app.innerHTML
  assert.ok(h.includes('aria-current="step">Build<'), 'failed routes to Build, not Start')
  assert.ok(h.includes('>Something failed</h1>') && h.includes(f.run.error.message))
  assert.match(rightAside(h), /data-status="error"[\s\S]*aria-label="Review, Failed, retrying"/)
  assert.ok(rightAside(h).includes('<div class="sword err">Failed, retrying</div>'))
  const b = box(h)!
  assert.equal(b[1], 'failed')
  assert.ok(b[2].includes('class="crow failed"') && b[2].includes('<span class="pill fail">Failed, retrying</span>'))
  assert.match(h, /<button class="btn big" [^>]*data-retry="check">Try again now<\/button>/)
  assert.ok(h.includes('<span class="ring failed" aria-hidden="true">!</span>'), 'the stage list marks the failed stage')
  m.click({ retry: 'check' })
  assert.equal(m.writes.length, 0)
  assert.match(m.toastEl.textContent, /Retrying a step needs the engine server/)
})

test('Build, done: the deck is ready, what to supply is listed, and Open the deck goes to Review', () => {
  const m = mount(fixture('done'))
  assert.ok(m.app.innerHTML.includes('aria-current="step">Review<'), 'done still opens on Review')
  m.click({ go: 'build' })
  const h = m.app.innerHTML
  assert.ok(h.includes('>The deck is ready for you</h1>'))
  assert.match(rightAside(h), /data-status="complete"[\s\S]*aria-label="Review, Done"/)
  assert.ok(rightAside(h).includes('<div class="sword ok">Done</div>'))
  const b = box(h)!
  assert.equal(b[1], 'done')
  assert.equal((b[2].match(/class="crow supply"/g) || []).length, 2)
  assert.match(h, /<button class="btn go big" data-go="review">Open the deck<\/button>/)
  m.click({ go: 'review' })
  assert.ok(m.app.innerHTML.includes('<main class="review">'))
})

test('the running views keep every button a big target and every word escaped', () => {
  for (const n of [...RUNNING, 'failed']) {
    const h = mount(fixture(n)).app.innerHTML
    for (const btn of h.match(/<button class="[^"]*"[^>]*data-(retry|go)="(check|review)"/g) || []) assert.match(btn, /btn[^"]*big/)
  }
  const f = fixture('reading')
  f.run.stages[1].items[2].text = hostile + ' · ' + hostile
  const h = mount(f).app.innerHTML
  assert.equal(h.includes('<img'), false)
  assert.ok(h.includes('&lt;img'))
})

test('the gate 1 fixture keeps the gate view, with no content box', () => {
  const h = mount(fixture('gate1')).app.innerHTML
  assert.equal(box(h), null)
  assert.ok(h.includes('id="approve"') && h.includes('>Waiting for you<') && h.includes('Approve the storyline'))
})

// ── gates 2 and 3 (phase 3): the gate registry, the territory pick, the idea, and what the person decided ──────────
type Write = { run: Fx }
const at = '2026-11-03T11:00:00Z'

test('gateView: the registry gives each gate its words and body, and never assumes beats', () => {
  assert.deepEqual(plain(Object.keys(L.GATES)), ['storyline', 'territories', 'idea'])
  const g1 = L.gateView(fixture('gate1').run)!, g2 = L.gateView(fixture('gate2').run)!, g3 = L.gateView(fixture('gate3').run)!
  assert.deepEqual(plain([g1.body, g1.title, g1.approve, g1.edit_key, g1.dex_proposed]), ['beats', 'Approve the storyline', 'Approve and continue', 'beats', false])
  assert.deepEqual(plain([g2.body, g2.title, g2.approve, g2.edit_key, g2.hold, g2.dex_proposed]), ['territories', 'Pick a territory', 'Pick this territory', 'territories', 'Nothing runs until you pick', true])
  assert.deepEqual(plain([g3.body, g3.title, g3.approve, g3.edit_key, g3.edit_label, g3.dex_proposed]), ['idea', 'Approve the idea', 'Approve and continue', 'idea', 'Edit the idea', true])
  assert.equal(L.gateView({ gate: null }), null)
  // a gate this app has no words for: generic words, and the body its data carries
  const other = L.gateView({ gate: { id: 'budget', n: 4, of: 4 } })!
  assert.deepEqual(plain([other.known, other.body, other.title]), [false, 'none', 'A step needs you'])
  assert.equal(L.gateView({ gate: { id: 'budget', beats: [] } })!.body, 'beats')
  for (const j of [{ gate: 5 }, { gate: [] }, { gate: { id: 5 } }, { gate: { id: 'territories', territories: 'x' } }, { gate: { id: 'idea', idea: [] } }, { gate: { id: 'idea', idea: { executions: [null, 3], rests_on: 'x' } } }]) {
    const v = L.gateView(j)
    assert.ok(v === null || typeof v.title === 'string')
  }
})

test('gateView, gate 2: three territories, the judge\'s first pick marked and picked until the person picks another', () => {
  const r = fixture('gate2').run, v = L.gateView(r)!
  assert.deepEqual(plain(v.territories.map(t => [t.id, t.n, t.name])), [['t1', '01', 'The one small thing'], ['t2', '02', 'Tried, not fussed'], ['t3', '03', 'Not your mum\'s cupboard']])
  assert.deepEqual(plain([v.first_pick, v.picked]), ['t1', 't1'])
  assert.equal(L.gateView(r, 't3')!.picked, 't3')
  assert.equal(L.gateView(r, 'nope')!.picked, 't1', 'a pick that is not one of them does not count')
  assert.equal(L.gateView({ gate: { ...r.gate, picked: 't2' } }, null)!.picked, 't2')
  assert.equal(L.gateView({ gate: { ...r.gate, first_pick: 'zz' } })!.picked, null, 'no judge pick, nothing picked')
  assert.match(v.lede, /^Three territories are written\. A second model judged them/)
  assert.equal(L.gateView({ gate: { id: 'territories', territories: [{ id: 'a', name: 'A' }] } })!.lede.startsWith('One territory is written.'), true)
  // an entry without an id or a name, or a repeated id, is left out
  const junk = L.gateView({ gate: { id: 'territories', territories: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }, { name: 'C' }, { id: 'b' }, null] } })!
  assert.deepEqual(plain(junk.territories.map(t => t.id)), ['a'])
})

test('gateView, gate 3: the idea line, its work for each channel, what it rests on, from the territory picked', () => {
  const v = L.gateView(fixture('gate3').run)!
  const x = v.idea!
  assert.deepEqual(plain([x.line, x.basis, x.basis_tone]), ['Tuesday\'s tea, but you tried.', 'Our proposal', 'warn'])
  assert.deepEqual(plain(x.executions.map(e => [e.n, e.channel, e.tag, e.tone])), [['01', '30s TV', 'Our proposal', 'warn'], ['02', 'Social', 'Our proposal', 'warn'], ['03', 'To confirm', 'To confirm', 'warn']])
  assert.deepEqual(plain(x.rests_on.map(r => r.tone)), ['ok', 'warn', 'warn'])
  assert.equal(v.lede, 'Approve the idea (our proposal). One idea and the work that carries it, from the territory you picked: The one small thing.')
  const withList = { gate: { ...fixture('gate3').run.gate, territories: fixture('gate2').run.gate.territories } }
  assert.match(L.gateView(withList)!.lede, /from territory 1, The one small thing\.$/)
  const bare = { gate: { id: 'idea', idea: { line: 'L', basis: 'brief', executions: [{ channel: 'TV', summary: 's', tag: 'From brief' }] } } }
  const b = L.gateView(bare)!
  assert.equal(b.lede, 'Approve the idea. One idea and the work that carries it, from the territory you picked.')
  assert.deepEqual(plain([b.idea!.basis_tone, b.idea!.executions[0].tone, b.idea!.executions[0].n]), ['ok', 'ok', '01'])
})

test('approveGate at gate 2 records the pick and the decision; a pick that is not offered is refused', () => {
  const r = fixture('gate2').run
  const next = L.approveGate(r, 'territories', 'Sai', at, { picked: 't2' }) as unknown as Fx
  assert.deepEqual(plain(next.approvals.territories), { by: 'Sai', at, decision: 'approve', picked: 't2' })
  assert.deepEqual(plain(next.approvals.storyline), plain(r.approvals.storyline), 'earlier approvals are kept')
  assert.deepEqual(plain(next.decisions.map((d: Fx) => [d.gate, d.kind])), [['storyline', 'approve'], ['territories', 'approve']])
  assert.deepEqual(plain([next.gate, next.stage, next.agent]), [null, 'idea', null])
  assert.equal(next.stages.find((s: Fx) => s.id === 'idea').status, 'now')
  assert.equal(L.approveGate(r, 'territories', 'Sai', at, { picked: 'zz' }), null)
  assert.equal((L.approveGate(r, 'territories', 'Sai', at) as unknown as Fx).approvals.territories.picked, 't1', 'no choice: the judge\'s first pick')
  assert.equal(L.approveGate(r, 'idea', 'Sai', at), null, 'only the open gate')
  assert.equal(r.decisions.length, 1, 'the old run is not changed')
  const n3 = L.approveGate(fixture('gate3').run, 'idea', 'Sai', at, { note: ' keep the tone ' }) as unknown as Fx
  assert.deepEqual(plain(n3.approvals.idea), { by: 'Sai', at, decision: 'approve', note: 'keep the tone' })
  assert.deepEqual(plain([n3.stage, n3.decisions.length]), ['copy', 3])
})

test('gateRequest: an edit or a retry at the open gate is recorded, waiting, and launches nothing', () => {
  const r = fixture('gate2').run
  const q = L.gateRequest(r, 'territories', 'edit', 'Sai', at)!
  assert.deepEqual(plain(q.gate_requests), [{ gate: 'territories', kind: 'edit', at, status: 'waiting' }])
  assert.deepEqual(plain(q.decisions.at(-1)), { gate: 'territories', kind: 'edit', by: 'Sai', at })
  assert.equal(q.decisions.length, 2)
  assert.deepEqual(plain(Object.keys(q).sort()), ['decisions', 'gate_requests'], 'nothing else in the run is written')
  assert.equal(L.gateRequest(r, 'idea', 'retry', 'Sai', at), null)
  assert.equal(L.gateRequest(r, 'territories', 'approve', 'Sai', at), null)
  assert.equal(L.gateRequest(null, 'territories', 'edit', 'Sai', at), null)
  assert.equal(L.gateView({ ...r, gate_requests: q.gate_requests })!.asked[0], 'edit')
})

test('Build, gate 2: three territory buttons, the first pick marked and pressed, Pick / Edit / Ask Dex', () => {
  const h = mount(fixture('gate2')).app.innerHTML
  assert.equal(box(h), null, 'a gate, not a content box')
  assert.ok(h.includes('<h1 class="sm" style="margin-bottom:6px">Pick a territory</h1>') && h.includes('Gate 2 of 3'))
  assert.equal((h.match(/<button class="beat terr" data-territory="t\d"/g) || []).length, 3)
  assert.equal((h.match(/aria-pressed="true"/g) || []).length, 1)
  assert.ok(h.includes('data-territory="t1" aria-pressed="true"'))
  assert.equal((h.match(/Blind judge’s first pick/g) || []).length, 1)
  assert.ok(h.includes('<b>Why it fits:</b> it is the brief'))
  assert.match(h, /<button class="btn go big" id="approve">Pick this territory<\/button>/)
  assert.ok(h.includes('data-edit="territories">Edit a territory<') && h.includes('data-retry="territories">Ask Dex to try again<'))
  // Dex's note sits beside the Strategy circle and is marked as proposed
  assert.match(h, /<div class="dex"><svg class="cir s32"[^>]*aria-label="Strategy, Needs you"[\s\S]*?<span class="pill plain dexp"[^>]*>Proposed<\/span><\/div>/)
  const aside = rightAside(h)
  assert.match(aside, /aria-label="Strategy, Needs you"/)
  assert.ok(aside.includes('>Waiting for you<') && aside.includes('>Nothing runs until you pick<') && aside.includes('developed from the territory you pick'))
  assert.ok(aside.includes('Checked so far') && aside.includes('All 3 mandatories are still to confirm'))
  assert.equal(/\d\s?%/.test(h), false)
  assert.equal(/\d+\s?(min|sec|hours?)\b/i.test(h), false)
})

test('Build, gate 2: picking is view state; Pick this territory writes the pick, the approval and the decision', () => {
  const m = mount(fixture('gate2'))
  m.click({ territory: 't3' })
  assert.equal(m.writes.length, 0, 'picking writes nothing')
  assert.ok(m.app.innerHTML.includes('data-territory="t3" aria-pressed="true"'))
  assert.ok(m.app.innerHTML.includes('data-territory="t1" aria-pressed="false"'))
  m.click({}, 'approve')
  assert.equal(m.writes.length, 1)
  assert.equal(m.writes[0].action, 'approve territories')
  const w = (m.writes[0].obj as Write).run
  assert.deepEqual(plain(w.approvals.territories), { by: 'You', at: w.approvals.territories.at, decision: 'approve', picked: 't3' })
  assert.deepEqual(plain(w.decisions.at(-1).kind), 'approve')
  assert.equal(w.gate, null)
  // the next screen, from what was written: the idea stage is next, waiting for the engine
  const h = mount({ ...fixture('gate2'), run: { ...fixture('gate2').run, ...w } }).app.innerHTML
  assert.ok(h.includes('<span class="ring now" aria-hidden="true">•</span><div><b>One idea and its work</b>'))
})

test('Build, gate 2: with no pick Pick this territory is off and says so', () => {
  const f = fixture('gate2')
  f.run.gate.first_pick = undefined
  const m = mount(f)
  assert.match(m.app.innerHTML, /<button class="btn go big" id="approve" disabled>Pick this territory<\/button>/)
  assert.ok(m.app.innerHTML.includes('Pick a territory first.'))
  m.click({}, 'approve')
  assert.equal(m.writes.length, 0)
  m.click({ territory: 't2' })
  assert.match(m.app.innerHTML, /id="approve">Pick this territory</)
  m.click({}, 'approve')
  assert.equal((m.writes[0].obj as Write).run.approvals.territories.picked, 't2')
})

test('Build, gate 3: the idea line, three executions, what it rests on, Approve / Edit the idea / Ask Dex', () => {
  const m = mount(fixture('gate3')), h = m.app.innerHTML
  assert.ok(h.includes('<h1 class="sm" style="margin-bottom:6px">Approve the idea</h1>') && h.includes('Gate 3 of 3'))
  assert.ok(h.includes('from the territory you picked: The one small thing.'))
  assert.ok(h.includes('<div class="il">Tuesday&#39;s tea, but you tried.</div></div><span class="pill warn">Our proposal</span>'))
  assert.equal((h.match(/<div class="ex">/g) || []).length, 3)
  assert.ok(h.includes('<span class="pill warn">To confirm</span>'))
  assert.ok(h.includes('<div class="rests"><div class="eyebrow">What the idea rests on</div>'))
  assert.equal((h.match(/<span class="chip (ok|warn)">/g) || []).length, 3)
  assert.ok(h.includes('data-edit="idea">Edit the idea<') && h.includes('data-retry="idea">Ask Dex to try again<'))
  assert.ok(h.includes('Every approve, edit or retry is recorded with who did it.'))
  assert.match(h, /<div class="dex"><svg class="cir s32"[^>]*aria-label="Idea, Needs you"/)
  assert.match(rightAside(h), /aria-label="Idea, Needs you"[\s\S]*>Nothing runs until you approve<[\s\S]*Copy, Deck and Review/)
  m.click({}, 'approve')
  const w = (m.writes[0].obj as Write).run
  assert.equal(m.writes[0].action, 'approve idea')
  assert.deepEqual(plain([w.approvals.idea.decision, 'picked' in w.approvals.idea, w.stage, w.decisions.length]), ['approve', false, 'copy', 3])
})

test('Edit and Ask Dex at any gate record a request and say it waits; the gate then shows it', () => {
  for (const [name, edit, gate] of [['gate1', 'beats', 'storyline'], ['gate2', 'territories', 'territories'], ['gate3', 'idea', 'idea']]) {
    const m = mount(fixture(name))
    m.click({ edit })
    m.click({ retry: gate })
    assert.deepEqual(plain(m.writes.map(w => w.action)), [`edit ${gate}`, `retry ${gate}`], name)
    const w = (m.writes[0].obj as Write).run
    assert.deepEqual(plain(Object.keys(w).sort()), ['decisions', 'gate_requests'])
    assert.equal(w.gate_requests.at(-1).status, 'waiting')
    assert.match(m.toastEl.textContent, /^Recorded\. Editing and retrying a gate need the engine server/)
    const f = fixture(name)
    f.run.gate_requests = [{ gate, kind: 'edit', at, status: 'waiting' }]
    assert.ok(mount(f).app.innerHTML.includes('data-asked>You asked for an edit. It waits for the engine'))
  }
})

test('every gate fixture renders, and a gate with no body data does not throw', () => {
  for (const n of ['gate1', 'gate2', 'gate3']) assert.ok(mount(fixture(n)).app.innerHTML.includes('id="approve"'), n)
  for (const gate of [{ id: 'storyline', n: 1, of: 3 }, { id: 'territories', n: 2, of: 3 }, { id: 'idea', n: 3, of: 3, idea: 'x' }, { id: 'budget', n: 4, of: 4, checks: [null, 5] }]) {
    const f = fixture('gate1')
    f.run.gate = gate
    const h = mount(f).app.innerHTML
    assert.ok(h.includes('id="approve"'), gate.id)
  }
  const f = fixture('gate1')
  f.run.gate = { id: 'budget', n: 4, of: 4 }
  assert.ok(mount(f).app.innerHTML.includes('Nothing to show for this gate yet.'))
})

test('gates 2 and 3 escape every word the runner wrote', () => {
  const f2 = fixture('gate2'), f3 = fixture('gate3')
  Object.assign(f2.run.gate.territories[0], { name: hostile, thought: hostile, why: hostile })
  f2.run.gate.dex = hostile
  Object.assign(f3.run.gate.idea, { line: hostile, territory_name: hostile })
  Object.assign(f3.run.gate.idea.executions[0], { channel: hostile, summary: hostile, tag: hostile })
  f3.run.gate.idea.rests_on[0].label = hostile
  for (const f of [f2, f3]) {
    const h = mount(f).app.innerHTML
    assert.equal(h.includes('<img'), false)
    assert.ok(h.includes('&lt;img'))
  }
})

test('a territory button is a big target and its pick shows in tokens only', () => {
  assert.match(css, /\.terr\{[^}]*min-height:44px/)
  assert.match(css, /\.terr\[aria-pressed="true"\]\{background:var\(--tool-soft\)/)
})

// ── gate 1 stays byte-identical (phase 3 adds gates 2 and 3 beside it) ──────────────────────
// The golden is the markup gate 1 rendered before the gate registry. Regenerate it only for an intended change to
// gate 1: DM_WRITE_GOLDEN=1 npm test, then review the diff of deckMakerGate1.golden.html.
test('gate 1 renders byte-identical markup: the sample, the gate1 fixture and a bare gate', () => {
  const golden = new URL('tests/deckMakerGate1.golden.html', root)
  const sample = parseYaml(readFileSync(new URL('templates/deck-maker/example/data.yaml', root), 'utf8')) as Fx
  const got = [
    '<!-- example/data.yaml -->', mount(sample).app.innerHTML,
    '<!-- example/states/gate1.yaml -->', mount(fixture('gate1')).app.innerHTML,
    '<!-- a bare gate 1 (gateRun) -->', mount(buildData(gateRun())).app.innerHTML, '',
  ].join('\n')
  if (process.env.DM_WRITE_GOLDEN) writeFileSync(golden, got)
  assert.equal(got, readFileSync(golden, 'utf8'))
})

// ── every screen before Review stays byte-identical (phase 4 changes only Review and Present) ──────────────
// The golden is Start and every Build state as phases 0 to 3 left them. Regenerate it only for an intended change
// to those screens: DM_WRITE_GOLDEN=1 npm test, then review the diff of deckMakerEarlier.golden.html.
test('Start and every Build state render byte-identical markup', () => {
  const golden = new URL('tests/deckMakerEarlier.golden.html', root)
  const sample = parseYaml(readFileSync(new URL('templates/deck-maker/example/data.yaml', root), 'utf8')) as Fx
  const start = mount(sample)
  start.click({ go: 'start' })
  const done = mount(fixture('done'))
  done.click({ go: 'build' })
  const got = ['<!-- example/data.yaml, Start -->', start.app.innerHTML]
  for (const n of ['reading', 'handoff', 'storyline', 'territories', 'slow', 'gate2', 'idea', 'gate3', 'copy', 'deck', 'check', 'failed']) {
    got.push(`<!-- example/states/${n}.yaml -->`, mount(fixture(n)).app.innerHTML)
  }
  got.push('<!-- example/states/done.yaml, Build -->', done.app.innerHTML, '')
  if (process.env.DM_WRITE_GOLDEN) writeFileSync(golden, got.join('\n'))
  assert.equal(got.join('\n'), readFileSync(golden, 'utf8'))
})
