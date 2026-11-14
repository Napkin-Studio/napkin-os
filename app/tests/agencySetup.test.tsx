// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// features/agency-setup.clan in the shell, as features/align-needs-lock-people.clan left it in stage 4: the setup flow, its
// card and the build's people page went (the People page is the one screen: peopleImport.test.tsx); the audit view stays.
// Made-up people only (Agency C). Nothing here scores or ranks a person.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AuditBody } from '../src/shell/setup/AuditPage.tsx'
import { verifiedWords, type AuditEntry } from '../src/shell/setup/api.ts'
import { auditFilterOf, auditShown, versionWords, whenWords } from '../src/shell/setup/model.ts'
import { parseRoute, formatRoute } from '../src/shell/route.ts'

test('#people and #setup are not routes; the audit view keeps its own', () => {
  assert.deepEqual(parseRoute('#people'), { level: 'agency' })
  assert.deepEqual(parseRoute('#setup'), { level: 'agency' })
  assert.deepEqual(parseRoute(formatRoute({ level: 'audit' })), { level: 'audit' })
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
  // a log whose own chain holds but which carries lines copied from the old agency list: not vouched for, said plainly
  const copied = verifiedWords({ ok: false, chain_intact: true, lines: 9, not_verified: 2 })
  assert.match(copied, /^Nothing was changed\. 9 saved lines checked\. 2 lines were copied from the agency's old list/)
  assert.equal(copied.includes('\u2014'), false)
})

test('a time and a version are said short', () => {
  assert.equal(versionWords('sha256:a31631598d1e'), 'a3163159')
  assert.equal(versionWords(undefined), null)
  assert.match(whenWords('2026-11-12T09:41:02Z'), /^12 Nov, \d\d:\d\d$/)
  assert.equal(whenWords('not a time'), 'not a time')
})
