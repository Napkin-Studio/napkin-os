// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the shell no longer has (features/align-landing-look.clan): nothing samples a logo and nothing sets
// --agency-accent, a data-mode attribute or the sampled-accent style; the files that did are gone, and the
// focus ring is var(--accent) again.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { RELAY_REFUSAL_FILES, figureIn, relayRefusals } from '../../production-tool/web/src/ui/refusalWords'

// `npm test` runs from app/, and the bundled test does not sit where its source does.
const src = resolve(process.cwd(), 'src')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
const files = walk(src).filter(f => /\.(ts|tsx|css|js)$/.test(f))

test('no file in app/src names --agency-accent, data-mode or napkin-agency-accent', () => {
  const found: string[] = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const word of ['--agency-accent', 'data-mode', 'napkin-agency-accent']) if (text.includes(word)) found.push(`${f.slice(src.length + 1)}: ${word}`)
  }
  assert.deepEqual(found, [])
})

test('the sampling, the Agency look dialog and the third mode do not exist', () => {
  for (const gone of ['shell/agency/look.ts', 'shell/agency/accent.ts', 'shell/agency/AgencyLookPanel.tsx', 'shell/agency/look.css', 'shell/nui/modes.css', 'shell/home/Home.tsx', 'shell/home/TheO.tsx', 'shell/home/doorTargets.ts']) {
    assert.ok(!existsSync(join(src, gone)), `${gone} is gone`)
  }
  const menus = readFileSync(join(src, 'components/barMenus.ts'), 'utf8')
  assert.doesNotMatch(menus, /Agency look|onLook/)
  assert.match(menus, /label: 'View as'/)
})

test('the focus ring is var(--accent) again', () => {
  const css = readFileSync(join(src, 'index.css'), 'utf8')
  assert.match(css, /\[tabindex\]:focus-visible \{ outline: 3px solid var\(--accent\); outline-offset: 2px; \}/)
})

// Nothing is drawn between the OS bar and an open document (features/align-booth.clan, the last stage): the four
// bands are not mounted and their files are gone. What each did lives in the Booth (the shared folds and the
// state line) or in the OS bar (Undo and Redo as commands, the save line).
test('AppHost mounts none of BriefGateBand, VersionBand, JudgeBand and StateStrip, and their files are gone', () => {
  const host = readFileSync(join(src, 'shell/AppHost.tsx'), 'utf8')
  for (const name of ['BriefGateBand', 'VersionBand', 'JudgeBand', 'StateStrip']) assert.doesNotMatch(host, new RegExp(name), `${name} is not in AppHost`)
  for (const gone of ['shell/gate/BriefGateBand.tsx', 'shell/versions/VersionBand.tsx', 'shell/judge/JudgeBand.tsx', 'components/states/StateStrip.tsx']) {
    assert.ok(!existsSync(join(src, gone)), `${gone} is gone`)
  }
  const left = files.filter(f => /\b(BriefGateBand|VersionBand|JudgeBand|StateStrip)\b/.test(readFileSync(f, 'utf8'))).map(f => f.slice(src.length + 1))
  assert.deepEqual(left, [], 'no file names a deleted band')
})

test('the shell draws no state of the page: the bar item kind state is gone and the changed-brief block with it', () => {
  const host = readFileSync(join(src, 'shell/AppHost.tsx'), 'utf8')
  assert.doesNotMatch(host, /ChangedBrief|FailedSave|STATE_ACTIONS|stateOf/)
  const bar = readFileSync(join(src, 'shell/appBar.ts'), 'utf8')
  assert.doesNotMatch(bar, /kind: 'state'|stateOf|AppState/)
})

// ── No price, cost, credit or budget on any screen (features/align-confidential-prices.clan, done_when line 8) ──
// The owner's rule of 13 Nov: no prices or costs in the interface; a run's cost and a job's budget are recorded per
// job and read only in the decision tree (the Decisions drawer). This reads the interface strings of every file in
// app/src and app/templates (string literals, and the text between tags), never a document's content, and refuses a
// currency sign, "cents", "euro", "credit", "budget", "price" and "cost" in any of them. What may still say one of those
// words is on ALLOWED below: one file and the exact strings, each with the reason. A brief about a price promotion
// is document content and is not read here.
//
// Out of scope: production-tool/ (its own price words are removed by the record production-platform-rules, on
// feat/production-platform-rules; this record does not touch that tree), and the tests, goldens and fixtures.

const app = resolve(process.cwd())
// A currency sign (a dollar only as money: "$1" in a replace pattern is not), and the words. "per cent" is not money.
const MONEY = /\$(?=\s|$|\d+[.,]\d)|[€£]|(?<!per )\bcents?\b|\beuros?\b|\bcredits?\b|\bbudget(?:s|ed)?\b|\bpric(?:e|es|ed|ing)\b|\bcost(?:s|ing)?\b/i

interface Allowed { file: string; strings: RegExp; why: string }

/** Where a word on the list is not a price of Napkin's but a word of the client's own work, or the one place costs are read. */
const ALLOWED: Allowed[] = [
  { file: 'src/shell/decisions/words.ts', strings: /^(this run cost |a run was refused before it started|recorded the budget|budget$)/, why: 'the decision tree is the one place a run cost and a recorded budget are read; budget is also a client\'s reason word' },
  { file: 'src/shell/job/JobDecisions.tsx', strings: /^(Record the budget|Only account service, management and producers record a budget\.)$/, why: 'the job\'s Decisions is where the Money roles record a budget, as a set_budget decision; the figure is read there only' },
  { file: 'src/shell/clientReview/review.ts', strings: /^Budget$/, why: 'Budget is one of the reasons a client gives for a change: a word of the client\'s feedback, with no figure' },
  { file: 'templates/brief-maker/index.html', strings: /^(Budget & scope|Budget and scope|budget, cost, spend, scope|Whether the budget fits the ambition|Budget|We need our soft-serve dessert |Our relish is a much-loved pantry jar|Our alcohol-free stout is now on draught)|the budget, then export\.$/, why: 'Budget and scope is a part of the brief, with its search words, a Brief gate question, the client\'s reason Budget, and three example asks a client might type: the client\'s own words, never a cost of Napkin\'s' },
  { file: 'templates/campaign-research/index.html', strings: /^(Budget band|EUR band|Under €50k|€50k–€250k|€250k–€1m|€1m–€5m|Over €5m)$/, why: 'the client\'s budget band is a field of the research brief, shown as a band and never a figure' },
  { file: 'templates/shared/clan-fields.html', strings: /^(€|£|\$|Budget|it does not fit the budget)$/, why: 'a fact\'s own unit as the source gave it (a client\'s figure, "€412 million"), the client\'s reason word Budget, and a Brief gate reason' },
  { file: 'templates/deck-maker/index.html', strings: /^the budget$|Things you must supply, like the presenter or the budget split, /, why: 'what a pitch deck must cover and must leave to a person: the client\'s budget as the deck\'s own content, never a cost of Napkin\'s' },
]

function interfaceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', 'fixtures', 'example', 'wasm'].includes(f)) interfaceFiles(p, out) }
    else if (/\.(ts|tsx|js|jsx|html)$/.test(f) && !/\.(test|spec|golden|d)\./.test(f)) out.push(p)
  }
  return out
}

/** The strings a person could read: a literal with a space or a capital first letter (not a key or an id), and the
 *  text between tags. Comment lines are not interface. */
export function interfaceStrings(source: string): string[] {
  const out: string[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (line === '' || /^(\/\/|\*|\/\*|<!--)/.test(line) || /^import\b/.test(line)) continue
    const code = line.replace(/\s\/\/ .*$/, '').replace(/\/\*.*?\*\//g, '')
    for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const s = m[2]
      if (/^(\$\{|\/|https?:)/.test(s)) continue // a path or a template of one, not words
      if ((/^[A-Z€£$]|\s/.test(s) && !/^[\w-]+$/.test(s)) || /^[A-Z][a-z]+$/.test(s)) out.push(s)
    }
    for (const m of code.matchAll(/>([^<>{}]*[A-Za-z€£][^<>{}]*)</g)) out.push(m[1].trim())
  }
  return out
}

test('interfaceStrings reads literals and tag text, and leaves keys and comments alone', () => {
  assert.deepEqual(interfaceStrings("// a budget of ten\nconst k = 'budget_hours'\nconst a = 'Record the budget'"), ['Record the budget'])
  assert.deepEqual(interfaceStrings('<p>This run costs more</p>'), ['This run costs more'])
  assert.deepEqual(interfaceStrings("const x = { budget: 'budget' }"), [])
  assert.ok(interfaceStrings("out.push('$' + n.toFixed(2) + ' so far')").some(s => MONEY.test(s)), 'a dollar sign said alone is money')
  assert.ok(!MONEY.test("s.replace(/(a)/, '$1')") && !MONEY.test('23 per cent'), 'a replace pattern and per cent are not')
})

test('no price, cost, credit, budget or currency sign in any interface string of the shell or a template, but what ALLOWED names', () => {
  const found: string[] = []
  for (const p of [...interfaceFiles(join(app, 'src')), ...interfaceFiles(join(app, 'templates'))]) {
    const rel = p.slice(app.length + 1)
    const ok = ALLOWED.filter(a => a.file === rel)
    for (const s of interfaceStrings(readFileSync(p, 'utf8'))) {
      if (!MONEY.test(s)) continue
      if (ok.some(a => a.strings.test(s))) continue
      found.push(`${rel}: ${s.slice(0, 110)}`)
    }
  }
  assert.deepEqual(found, [], 'these strings show a price, cost, credit or budget')
})

test('every allowed file exists and says why, so the list does not outlive what it excuses', () => {
  for (const a of ALLOWED) {
    assert.ok(existsSync(join(app, a.file)), a.file)
    assert.ok(a.why.length > 30, `${a.file} needs a written reason`)
    assert.ok(interfaceStrings(readFileSync(join(app, a.file), 'utf8')).some(s => MONEY.test(s) && a.strings.test(s)), `${a.file}: nothing on the list is still there`)
  }
})

test('the shell names no run cost, budget hours or credit cap anywhere else: the dashboard, the job page, Live jobs and the states', () => {
  const gone: [string, RegExp][] = [
    ['shell/home/dashboardModel.ts', /'hours'|Hours against budget|budgeted/],
    ['shell/job/JobPage.tsx', /budgetLine|job-budget|job-f-budget|Budget in hours/],
    ['shell/job/LiveJobs.tsx', /open-f-budget|budget_hours|Budget in hours/],
    ['shell/job/jobModel.ts', /budgetLine|budget_hours/],
    ['components/states/words.ts', /reserved estimate|[Cc]redit/],
  ]
  for (const [f, re] of gone) assert.doesNotMatch(readFileSync(join(src, f), 'utf8'), re, f)
})

// Phase 3 test 79's unit half, joined here (features/production-platform-rules.clan, done_when 7): the Production line's
// limit_reached and spend_stop refusals hold no digit and no currency word. The rule and the walk are the web's own
// (production-tool/web/src/ui/refusalWords.ts, tested there too); this runs them over the relay's source from the shell's tests.
test('79 Production refusals (limit_reached, spend_stop) hold no figure and no currency word', () => {
  const tool = resolve(process.cwd(), '..', 'production-tool')
  const sources = Object.fromEntries(RELAY_REFUSAL_FILES.map(p => [p, readFileSync(join(tool, p), 'utf8')]))
  const lines = relayRefusals(sources)
  assert.ok(lines.some(l => l.code === 'limit_reached') && lines.some(l => l.code === 'spend_stop'), 'the walk finds both codes')
  const bad = lines.flatMap(l => { const why = figureIn(l.text); return why ? [`${l.where}: ${why} in "${l.text}"`] : [] })
  assert.deepEqual(bad, [])
})
