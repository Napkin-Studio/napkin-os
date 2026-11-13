// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing and the look after features/align-landing-look.clan: one tool list, two themes, one look
// mechanism, no sampled accent, and a page door that can be pointed at.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { DOORS } from '../src/components/states/doors.ts'
import { describeShell } from '../src/dogfood/pointer.ts'
import { AGENCY_COLOURS, accentInkOf, contrast, coloursOf, inkOn, pillOf, registerAgencyLooks } from '../src/shell/agency/palette.ts'
import { DOOR_TARGETS } from '../src/shell/home/doorTargets.ts'
import { TOOLS, toolById } from '../src/shell/landing/tools.ts'
import { formatRoute, parseRoute } from '../src/shell/route.ts'
import { parseTheme } from '../src/theme.ts'

const repo = resolve(process.cwd(), '..')
const src = resolve(process.cwd(), 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))

// ── tools: one table ─────────────────────────────────────────────────────────

/** The `tool_of` match of crates/napkin-web/src/roles.rs: which door ids are tools, and the TOOLS id each opens. */
function toolDoors(): Record<string, string> {
  const rs = readFileSync(join(repo, 'crates/napkin-web/src/roles.rs'), 'utf8')
  const body = /pub fn tool_of[\s\S]*?\n}\n/.exec(rs)![0]
  return Object.fromEntries([...body.matchAll(/"([a-z-]+)" => "([a-z]+)"/g)].map(m => [m[1], m[2]]))
}
/** Every door id the server's default table lists. */
function tableDoors(): string[] {
  const rs = readFileSync(join(repo, 'crates/napkin-web/src/roles.rs'), 'utf8')
  const table = /impl Default for Table[\s\S]*?departments: vec!/.exec(rs)![0]
  return [...new Set([...table.matchAll(/\(\s*"([a-z-]+)",\s*"[^"]+"\s*\)/g)].map(m => m[1]))]
}

test('every door in roles.rs is a tool or a page door, never both, and every tool door is a TOOLS entry', () => {
  const tools = toolDoors()
  const doors = tableDoors()
  assert.ok(doors.length > 30, 'the table was read')
  for (const [door, tool] of Object.entries(tools)) {
    assert.ok(doors.includes(door) || door === 'script-editor', `${door} is a door`)
    assert.ok(tool === 'territories' || toolById(tool), `${door} opens ${tool}, which TOOLS has`)
    assert.ok(!(door in DOOR_TARGETS), `${door} is a tool and so has no page target`)
  }
  for (const d of doors) {
    const asTool = d in tools
    const asPage = DOORS.some(x => x.id === d)
    assert.ok(asTool || asPage, `${d} is neither a tool nor a page door`)
  }
  // one table: no second list of tools in the shell
  assert.equal(new Set(TOOLS.map(t => t.id)).size, TOOLS.length)
  assert.ok(!existsSync(join(src, 'shell/home/doorTargets.ts')) || !/app:\s*'ie\./.test(readFileSync(join(src, 'shell/home/doorTargets.ts'), 'utf8')), 'doorTargets.ts holds no app ids')
})

test('Idea, Script and Visual are tools of the one table, with their own app ids', () => {
  assert.equal(toolById('idea')?.appId, 'ie.napkin.idea-room')
  assert.equal(toolById('script')?.appId, 'ie.napkin.script-editor')
  assert.equal(toolById('visual')?.appId, 'ie.napkin.visual-brief')
})

// ── the routes ───────────────────────────────────────────────────────────────

test('the old role home and the map fall to the desk; a page door and the new tools are routes', () => {
  for (const old of ['#map', '#home-planning', '#home-admin']) assert.deepEqual(parseRoute(old), { level: 'agency' }, old)
  for (const tool of ['script', 'visual']) {
    const hash = `#tool-cli_0123abcd-${tool}`
    assert.equal(formatRoute(parseRoute(hash)), hash)
  }
  assert.equal(formatRoute(parseRoute('#door-live-jobs')), '#door-live-jobs')
})

// ── the theme ────────────────────────────────────────────────────────────────

test('the three stored values of the old modes read as light or dark, and nothing else is a theme', () => {
  assert.equal(parseTheme('white'), 'light')
  assert.equal(parseTheme('grey'), 'light')
  assert.equal(parseTheme('black'), 'dark')
  assert.equal(parseTheme('light'), 'light')
  assert.equal(parseTheme('dark'), 'dark')
  assert.equal(parseTheme('sepia'), null)
  assert.equal(parseTheme(null), null)
})

// ── the look: palette.ts alone ───────────────────────────────────────────────

test('ink on the agency colour reads at 4.5 to 1 in every registry entry and in an agency added from the People page', () => {
  registerAgencyLooks([{ id: 'added-one', name: 'Added One', base: '#1A3A5C', accent: '#F2C14E' }])
  for (const id of [...Object.keys(AGENCY_COLOURS), 'added-one']) {
    const c = coloursOf(id)!
    assert.ok(c, id)
    assert.ok(contrast(accentInkOf(c), c.accent) >= 4.5, `${id}: accent ink`)
    const pill = pillOf(c)
    assert.ok(contrast(pill.ink, pill.bg) >= 4.5, `${id}: pill ink`)
    assert.ok(contrast(inkOn(c.base), c.base) >= 4.5, `${id}: ink on the base`)
  }
  registerAgencyLooks([])
})

// ── nothing samples a logo ───────────────────────────────────────────────────

test('nothing in app/src sets or reads --agency-accent, data-mode or napkin-agency-accent, and the sampler is gone', () => {
  for (const f of walk(src).filter(f => /\.(ts|tsx|css|html)$/.test(f))) {
    const text = readFileSync(f, 'utf8')
    for (const word of ['--agency-accent', 'data-mode', 'napkin-agency-accent']) assert.ok(!text.includes(word), `${f.slice(src.length)} holds ${word}`)
  }
  for (const gone of ['shell/agency/look.ts', 'shell/agency/accent.ts', 'shell/agency/AgencyLookPanel.tsx', 'shell/agency/look.css', 'shell/nui/modes.css', 'shell/home/Home.tsx', 'shell/home/TheO.tsx']) {
    assert.ok(!existsSync(join(src, gone)), `${gone} is gone`)
  }
  assert.match(readFileSync(join(src, 'index.css'), 'utf8'), /\[tabindex\]:focus-visible \{ outline: 3px solid var\(--accent\)/)
})

// ── pointing ─────────────────────────────────────────────────────────────────

test('a page door of the Your pages row is named for feedback: a control, labelled with the door', () => {
  const attrs: Record<string, string> = { 'data-dogfood': 'page-door-live-jobs', 'aria-label': 'Live jobs' }
  const btn = { tagName: 'BUTTON', textContent: 'Live jobs', getAttribute: (n: string) => attrs[n] ?? null, closest: (_s: string) => btn }
  const d = describeShell(btn as never)
  assert.deepEqual(d?.target, { kind: 'control', id: 'page-door-live-jobs', label: 'Live jobs' })
})
