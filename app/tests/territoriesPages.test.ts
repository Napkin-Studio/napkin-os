// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Territories page problems the live walk found (feature territories): what the Booth says while the crew runs, the "to confirm" tag on a
// trail, moving to Explore with progress, look-ups on Greenlight, and the shell's exploration cards and dial slice.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dial } from '../src/shell/nui/Dial.tsx'
import { explorationSub, territoryCount } from '../src/shell/nui/territoryCounts.ts'
import { ToolPage } from '../src/shell/landing/ToolPage.tsx'
import { toolById } from '../src/shell/landing/tools.ts'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/territories/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const block = (id: string) => new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html)![1]
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const helper = /<script>([\s\S]*?var NapkinSource[\s\S]*?)<\/script>/.exec(readFileSync(new URL('templates/shared/source-card.html', root), 'utf8'))![1]
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const L = vm.runInNewContext(`${engine}${helper}\n${block('territories-logic')};\n${block('territories-lookups-logic')}; ({ ...TerritoriesLogic, K: TerritoriesLookups })`) as { view(d: Doc, ui?: Doc): string; K: { box(d: Doc, ui: Doc): string; why(ui: Doc): string } }
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc
const plain = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const booth = (h: string) => plain(/<aside class="booth-col[\s\S]*?<\/aside>/.exec(h)![0])

/** Pick approved, the engine not yet written anything: the crew is out. */
function approved(): Doc {
  const d = json('example/states/pick.json')
  d.run = { ...d.run, approvals: { pick: { by: 'Shrey', at: '2026-11-24T10:00:00Z', decision: 'approve', note: '2 insights ticked' } }, decisions: [{ gate: 'pick', kind: 'approve', by: 'Shrey', at: '2026-11-24T10:00:00Z' }] }
  return d
}

test('1. on Pick with the crew out, the Booth says what is happening, not "Tick the insights"', () => {
  const sent = booth(L.view(approved(), { view: 0 }))
  assert.doesNotMatch(sent, /Tick the insights|Tick what the crew/)
  assert.match(sent, /You picked\. Waiting for the engine to send the crew out/)
  const out = booth(L.view(approved(), { view: 0, job: { state: 'running', progress: { done: 1, total: 5 } } }))
  assert.doesNotMatch(out, /Tick the insights|Tick what the crew/)
  assert.match(out, /The crew is out: 1 of 5 agents back/)
  assert.doesNotMatch(plain(L.view(approved(), { view: 0 })), /Tick the insights the crew should work on/, 'the heading line too')
})

test('3. the page moves to Explore while the crew is out, and shows its progress there', () => {
  // territories-redesign: while the crew is out the page is the stage (Brief's pattern), the agent big, one lane per member from job.crew
  const page = L.view(approved(), { job: { state: 'running', progress: { done: 2, total: 5 } } })
  assert.match(page, /aria-current="step"[^>]*><i>2<\/i>/)
  assert.match(page, /class="aglbox"/); assert.match(page, /class="apill" role="listitem" aria-current="step"><span class="mdot"><\/span>1\. Explore/)
  assert.match(plain(page), /2 of 5 agents back · usually 2 to 3 minutes/, 'the job\'s progress, while the job has no lanes yet')
  assert.doesNotMatch(page, /class="booth-col/, 'no Booth on the stage')
  const crew = [{ id: 'cr_core', name: 'Close to the core', short: 'Core', role: 'strategy', colour: '#8C8577', heading: 'Stay on the proposition.', state: 'back', routes: 3 },
    { id: 'cr_feel', name: 'Towards a feeling', short: 'Feeling', role: 'idea', colour: '#E07A5F', heading: 'Go towards the feeling.', state: 'out', routes: 0 },
    { id: 'cr_opposite', name: 'The opposite pole', short: 'Opposite', role: 'copy', colour: '#3D5AFE', heading: 'Go the other way.', state: 'stopped', routes: 0 }]
  const lanes = L.view(approved(), { job: { state: 'running', crew } })
  assert.equal((lanes.match(/class="lc /g) ?? []).length, 3)
  assert.match(plain(lanes), /Core Strategy Back · 3 routes/); assert.match(plain(lanes), /Feeling Idea Exploring…/); assert.match(plain(lanes), /Opposite Copy Stopped/)
  assert.match(plain(lanes), /2 of 3 agents back/); assert.match(plain(lanes), /Idea agent · Towards a feeling/, 'the agent still out is the one on stage')
  const early = plain(L.view(approved(), { job: { state: 'sending' } }))
  assert.match(early, /The crew is setting off/)
  const failed = L.view(approved(), { job: { state: 'failed', error: 'The model took too long.', crewRun: true } })
  assert.match(plain(failed), /The crew stopped before it was back/); assert.match(plain(failed), /The model took too long\. Your pick is saved/); assert.match(failed, /data-act="retry"/)
  assert.match(plain(L.view(approved(), { job: { state: 'failed', crewRun: true }, view: 0 })), /Step 1 of 3 · Pick/, 'Back to your pick shows the sheet; the job is left as it is')
  assert.match(plain(L.view(approved(), {})), /Step 1 of 3 · /, 'with no job running it stays on Pick')
})

test('2. a trail node from the brief shows "to confirm" as a small tag, not the prefix', () => {
  const d = json('example/states/explore_back.json')
  d.crew[0].way = undefined
  const ex = d.expeditions.find((e: Doc) => e.crew === d.crew[0].id) ?? d.expeditions[0]
  ex.way = [{ at: 0.1, cite: 'brief:budget', text: 'To confirm: the budget is about 20k' }]
  const page = L.view(d, { sel: ex.crew })
  assert.doesNotMatch(plain(page), /To confirm:/i)
  assert.match(page, /<span class="grow">the budget is about 20k <span class="tbc"[^>]*>to confirm<\/span>/)
  assert.doesNotMatch(page, /<title>To confirm:/i)
})

const GREEN = 'ie.napkin.territories'
const item = (over: Record<string, unknown> = {}) => ({
  path: 'd1', app_id: GREEN, title: 'Harbour', updated_at: new Date(Date.now() - 28 * 60000).toISOString(), client: { id: 'c', name: 'C' },
  state: { needs_you: 1, locked: false }, run: null, last_editor: '84c0308b-22c6-45ed-ad25-5e023465021a', ...over,
})

test('5. an exploration card says its routes and greenlit count and when it was edited, never a raw id', () => {
  assert.deepEqual(territoryCount(JSON.stringify({ territories: [{ status: 'live' }, { status: 'live' }, { status: 'killed' }], greenlit: ['a'] })), { routes: 2, greenlit: 1 })
  assert.deepEqual(territoryCount('title: x\nterritories:\n  - id: t1\n    status: live\n  - id: t2\n    status: killed\n  - id: t3\n    name: z\ngreenlit:\n  - t1\n  - t3\nrun:\n  state: done\n'), { routes: 2, greenlit: 2 })
  assert.deepEqual(territoryCount('territories: []\ngreenlit: []\n'), { routes: 0, greenlit: 0 })
  assert.match(explorationSub({ routes: 7, greenlit: 2 }, '28m ago'), /^7 routes · 2 greenlit · edited 28m ago$/)
  assert.match(explorationSub({ routes: 1, greenlit: 0 }, 'just now'), /^1 route · edited just now$/)
  const tool = toolById('territories')!
  const out = renderToStaticMarkup(createElement(ToolPage, {
    client: { id: 'c', name: 'C', initials: 'C', material: 'pearl', owner: 'h', created_at: '2026-11-01T00:00:00Z' }, tool, items: [item()],
    onNew: () => {}, onOpenItem: () => {}, onBack: () => {}, counts: { d1: { routes: 7, greenlit: 2 } },
  } as never))
  assert.doesNotMatch(out, /84c0308b/)
  assert.match(out, /Needs your call · 7 routes · 2 greenlit · edited 28m ago/)
})

test('6. the Territories slice of the dial says its count, with what needs you as a small mark', () => {
  const c = { id: 'cli_00000001', name: 'Client Alpha', sector: null, look: { cl: '#DA291C', ink: '#FFC72C' } }
  const its = [item({ path: 'a' }), item({ path: 'b', state: { needs_you: 0, locked: false } })]
  const out = renderToStaticMarkup(createElement(Dial, {
    client: c, items: its as never, live: new Set(['territories']), place: { left: 0, top: 0, origin: '0 0' },
    onOpenTool: () => {}, onSoon: () => {}, onOpenClient: () => {}, onClose: () => {},
  }))
  assert.match(out, /class="dz-sub"[^>]*>2 explorations</)
  assert.match(out, /class="dz-tag dz-tag-sm"[^>]*>YOUR CALL</)
})

// ── honest control states: off is plainly off with its reason beside it; typing turns the control to the primary style; clearing turns it off ──
const ME = { name: 'Shrey' }
const btnOf = (h: string, sel: string) => new RegExp(`<button[^>]*${sel}[^>]*>`).exec(h)![0]
const css = (sel: string) => new RegExp(`${sel.replace(/[.[\]]/g, '\\$&')}\\{[^}]*\\}`).exec(html)?.[0] ?? ''

test('7. the primary style is the page action colour, and a control that is off is dashed and muted, not a dimmed live one', () => {
  for (const sel of ['.btn.dark,.btn.primary', '.big']) assert.match(html, new RegExp(`${sel.replace(/\./g, '\\.')}\\{[^}]*var\\(--ag-act\\)`), `${sel} uses --ag-act`)
  const off = /\.btn:disabled,\.btn\.dark:disabled[^{]*\{([^}]*)\}/.exec(html)![1]
  assert.match(off, /dashed/); assert.match(off, /background:transparent/); assert.match(off, /opacity:1/)
  assert.ok(css('.btn.dark,.btn.primary'))
})

test('8. look-up box: off with its reason when empty; typing enables it (primary class, no disabled); clearing disables it; Enter presses it', () => {
  const doc = json('example/states/explore_back.json')
  const empty = L.K.box(doc, { me: ME })
  assert.match(btnOf(empty, 'data-act="lookup"'), /class="btn dark"[^>]*disabled/)
  assert.match(empty, /data-lq-why>Type a question to look it up\./)
  const typed = L.K.box(doc, { me: ME, lq: 'Do families book table seats?' })
  assert.doesNotMatch(btnOf(typed, 'data-act="lookup"'), /disabled/)
  assert.match(btnOf(typed, 'data-act="lookup"'), /class="btn dark"/)
  assert.match(L.K.box(doc, { me: ME, lq: '   ' }), /data-act="lookup" disabled|class="btn dark" data-act="lookup" disabled/, 'clearing (or only spaces) turns it off again')
  assert.match(L.K.why({}), /Sign in first/)
  const busy = L.K.box(doc, { me: ME, lq: 'x', req: { key: 'lq:new', state: 'running' } })
  assert.match(busy, /spin-s[^>]*><\/span>Looking it up…/); assert.match(btnOf(busy, 'data-act="lookup"'), /disabled/)
  assert.match(html, /hasAttribute\('data-lq-draft'\)\) \{\s*ev\.preventDefault\(\); var lbn/, 'Enter presses Look it up')
  assert.match(html, /lh\.textContent = TerritoriesLookups\.why\(ui\)/, 'the reason follows each keystroke')
})

test('9. the own-insight box: Add is off until something is typed, and says why', () => {
  const d = approved(); d.run = { ...d.run, approvals: {}, decisions: [], gate: { id: 'pick', n: 1, of: 2 }, state: 'gate', stage: 'pick' }
  const empty = L.view(d, {})
  assert.match(btnOf(empty, 'data-act="add"'), /disabled/); assert.match(plain(empty), /Type an insight, tension or what-if to add it/)
  const typed = L.view(d, { draft: 'A new tension' })
  assert.doesNotMatch(btnOf(typed, 'data-act="add"'), /disabled/); assert.match(btnOf(typed, 'data-act="add"'), /btn-rect primary/)
  assert.match(html, /ab\.disabled = !ui\.draft\.trim\(\)[^\n]*TerritoriesLogic\.ownWhy/, 'typing and clearing toggle it live, with its words')
})

test('10. steer buttons say why they are off; Send and Keep this feel say what they need', () => {
  const run = json('example/states/explore_running.json')
  const live = run.expeditions.find((e: Doc) => e.state === 'running' || e.state === 'ready')
  assert.match(plain(L.view(run, { sel: live.crew })), /You can steer it once it is back/)
  assert.match(plain(L.view(json('example/states/explore_back.json'), { sel: json('example/states/explore_back.json').crew[0].id, req: { key: 'x', state: 'running' } })), /Waiting for the last change to finish/)
  assert.match(html, /Greenlight at least one route to send it/)
  assert.match(html, /keep\.classList\.toggle\('primary', kd\)/)
})

test('2b. the compass\'s brief node drops the "To confirm:" prefix and carries the small tag', () => {
  const d = json('example/states/explore_back.json')
  const up = Object.values(d.upstream as Doc)[0] as Doc
  up.smp = 'To confirm: The weekend starts when you sit down.'
  const svg = /<svg[^>]*id="compass"[\s\S]*?<\/svg>/.exec(L.view(d, {}))![0]
  assert.doesNotMatch(svg, /To confirm:/i)
  assert.match(svg, /class="cbt">to confirm</)
})
