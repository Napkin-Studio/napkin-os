// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One way to delete and restore a document in every tool (features/library-trash; the approved mock, owner
// 2026-11-23): the ⋯ and the Trash link on the client page, the Trash page and its empty state, the doc menu's
// Move to Trash, the Trash store (move, Restore, Undo) and the http host's calls to the real routes.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { docMenuItems, type DocBar } from '../src/components/barMenus.ts'
import { httpHost } from '../src/host/http.ts'
import type { ClientRecord, LibraryItem, TrashApi, TrashItem } from '../src/host/types.ts'
import { arrival } from '../src/shell/landing/keys.ts'
import { initialsOf } from '../src/shell/landing/model.ts'
import { PRODUCTION_APP_ID, toolOfApp } from '../src/shell/landing/tools.ts'
import { ClientView } from '../src/shell/nui/ClientView.tsx'
import { TrashPage } from '../src/shell/nui/TrashPage.tsx'
import { TrashDesk, agoWords, daysLeft, trashLine, type TrashState } from '../src/shell/nui/trashDesk.ts'
import { ancestry, correctRoute, formatRoute, parseRoute, sameRoute, up } from '../src/shell/route.ts'

const ID = 'cli_0a1b2c3d'
const NOW = Date.parse('2026-11-23T12:00:00Z')
const DAY = 86_400_000
const client: ClientRecord = { id: ID, name: 'Tidewell', initials: initialsOf('Tidewell'), material: 'pearl', owner: 'human:t', created_at: '2026-11-01T00:00:00Z' }
const BRIEF = 'ie.napkin.brief-maker'
const noop = () => {}
const count = (html: string, re: RegExp) => (html.match(re) || []).length
let seq = 0
const item = (app: string, title: string): LibraryItem => ({
  path: `doc-${++seq}`, app_id: app, title, updated_at: '2026-11-22T10:00:00Z', client: { id: ID, name: 'Tidewell' }, state: { needs_you: 0, locked: false }, run: null,
})
const row = (path: string, title: string, app: string | null, by: string | null, daysAgo: number): TrashItem => ({
  path, title, app_id: app, client_id: ID, by,
  trashed_at: new Date(NOW - daysAgo * DAY).toISOString(), restorable_until: new Date(NOW + (30 - daysAgo) * DAY).toISOString(),
})

/** A Trash that behaves like the host's: delete moves a document in, restore moves it back. */
function fakeTrash(rows: TrashItem[] = [], opts: { refuse?: string } = {}) {
  const calls: string[] = []
  const live = new Set<string>()
  const api: TrashApi = {
    list: async client => { calls.push(`list ${client ?? '*'}`); return rows.filter(r => !client || r.client_id === client) },
    move: async path => {
      calls.push(`move ${path}`)
      if (opts.refuse) throw new Error(opts.refuse)
      rows.unshift(row(path, `Doc ${path}`, BRIEF, 'Aoife', 0)); live.delete(path)
    },
    restore: async path => {
      calls.push(`restore ${path}`)
      const i = rows.findIndex(r => r.path === path)
      if (i < 0) throw new Error('not in the trash')
      rows.splice(i, 1); live.add(path)
    },
  }
  return { api, calls, rows, live }
}

// ── the route ───────────────────────────────────────────────────────────────

test('#trash is the agency Trash and #client-<id>-trash a client\'s; both round-trip', () => {
  assert.deepEqual(parseRoute('#trash'), { level: 'agency', trash: true })
  assert.deepEqual(parseRoute(`#client-${ID}-trash`), { level: 'client', client: ID, trash: true })
  assert.equal(formatRoute({ level: 'agency', trash: true }), '#trash')
  assert.equal(formatRoute({ level: 'client', client: ID, trash: true }), `#client-${ID}-trash`)
  for (const r of [{ level: 'agency', trash: true }, { level: 'client', client: ID, trash: true }] as const) assert.deepEqual(parseRoute(formatRoute(r)), r)
  assert.ok(!sameRoute({ level: 'client', client: ID }, { level: 'client', client: ID, trash: true }))
  // still the landing for anything that is not exactly these
  for (const h of ['#trash-', '#trash/x', '#TRASH', '#client-cli_0a1b2c3d-trash-', '#client-nope-trash', '#client--trash']) assert.deepEqual(parseRoute(h), { level: 'agency' }, h)
})

test('Escape and Back go up from the Trash to where it was opened, and a missing client is still corrected', () => {
  assert.deepEqual(up({ level: 'client', client: ID, trash: true }), { level: 'client', client: ID })
  assert.deepEqual(up({ level: 'agency', trash: true }), { level: 'agency' })
  assert.deepEqual(ancestry({ level: 'client', client: ID, trash: true }).map(formatRoute), ['#agency', '#clients', `#client-${ID}`])
  assert.deepEqual(correctRoute({ level: 'client', client: ID, trash: true }, { client: () => false, tool: () => true }), { level: 'clients' })
  assert.match(arrival({ level: 'client', client: ID, trash: true }, { agency: 'Studio', client: 'Tidewell', tools: 4 }), /Tidewell: Trash/)
  assert.match(arrival({ level: 'agency', trash: true }, { agency: 'Studio', tools: 4 }), /Studio: Trash/)
})

// ── Production belongs under Production ─────────────────────────────────────

test('a Production document is the Production tool\'s, and files under Production on the client page, not Other', () => {
  assert.equal(toolOfApp(PRODUCTION_APP_ID)?.id, 'prod')
  const html = renderToStaticMarkup(createElement(ClientView, {
    client, items: [item(BRIEF, 'Autumn brief'), item(PRODUCTION_APP_ID, 'Summer Zero film')], facts: {}, live: new Set(['brief', 'prod']),
    onOpenItem: noop, onNew: noop, onOpenTool: noop, onSoon: noop,
  }))
  assert.match(html, /data-testid="group-prod"/)
  assert.match(html, /data-testid="group-prod".*?Summer Zero film/s)
  assert.doesNotMatch(html, /data-testid="group-other"/)
})

// ── the client page: ⋯ on every row, the Trash link ─────────────────────────

const page = (items: LibraryItem[], rows: TrashItem[] | null) => {
  const f = rows ? fakeTrash(rows) : null
  const state: TrashState = { rows: rows ?? [], toast: null, error: null, loaded: true }
  return renderToStaticMarkup(createElement(ClientView, {
    client, items, facts: {}, live: new Set(['brief', 'prod']), onOpenItem: noop, onNew: noop, onOpenTool: noop, onSoon: noop,
    trash: f ? { desk: new TrashDesk(f.api, ID, async () => {}), state } : undefined, onOpenTrash: noop,
  }))
}

test('every document row has a quiet ⋯ named for it; the Trash (N) link shows only when N > 0', () => {
  const items = [item(BRIEF, 'Autumn brief'), item(BRIEF, 'Summer refill'), item(PRODUCTION_APP_ID, 'Summer Zero film')]
  const html = page(items, [row('doc-x', 'Old', BRIEF, 'Aoife', 3), row('doc-y', 'Older', BRIEF, 'Marcus', 9)])
  assert.equal(count(html, /data-testid="row-more"/g), 3, 'one per document, Production included')
  assert.match(html, /aria-label="Options for Autumn brief"[^>]*aria-haspopup="menu"/)
  assert.match(html, /data-testid="trash-link"[^>]*>Trash \(2\)</)
  assert.doesNotMatch(page(items, []), /data-testid="trash-link"/, 'nothing deleted: no link')
  const none = page(items, null)
  assert.doesNotMatch(none, /row-more|trash-link/, 'a host with no Trash offers none of it')
  assert.equal(count(none, /data-testid="work-item"/g), 3, 'the rows themselves are unchanged')
})

// ── the Trash page ──────────────────────────────────────────────────────────

const trashPage = (rows: TrashItem[], c: ClientRecord | null = client) => {
  const f = fakeTrash(rows)
  return renderToStaticMarkup(createElement(TrashPage, {
    client: c, agency: 'Studio A', desk: new TrashDesk(f.api, c?.id ?? null, async () => {}),
    state: { rows, toast: null, error: null, loaded: true }, onBack: noop, now: NOW,
  }))
}

test('a new document still titled with its tool\'s name is listed as what it is, not as the tool (UAT round 4 F14)', () => {
  const html = trashPage([
    row('doc-1', 'Brief Maker', BRIEF, 'Aoife', 0),
    row('doc-2', 'Research Tool', 'ie.napkin.campaign-research', 'Aoife', 0),
  ])
  assert.match(html, /<b>New brief<\/b>/)
  assert.match(html, /<b>New question<\/b>/)
  assert.doesNotMatch(html, /<b>(Brief Maker|Research Tool)<\/b>/)
})

test('the Trash page lists any tool\'s documents: icon, title, who and when, and Restore; no permanent delete', () => {
  const html = trashPage([
    row('doc-1', 'Zero Sugar: first-pass brief', BRIEF, 'Aoife', 3),
    row('doc-2', 'Flavoured water: shelf audit', 'ie.napkin.campaign-research', 'Marcus', 9),
    row('doc-3', 'Lakeside teaser cuts', PRODUCTION_APP_ID, 'Aoife', 20),
    row('doc-4', 'Old one', null, null, 1),
  ])
  assert.match(html, /<h1[^>]*>Trash<span class="period-dot"/)
  assert.match(html, /Restorable for 30 days, then gone for good\./)
  assert.equal(count(html, /data-testid="trash-item"/g), 4)
  assert.match(html, /Deleted 3 days ago by Aoife · restorable for 27 more days/)
  assert.match(html, /Deleted 9 days ago by Marcus · restorable for 21 more days/)
  assert.match(html, /Deleted 20 days ago by Aoife · restorable for 10 more days/)
  assert.match(html, /Deleted yesterday · restorable for 29 more days/, 'an older delete has no name to show')
  assert.equal(count(html, /cp-ico k-brief/g), 1)
  assert.equal(count(html, /cp-ico k-research/g), 1)
  assert.equal(count(html, /cp-ico k-production/g), 2, 'Production, and a document whose tool is not known')
  assert.match(html, /aria-label="Restore Zero Sugar: first-pass brief"/)
  assert.equal(count(html, /data-testid="restore"/g), 4)
  assert.doesNotMatch(html, /Delete forever|Empty Trash|permanent/i)
  assert.doesNotMatch(html, /trash-empty/)
  assert.match(html, /← Back to Tidewell/)
})

test('an empty Trash says so, and the agency\'s page is named for the agency', () => {
  assert.match(trashPage([]), /data-testid="trash-empty">Trash is empty\. A document you move here waits for 30 days\.</)
  const agency = trashPage([row('doc-1', 'A', BRIEF, 'Aoife', 0)], null)
  assert.match(agency, />STUDIO A</)
  assert.match(agency, /← Back to Studio A/)
  assert.doesNotMatch(agency, /cl-disc/, 'no client disc on the agency page')
})

test('the words: when it was deleted and how long is left', () => {
  assert.equal(agoWords(new Date(NOW).toISOString(), NOW), 'today')
  assert.equal(agoWords(new Date(NOW - DAY).toISOString(), NOW), 'yesterday')
  assert.equal(agoWords(new Date(NOW - 5 * DAY).toISOString(), NOW), '5 days ago')
  assert.equal(daysLeft(new Date(NOW + 27 * DAY).toISOString(), NOW), 27)
  assert.equal(daysLeft(new Date(NOW - DAY).toISOString(), NOW), 0)
  assert.equal(trashLine(row('d', 't', BRIEF, 'Aoife', 29), NOW), 'Deleted 29 days ago by Aoife · restorable for 1 more day')
})

// ── move, Restore, Undo ─────────────────────────────────────────────────────

test('moving to Trash lists it and re-reads the library; Undo brings it back and says nothing more', async () => {
  const f = fakeTrash()
  let reads = 0
  const desk = new TrashDesk(f.api, ID, async () => { reads++ })
  await desk.reload()
  assert.equal(desk.get().rows.length, 0)
  assert.equal(await desk.move('doc-9'), true)
  assert.deepEqual(desk.get().rows.map(r => r.path), ['doc-9'])
  assert.equal(desk.get().toast?.text, 'Moved to Trash')
  assert.equal(reads, 1, 'the page re-reads its documents')
  desk.get().toast!.undo()
  await new Promise(r => setTimeout(r, 5))
  assert.deepEqual(f.calls.filter(c => c.startsWith('restore')), ['restore doc-9'])
  assert.equal(desk.get().rows.length, 0)
  assert.equal(desk.get().toast, null)
  desk.dismiss()
})

test('Restore returns it with a "Restored" toast whose Undo moves it back to Trash', async () => {
  const f = fakeTrash([row('doc-1', 'Zero Sugar', BRIEF, 'Aoife', 3), row('doc-2', 'Shelf audit', BRIEF, 'Marcus', 9)])
  let reads = 0
  const desk = new TrashDesk(f.api, ID, async () => { reads++ })
  await desk.reload()
  assert.equal(await desk.restore('doc-1'), true)
  assert.deepEqual(desk.get().rows.map(r => r.path), ['doc-2'])
  assert.equal(desk.get().toast?.text, 'Restored')
  assert.equal(reads, 1)
  desk.get().toast!.undo()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(desk.get().rows.length, 2, 'back in the Trash')
  assert.deepEqual(f.calls.filter(c => c.startsWith('move')), ['move doc-1'])
  assert.equal(desk.get().toast, null)
  // restoring the last ones leaves the empty state to show
  await desk.restore('doc-1'); await desk.restore('doc-2')
  assert.equal(desk.get().rows.length, 0)
  assert.equal(desk.get().loaded, true)
  desk.dismiss()
})

test('a refused move or restore says why and leaves the Trash as it was', async () => {
  const f = fakeTrash([row('doc-1', 'Zero Sugar', BRIEF, 'Aoife', 3)], { refuse: 'doc-1 is in the library already' })
  const desk = new TrashDesk(f.api, ID, async () => {})
  await desk.reload()
  assert.equal(await desk.move('doc-5'), false)
  assert.equal(desk.get().error, 'doc-1 is in the library already')
  assert.equal(desk.get().toast, null)
  assert.equal(await desk.restore('doc-404'), false)
  assert.equal(desk.get().rows.length, 1)
  assert.ok(desk.get().error)
})

// ── the http host, on the real routes ───────────────────────────────────────

const TENANT = '00000000-0000-4000-8000-000000000000'
beforeEach(() => { ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://studio.test' } } })

test('the http host lists, moves and restores through GET /trash, DELETE /d/{doc} and POST /d/{doc}/restore', async () => {
  const seen: string[] = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/session') return new Response(JSON.stringify({ tenant: TENANT }), { status: 200, headers: { 'content-type': 'application/json' } })
    seen.push(`${init?.method ?? 'GET'} ${url.replace(`/api/t/${TENANT}`, '')}`)
    const body = url.includes('/trash') ? [{ path: 'doc-1', title: 'T', app_id: BRIEF, client_id: ID, by: 'Aoife', trashed_at: '2026-11-20T00:00:00Z', restorable_until: '2026-12-20T00:00:00Z' }] : { ok: true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const t = httpHost.trash!
  assert.equal((await t.list(ID))[0].by, 'Aoife')
  await t.list()
  await t.move('doc-1')
  await t.restore('doc-1')
  assert.deepEqual(seen, [`GET /trash?client=${ID}`, 'GET /trash', 'DELETE /d/doc-1', 'POST /d/doc-1/restore'])
})

// ── the document menu in any tool ───────────────────────────────────────────

const doc = (over: Partial<DocBar> = {}): DocBar => ({
  title: 'Spring brief', tool: { name: 'Brief' }, toolKey: 'brief', onOpenFile: noop, onToggleSidebar: noop, sidebarOpen: false, onLineage: noop, onSave: noop,
  onKeepOffline: noop, onExport: noop, targets: [], onSpinoff: noop, onToggleEdit: noop, saved: createElement('span'), ...over,
})

test('Move to Trash is the document menu\'s last item in any tool, and is not offered for a template or without a Trash', () => {
  let n = 0
  const items = docMenuItems(doc({ onTrash: () => { n++ } }), noop)
  const last = items[items.length - 1]
  assert.equal(last.label, 'Move to Trash')
  assert.equal(last.hint, 'Restorable for 30 days')
  assert.equal(last.apart, true)
  last.run()
  assert.equal(n, 1)
  assert.ok(!docMenuItems(doc(), noop).some(i => i.label === 'Move to Trash'), 'no Trash on this host')
  assert.ok(!docMenuItems(doc({ onTrash: noop, isTemplate: true }), noop).some(i => i.label === 'Move to Trash'), 'a template is never deleted')
})
