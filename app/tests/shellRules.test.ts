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
