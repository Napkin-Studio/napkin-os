// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Pick up where you left off" under Me (features/align-needs-lock-people.clan): the documents that hold an item for
// the person, soonest due first, five and then Show all; with none, the line names the next deadline. And the one
// reader of the needs route.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import type { DocumentNeeds, LibraryItem } from '../src/host/types.ts'
import { emptyLine, firstRows, ME_FIRST, meRows } from '../src/shell/nui/meRows.ts'

const doc = (path: string, title: string): LibraryItem =>
  ({ path, title, client: { id: 'c1', name: 'Client A' }, updated_at: '2026-11-10T10:00:00Z', state: { needs_you: 1, locked: false } }) as unknown as LibraryItem
const facts = (path: string, mine: number, due: string | null, count = mine): DocumentNeeds =>
  ({ path, count, notices: 0, mine, earliest_due: due, next_deadline: null })

test('Me lists the documents holding an item for me, by the earliest date, none last, ties by title', () => {
  const items = [doc('d1', 'Zed brief'), doc('d2', 'Ada brief'), doc('d3', 'Mid brief'), doc('d4', 'Not mine'), doc('d5', 'No date')]
  const rows = meRows(items, [facts('d1', 2, '2026-11-20'), facts('d2', 1, '2026-11-20'), facts('d3', 1, '2026-11-13'), facts('d4', 0, '2026-11-01', 3), facts('d5', 1, null)], null)
  assert.deepEqual(rows.map(r => r.title), ['Mid brief', 'Ada brief', 'Zed brief', 'No date'])
  assert.equal(rows[0].state, 'Due 13 Nov')
  assert.equal(rows[2].sub, 'Client A · 2 for you')
  assert.ok(rows.every(r => r.path !== 'd4'), 'a document with nothing waiting on me is not a row')
  // a document the library does not list is not drawn
  assert.equal(meRows(items, [facts('gone', 1, null)], null).length, 0)
})

test('five rows, then Show all', () => {
  const items = Array.from({ length: 7 }, (_, i) => doc(`d${i}`, `Brief ${i}`))
  const rows = meRows(items, items.map((i, n) => facts(i.path, 1, `2026-11-${10 + n}`)), null)
  assert.equal(ME_FIRST, 5)
  assert.equal(firstRows(rows, false).shown.length, 5)
  assert.equal(firstRows(rows, false).more, 2)
  assert.equal(firstRows(rows, true).shown.length, 7)
  assert.deepEqual(firstRows(rows.slice(0, 3), false).more, 0)
})

test('the own timesheet reminder is a row of its own, first, with no document', () => {
  const rows = meRows([doc('d1', 'A')], [facts('d1', 1, '2026-11-13')], { job: '', client: '', client_id: '', text: 't', action: 'a', path: '', due: '2026-11-12' })
  assert.equal(rows[0].timesheet, true)
  assert.equal(rows.length, 2)
})

test('an empty list names the next deadline, says none is set, or says only that nothing needs you', () => {
  assert.equal(emptyLine({ job: 'J001', client: 'Client A', client_id: 'c', due: '2026-12-18' }), 'Nothing needs you now. Next deadline: J001, Client A, 18 Dec.')
  assert.equal(emptyLine(null), 'Nothing needs you now. No deadline is set on your jobs.')
  assert.equal(emptyLine(undefined), 'Nothing needs you now.')
})

test('one source: only the desk hook and the set-aside store read the needs route', () => {
  const files: string[] = []
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
  walk(join(process.cwd(), 'src'))
  const readers = files.filter(f => /\bjobNeeds\b/.test(readFileSync(f, 'utf8')) && !f.endsWith('host/http.ts')).map(f => f.split('/src/')[1]).sort()
  assert.deepEqual(readers, ['shell/decisions/asideStore.ts', 'shell/nui/useDeskNeeds.ts'])
  // the retired Done routes and the retired item list are read by nobody
  assert.ok(files.every(f => !/\/done`|markNeedDone|useJobNeeds/.test(readFileSync(f, 'utf8'))))
})
