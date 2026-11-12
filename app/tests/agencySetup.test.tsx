// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// features/agency-setup.clan in the shell: the setup flow's steps read from the data, the words said about a
// file check and an import, the import panel in each phase it can be in, the people editor, and the card on an
// admin's home. Made-up people only (Agency C). Nothing here scores or ranks a person.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ImportReport, SetupStatus } from '../src/shell/setup/api.ts'
import { directoryNote, errorRows, firstUnfinished, importSummary, nextLine, nextStep, prevStep, roleWords, STEP_IDS } from '../src/shell/setup/model.ts'
import { ImportBody, type Phase } from '../src/shell/setup/CsvImport.tsx'
import { StepPage } from '../src/shell/setup/SetupFlow.tsx'
import { PeopleBody } from '../src/shell/setup/PeoplePage.tsx'
import { SetupCardBody } from '../src/shell/setup/SetupCard.tsx'
import { AuditBody } from '../src/shell/setup/AuditPage.tsx'
import type { AuditEntry } from '../src/shell/setup/api.ts'
import { auditFilterOf, auditShown, versionWords, whenWords } from '../src/shell/setup/model.ts'
import { parseRoute, formatRoute } from '../src/shell/route.ts'

const status = (done: string[]): SetupStatus => ({
  steps: STEP_IDS.map(id => ({ id, done: done.includes(id) })), next: STEP_IDS.find(id => !done.includes(id)) ?? null,
  complete: done.length === STEP_IDS.length, people: done.includes('people') ? 3 : 0, has_directory: done.includes('people'),
})
const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  kind: 'people', dry_run: true, rows: 120, ok: 117, errors: [{ line: 8, reason: 'missing email' }, { line: 40, reason: 'unknown role: wizard' }, { line: 70, reason: 'duplicate of line 4' }],
  created: 117, updated: 0, unchanged: 0, committed: false, starts_directory: true, made_before_failure: [],
  results: [
    { line: 8, status: 'error', label: 'line 8', reason: 'missing email' },
    { line: 40, status: 'error', label: 'person39@cr', reason: 'unknown role: wizard' },
    { line: 70, status: 'error', label: 'person3@cr', reason: 'duplicate of line 4' },
    { line: 2, status: 'new', label: 'person1@cr' },
  ],
  ...over,
})

test('the flow starts with the logo and resumes at the first step whose data is not there', () => {
  assert.deepEqual([...STEP_IDS], ['logo', 'name', 'people', 'clients', 'jobs'])
  assert.equal(firstUnfinished(status([])), 'logo')
  assert.equal(firstUnfinished(status(['logo'])), 'name')
  // a skipped step is picked up later, even when a later one is done
  assert.equal(firstUnfinished(status(['logo', 'people'])), 'name')
  assert.equal(firstUnfinished(status([...STEP_IDS])), null)
  assert.equal(nextStep('logo'), 'name')
  assert.equal(nextStep('jobs'), null)
  assert.equal(prevStep('logo'), null)
  assert.equal(prevStep('people'), 'name')
})

test('the home card says what comes next, and is gone once every step has its data', () => {
  assert.equal(nextLine(status([]))?.verb, 'Start setup')
  assert.match(nextLine(status([]))!.head, /logo/)
  assert.equal(nextLine(status(['logo']))?.verb, 'Continue setup')
  assert.match(nextLine(status(['logo']))!.head, /name your agency/)
  assert.equal(nextLine(status([...STEP_IDS])), null)
  const html = (s: SetupStatus | null) => renderToStaticMarkup(createElement(SetupCardBody, { status: s, onOpen: () => {} }))
  assert.match(html(status(['logo'])), /1 of 5 steps done/)
  assert.equal(html(status([...STEP_IDS])), '')
  assert.equal(html(null), '')
})

test('a file check says how many rows are fine and how many need a look, in plain words', () => {
  assert.equal(importSummary(report()).head, '117 people are ready to import. 3 rows need a look.')
  assert.equal(importSummary(report({ errors: [], ok: 120, created: 120, results: [] })).head, '120 people are ready to import.')
  assert.equal(importSummary(report({ ok: 1, created: 1, kind: 'clients', errors: [] })).head, '1 client is ready to import.')
  assert.equal(importSummary(report({ ok: 0, created: 0, errors: report().errors })).tone, 'none')
  assert.match(importSummary(report({ ok: 0, created: 0 })).sub!, /Nothing has been saved/)
  // the same file again: nothing would change
  assert.match(importSummary(report({ ok: 117, created: 0, updated: 0, unchanged: 117, errors: [] })).head, /already here\. Nothing would change/)
  // after the import
  const done = importSummary(report({ dry_run: false, committed: true, created: 117 }))
  assert.equal(done.head, '117 people done: 117 added.')
  assert.match(done.sub!, /3 rows were left out/)
  assert.doesNotMatch(JSON.stringify([done, importSummary(report())]), /—/)
})

test('a first people list says it starts the directory, before it is saved and not after', () => {
  assert.match(directoryNote(report(), 'Agency C')!, /first people list/)
  assert.match(directoryNote(report(), 'Agency C')!, /you stay on it as an admin/)
  assert.equal(directoryNote(report({ starts_directory: false }), null), null)
  assert.equal(directoryNote(report({ committed: true }), null), null)
  assert.equal(directoryNote(report({ kind: 'clients' }), null), null)
})

test('the rows to fix are the bad ones, by line, and capped', () => {
  const r = report()
  assert.deepEqual(errorRows(r).shown.map(x => x.line), [8, 40, 70])
  const many = report({ results: Array.from({ length: 60 }, (_, i) => ({ line: i + 2, status: 'error' as const, label: `row ${i}`, reason: 'missing name' })) })
  assert.equal(errorRows(many, 50).shown.length, 50)
  assert.equal(errorRows(many, 50).more, 10)
})

const body = (phase: Phase, r: ImportReport | null = null, file: string | null = null, said = '') =>
  renderToStaticMarkup(createElement(ImportBody, { kind: 'people', phase, file, report: r, said, agency: 'Agency C', inputId: 'x', help: createElement('p', null, 'help'), onPick: () => {}, onImport: () => {}, onRetry: () => {} }))

test('the import panel in each state it can be in: idle, checking, checked, importing, done, unreadable, refused, failed', () => {
  assert.match(body('idle'), /Choose a person file/)
  assert.match(body('idle'), /data-testid="setup-people-input"/)
  assert.doesNotMatch(body('idle'), /Import \d/)
  assert.match(body('checking', null, 'people.csv'), /Loading|Opening|your file/i)
  const checked = body('checked', report(), 'people.csv')
  assert.match(checked, /117 people are ready to import/)
  assert.match(checked, /data-testid="import-summary"/)
  assert.match(checked, /data-line="8"[^>]*>.*?missing email/)
  assert.match(checked, /Import 117 people/)
  assert.match(checked, /first people list/)
  assert.match(body('done', report({ dry_run: false, committed: true }), 'people.csv'), /data-testid="import-done"/)
  assert.doesNotMatch(body('done', report({ dry_run: false, committed: true })), /Import 117/)
  assert.match(body('importing', report(), 'people.csv'), /your people/i)
  assert.match(body('unreadable', null, 'x.csv', 'That file has more than 5,000 rows. Split it and import it in parts.'), /more than 5,000 rows/)
  assert.match(body('refused'), /admin/i)
  assert.match(body('failed', null, 'x.csv'), /try again/i)
  // nothing to import is not offered as a button that does something
  assert.match(body('checked', report({ ok: 0, created: 0 })), /disabled/)
})

test('every step of the flow draws, with its title, its count and its way on', () => {
  for (const id of STEP_IDS) {
    const html = renderToStaticMarkup(createElement(StepPage, { step: id, status: status(['logo']), agency: 'Agency C', onStep: () => {}, onRead: async () => {}, onName: () => {}, onFinish: () => {} }))
    assert.match(html, new RegExp(`data-step="${id}"`))
    assert.match(html, new RegExp(`Step ${STEP_IDS.indexOf(id) + 1} of 5`))
    assert.match(html, id === 'jobs' ? /data-testid="setup-finish"/ : />Next</)
    assert.equal(html.includes('—'), false, `${id} has no em dash`)
  }
  const logo = renderToStaticMarkup(createElement(StepPage, { step: 'logo', status: status([]), agency: null, onStep: () => {}, onRead: async () => {}, onName: () => {}, onFinish: () => {} }))
  assert.match(logo, /Start with your logo/)
  assert.match(logo, /data-testid="setup-logo-input"/)
  assert.match(logo, /Skip for now/)
  assert.doesNotMatch(logo, />Back</, 'nothing comes before the logo')
  const names = renderToStaticMarkup(createElement(StepPage, { step: 'logo', status: status(['logo']), agency: null, onStep: () => {}, onRead: async () => {}, onName: () => {}, onFinish: () => {} }))
  assert.match(names, /data-step="logo" data-done/)
  assert.doesNotMatch(names, /Skip for now/, 'a finished step is not skipped')
})

const people = [
  { username: 'cara@cr', name: 'Cara Test', roles: ['admin'], email: 'cara@mail.example.test', state: 'active' as const, invited_by: 'cara@cr', at: '2026-11-12T09:00:00Z' },
  { username: 'dan@cr', name: 'Dan Test', roles: ['planning', 'traffic'], email: 'dan@mail.example.test', state: 'invited' as const, invited_by: 'cara@cr', at: '2026-11-12T09:00:00Z' },
  { username: 'old@cr', name: 'Old Test', roles: ['planning'], email: 'old@mail.example.test', state: 'removed' as const, invited_by: 'cara@cr', at: '2026-11-01T09:00:00Z' },
]
const roles = [{ id: 'admin', title: 'Admin' }, { id: 'planning', title: 'Planning' }, { id: 'traffic', title: 'Traffic' }]
const list = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PeopleBody, {
  people, admin: true, roles, editing: null, busy: false, said: '', me: 'cara@cr', onAdd: () => {}, onEdit: () => {}, onSaveRoles: () => {}, onRemove: () => {}, go: () => {}, ...over,
}))

test('the people page shows an admin the controls and the emails, and a member only names and roles', () => {
  const admin = list()
  assert.match(admin, /2 people/)
  assert.match(admin, /Cara Test \(you\)/)
  assert.match(admin, /dan@mail\.example\.test/)
  assert.match(admin, /data-testid="person-add"/)
  assert.match(admin, /Change roles of Dan Test/)
  assert.match(admin, /Invited/)
  assert.match(admin, /data-testid="people-removed"/)
  // a member's list has no email and no controls (the server cuts the email too)
  const member = list({ admin: false, roles: [], people: people.filter(p => p.state !== 'removed').map(({ username, name, roles }) => ({ username, name, roles })) })
  assert.doesNotMatch(member, /mail\.example/)
  assert.doesNotMatch(member, /person-add|Change roles|Remove/)
  assert.match(member, /Planning/)
})

test('changing roles shows the roles as choices and will not save none', () => {
  const editing = list({ editing: 'dan@cr' })
  assert.match(editing, /data-testid="role-editor"/)
  assert.match(editing, /data-testid="edit-planning"[^>]*checked/)
  assert.doesNotMatch(editing, /data-testid="edit-admin"[^>]*checked/)
  assert.match(list({ said: 'An agency keeps at least one admin; name another admin first' }), /data-testid="people-said"[^>]*>An agency keeps at least one admin/)
})

test('roles are said as titles, and the routes for setup, people and the audit view round trip', () => {
  assert.equal(roleWords('creative-director'), 'Creative director')
  assert.equal(roleWords('admin'), 'Admin')
  assert.equal(roleWords('planning', new Map([['planning', 'Planning team']])), 'Planning team')
  for (const level of ['setup', 'people', 'audit'] as const) {
    assert.deepEqual(parseRoute(formatRoute({ level })), { level })
  }
  assert.deepEqual(parseRoute('#setupx'), { level: 'agency' })
})

const entries: AuditEntry[] = [
  { at: '2026-11-12T09:41:02Z', who: 'dara@cr', kind: 'approval', what: 'Locked Brief for Client A.', doc: 'doc-1', version: 'sha256:a31631598d1e92882a1dc1dbebe9082b6ca182ab48b946dacf8a9db974543690' },
  { at: '2026-11-12T09:30:00Z', who: 'cian@cr', kind: 'link', what: 'Made a link for the client to open.', doc: 'doc-1' },
  { at: '2026-11-12T09:20:00Z', who: 'cara@cr', kind: 'permission', what: 'Changed the roles of niamh@cr from management to management, traffic.', doc: 'niamh@cr' },
  { at: '2026-11-12T09:10:00Z', who: 'ghost@cr', kind: 'sign-in', what: 'Sign-in refused.', ip: '203.0.113.7' },
  { at: '2026-11-12T09:05:00Z', who: 'cara@cr', kind: 'settings', what: "Changed the agency's settings." },
]
const audit = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AuditBody, {
  lines: entries, filter: 'all', verified: null, checking: false, onFilter: () => {}, onCheck: () => {}, ...over,
}))

test('the audit view lists who did what, to which version, and from where a sign-in came, and has no control that changes a line', () => {
  const html = audit()
  assert.equal((html.match(/data-testid="audit-line"/g) ?? []).length, 5)
  assert.match(html, /Locked Brief for Client A\./)
  assert.match(html, /dara@cr · version a3163159/)
  assert.match(html, /from 203\.0\.113\.7/)
  assert.doesNotMatch(html, /Edit|Delete|Remove/)
  assert.equal(html.includes('\u2014'), false)
  // narrowing: settings and permission changes are one filter
  assert.deepEqual(auditShown(entries, 'people').map(l => l.kind), ['permission', 'settings'])
  assert.equal(auditShown(entries, 'all').length, 5)
  assert.equal(auditFilterOf('permission'), 'people')
  assert.match(audit({ filter: 'export' }), /Nothing of this kind has happened yet/)
  assert.match(audit({ filter: 'link' }), /aria-pressed="true"[^>]*data-testid="audit-filter" data-filter="link"|data-filter="link"/)
})

test('checking the log says plainly whether a saved line was changed', () => {
  assert.match(audit({ verified: { ok: true, lines: 9 } }), /Nothing was changed\. 9 saved lines checked\./)
  assert.match(audit({ verified: { ok: true, lines: 1 } }), /1 saved line checked/)
  const bad = audit({ verified: { ok: false, lines: 9, line: 4, problem: 'a line was changed after it was written' } })
  assert.match(bad, /A saved line was changed \(line 4\)\. a line was changed after it was written/)
  assert.match(bad, /data-ok="false"/)
  assert.match(audit({ checking: true }), /disabled/)
})

test('a time and a version are said short', () => {
  assert.equal(versionWords('sha256:a31631598d1e'), 'a3163159')
  assert.equal(versionWords(undefined), null)
  assert.match(whenWords('2026-11-12T09:41:02Z'), /^12 Nov, \d\d:\d\d$/)
  assert.equal(whenWords('not a time'), 'not a time')
})
