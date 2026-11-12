// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The open document reads its links and its source again when another
// document changes, and takes its own name from the library once its app
// renamed it (features/spinoff-and-links).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { LibraryItem } from '../src/host/types.ts'
import SaveStatus from '../src/components/SaveStatus.tsx'
import { lastSaved, listedTitle, listedUpdated, othersStamp, savedWords } from '../src/shell/docFreshness.ts'

const it = (path: string, updated_at: string, title = path): LibraryItem => ({
  path, app_id: 'ie.napkin.campaign-research', title, updated_at, client: null, run: null,
})

test('the stamp moves when another document changes, not when the open one does', () => {
  const before = othersStamp([it('r.clan', 't1'), it('b.clan', 't1')], 'r.clan')
  assert.equal(othersStamp([it('r.clan', 't2'), it('b.clan', 't1')], 'r.clan'), before, 'its own write is read by its own hooks')
  assert.notEqual(othersStamp([it('r.clan', 't1'), it('b.clan', 't2')], 'r.clan'), before, 'the brief unlinked or changed')
  assert.equal(othersStamp([it('b.clan', 't1'), it('r.clan', 't1')], 'r.clan'), before, 'order does not matter')
  assert.equal(othersStamp(null, 'r.clan'), '')
})

test('the bar takes the name the library has now', () => {
  const lib = [it('r.clan', 't1', 'Guinness 0.0 · Ireland and Great Britain')]
  assert.equal(listedTitle(lib, 'r.clan'), 'Guinness 0.0 · Ireland and Great Britain')
  assert.equal(listedTitle(lib, 'other.clan'), null)
  assert.equal(listedTitle([it('r.clan', 't1', '  ')], 'r.clan'), null)
  assert.equal(listedTitle(undefined, 'r.clan'), null)
})

test('the saved line always has a time when the document has updated_at (the mock: "saved 37m ago")', () => {
  const now = Date.parse('2026-11-09T12:00:00Z')
  const lib = [it('b.clan', '2026-11-09T11:23:00Z')]
  assert.equal(listedUpdated(lib, 'b.clan'), '2026-11-09T11:23:00Z')
  assert.equal(listedUpdated(lib, 'x.clan'), null)
  // Before any change in this tab: the document's own time, not a bare "saved".
  assert.equal(savedWords(lastSaved(null, '2026-11-09T11:23:00Z'), now), 'saved 37m ago')
  // A change kept in this tab later than the stored time wins, and the other way round.
  assert.equal(savedWords(lastSaved(new Date(now - 30_000), '2026-11-09T11:23:00Z'), now), 'saved just now')
  assert.equal(savedWords(lastSaved(new Date(now - 3_600_000), '2026-11-09T11:58:00Z'), now), 'saved 2m ago')
  assert.equal(savedWords(lastSaved(null, '2026-11-09T09:00:00Z'), now), 'saved 3h ago')
  assert.equal(savedWords(lastSaved(null, '2026-11-07T12:00:00Z'), now), 'saved 2d ago')
  // No time anywhere: the word alone.
  assert.equal(savedWords(lastSaved(null, ''), now), 'saved')
  assert.equal(savedWords(lastSaved(null, 'not a date'), now), 'saved')
})

test('the saved line is the open document’s own updated_at, never a workspace-wide event (UAT 2026-11-12: looking at the map said "saved just now")', () => {
  const html = renderToStaticMarkup(createElement(SaveStatus, { updatedAt: new Date(Date.now() - 19 * 60_000).toISOString() }))
  assert.match(html, /saved 19m ago/)
  // The host's events say no document: a write anywhere must not move this line.
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'src', 'components', 'SaveStatus.tsx')) && dirname(dir) !== dir) dir = dirname(dir)
  const src = readFileSync(join(dir, 'src', 'components', 'SaveStatus.tsx'), 'utf8')
  assert.doesNotMatch(src, /host\.on\(|from '\.\.\/host'/)
})
