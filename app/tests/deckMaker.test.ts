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

test('the only inputs are the three prompt fields: nothing can fill a placeholder', () => {
  // Start builds its fields with field(id, …); nothing else in the page is an <input>.
  assert.deepEqual([...html.matchAll(/field\('(\w+)'/g)].map(m => m[1]), ['client', 'project', 'agency'])
  assert.equal(html.match(/<input/gi)?.length, 1)
  assert.equal(html.match(/<textarea/gi)?.length ?? 0, 0)
  assert.equal(html.match(/contenteditable/gi)?.length ?? 0, 0)
})

test('the team-library shelf is off unless the document turns it on', () => {
  assert.match(html, /s\.inputs\.library \|\| !s\.inputs\.library\.enabled/)
})
