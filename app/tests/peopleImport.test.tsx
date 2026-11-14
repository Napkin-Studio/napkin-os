// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// features/align-needs-lock-people.clan, stage 4, in the shell: the People page is the one screen. It lists people with
// their roles, adds a person with at least one role, changes roles, and imports people from a file (checked first, the bad
// lines by line, the good ones imported). An agency's admin sees their own agency and no Agencies tab. Made-up people only.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ImportReport } from '../src/shell/people/api.ts'
import { errorRows, firstListNote, importSummary, importVerb } from '../src/shell/people/importModel.ts'
import { ImportBody, type Phase } from '../src/shell/people/PeopleImport.tsx'
import PeoplePage, { AddSheet, RolesPicker } from '../src/shell/people/PeoplePage.tsx'
import { ROLE_CHOICES, canManagePeople, rolesLine, type PersonRow } from '../src/shell/people/model.ts'

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  kind: 'people', dry_run: true, rows: 120, ok: 117,
  errors: [{ line: 8, reason: 'missing email' }, { line: 40, reason: 'unknown role: wizard' }, { line: 70, reason: 'duplicate of line 4' }],
  created: 117, updated: 0, unchanged: 0, committed: false, starts_directory: true,
  results: [
    { line: 8, status: 'error', label: 'line 8', reason: 'missing email' },
    { line: 40, status: 'error', label: 'person39@cr', reason: 'unknown role: wizard' },
    { line: 70, status: 'error', label: 'person3@cr', reason: 'duplicate of line 4' },
    { line: 2, status: 'new', label: 'person1@cr' },
  ],
  ...over,
})

test('a file check says how many rows are fine and how many need a look, in plain words', () => {
  assert.equal(importSummary(report()).head, '117 people are ready to import. 3 rows need a look.')
  assert.equal(importSummary(report({ errors: [], ok: 120, created: 120, results: [] })).head, '120 people are ready to import.')
  assert.equal(importSummary(report({ ok: 0, created: 0 })).tone, 'none')
  assert.match(importSummary(report({ ok: 0, created: 0 })).sub!, /Nothing has been saved/)
  assert.match(importSummary(report({ ok: 117, created: 0, updated: 0, unchanged: 117, errors: [] })).head, /already here\. Nothing would change/)
  const done = importSummary(report({ dry_run: false, committed: true, created: 117 }))
  assert.equal(done.head, '117 people done: 117 added.')
  assert.match(done.sub!, /3 rows were left out/)
  assert.doesNotMatch(JSON.stringify([done, importSummary(report())]), /—/)
  assert.match(firstListNote(report(), 'cr')!, /first people list/)
  assert.equal(firstListNote(report({ committed: true }), 'cr'), null)
  assert.equal(importVerb(report()), 'Import 117 people')
  assert.equal(importVerb(report({ ok: 0, created: 0 })), null)
  assert.deepEqual(errorRows(report()).shown.map(x => x.line), [8, 40, 70])
})

const body = (phase: Phase, r: ImportReport | null = null, file: string | null = null, said = '') =>
  renderToStaticMarkup(createElement(ImportBody, { phase, file, report: r, said, agency: 'cr', onPick: () => {}, onImport: () => {}, onClose: () => {} }))

test('the import panel in each state it can be in', () => {
  assert.match(body('idle'), /Choose a people file/)
  assert.match(body('idle'), /data-testid="people-import-input"/)
  assert.doesNotMatch(body('idle'), /Import \d/)
  assert.match(body('checking', null, 'people.csv'), /Checking your file/)
  const checked = body('checked', report(), 'people.csv')
  assert.match(checked, /data-testid="import-summary"/)
  assert.match(checked, /data-line="8"[^>]*>.*?missing email/)
  assert.match(checked, /Import 117 people/)
  assert.match(body('done', report({ dry_run: false, committed: true }), 'people.csv'), /data-testid="import-done"/)
  assert.match(body('unreadable', null, 'x.csv', 'That file is empty.'), /That file is empty\./)
  assert.match(body('failed', null, 'x.csv'), /Try again/)
  assert.match(body('checked', report({ ok: 0, created: 0 })), /disabled/)
  for (const p of ['idle', 'checked', 'done'] as Phase[]) assert.equal(body(p, report()).includes('—'), false)
})

test('roles are offered as choices, said in words, and a person with none is said so', () => {
  const html = renderToStaticMarkup(createElement(RolesPicker, { roles: ['planning', 'admin'], onChange: () => {} }))
  assert.equal((html.match(/data-testid="role-/g) ?? []).length, ROLE_CHOICES.length)
  assert.match(html, /data-testid="role-planning"[^>]*><input type="checkbox" checked=""/)
  assert.doesNotMatch(html, /data-testid="role-traffic"[^>]*><input type="checkbox" checked=""/)
  assert.equal(rolesLine(['creative-director', 'admin']), 'Creative director, Admin')
  assert.equal(rolesLine([]), 'No role')
})

const draft = { name: 'Dara Test', agency: 'wk', username: '', touched: false, shown: null, from: '', base: '#0F6B5C', accent: '#9FE6D8', roles: [] as string[] }
const sheet = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AddSheet, {
  draft, setDraft: () => {}, agencies: [], busy: false, onCancel: () => {}, onAdd: () => {}, ...over,
}))

test('adding a person asks for at least one role', () => {
  const none = sheet()
  assert.match(none, /data-testid="roles-picker"/)
  assert.match(none, /<button type="button" class="pa-btn pa-primary" disabled="">Add<\/button>/)
  const one = sheet({ draft: { ...draft, roles: ['planning'] } })
  assert.doesNotMatch(one, /<button type="button" class="pa-btn pa-primary" disabled="">Add<\/button>/)
  // an agency's admin adds to their own agency: the field is theirs, and no new agency is made from here
  const own = sheet({ own: 'cr', draft: { ...draft, agency: 'cr', roles: ['planning'] } })
  assert.match(own, /id="pa-ag"[^>]*disabled=""/)
  assert.doesNotMatch(own, /data-testid="new-agency"/)
})

const people: PersonRow[] = [
  { id: 'cara@cr', name: 'Cara Test', agency: 'cr', admin: false, added_by: 'roster', added_at: '2026-11-12T09:00:00Z', roles: ['admin'] },
  { id: 'dan@cr', name: 'Dan Test', agency: 'cr', admin: false, added_by: 'cara@cr', added_at: '2026-11-12T09:00:00Z', roles: ['planning', 'traffic'] },
]
const noop = () => {}

test('an agency\'s admin opens the page for their own agency: roles listed, no Agencies tab, the import offered', () => {
  assert.ok(canManagePeople('cara@cr', ['admin']))
  assert.ok(!canManagePeople('dan@cr', ['planning']))
  const html = renderToStaticMarkup(createElement(PeoplePage, { user: 'cara@cr', roles: ['admin'], onClose: noop, initial: { people, agencies: [] } }))
  assert.match(html, /Who in your agency can sign in, and with which roles\./)
  assert.doesNotMatch(html, />Agencies </)
  assert.match(html, /data-testid="people-import-open"/)
  assert.match(html, /<small>Planning, Traffic<\/small>/)
  assert.match(html, /data-testid="person-roles-open"/)
  assert.doesNotMatch(html, /data-testid="people-denied"/)
  // "Napkin Studio" is said once, on the page's pill
  assert.equal((html.match(/Napkin Studio/g) ?? []).length, 1)
  // nothing scores a person: no count of items or days per person anywhere on the page
  assert.doesNotMatch(html, /items|late|score/i)
  // a member is told to ask an admin
  const denied = renderToStaticMarkup(createElement(PeoplePage, { user: 'dan@cr', roles: ['planning'], onClose: noop, initial: { people, agencies: [] } }))
  assert.match(denied, /data-testid="people-denied"/)
})
