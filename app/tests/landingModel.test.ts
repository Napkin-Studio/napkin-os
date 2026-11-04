// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the landing says: urgency order, the counts line, a client's status line,
// search and Show all (features/landing-circles.clan). Client names here are
// placeholders only.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ClientRecord, LibraryItem } from '../src/host/types.ts'
import {
  activityOf, agencySummary, boxFor, circleName, countsLine, FIRST_PAGE, initialsOf, matches, needsYou,
  ordered, pageOf, plural, summarise, whoIs,
} from '../src/shell/landing/model.ts'
import { TOOLS, isLive, toolOfApp } from '../src/shell/landing/tools.ts'
import { greeting, lastTouched } from '../src/shell/when.ts'

const client = (n: number, name = `Client ${String.fromCharCode(64 + n)}`): ClientRecord => ({
  id: `cli_${String(n).padStart(8, '0')}`, name, initials: initialsOf(name), material: 'pearl',
  owner: 'human:test', created_at: '2026-11-01T00:00:00Z',
})

let seq = 0
const item = (c: ClientRecord | null, app: string | null, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${++seq}`, app_id: app, title: `Doc ${seq}`, updated_at: `2026-11-0${(seq % 9) + 1}T10:00:00Z`,
  client: c ? { id: c.id, name: c.name } : null, state: { needs_you: 0, locked: false }, run: null, ...over,
})
const BRIEF = 'ie.napkin.brief-maker'
const RESEARCH = 'ie.napkin.campaign-research'

test('a client is counted by tool, and the status line says only what is so', () => {
  const a = client(1)
  const s = summarise(a, [
    item(a, BRIEF), item(a, BRIEF, { state: { needs_you: 2, locked: false } }),
    item(a, BRIEF, { run: { state: 'working', label: 'Drafting' } }),
    item(a, RESEARCH), item(client(2), BRIEF),
  ])
  assert.equal(s.total.open, 4)
  assert.equal(s.perTool.brief.open, 3)
  assert.equal(s.perTool.research.open, 1)
  assert.equal(s.perTool.deck.open, 0)
  assert.equal(s.total.needsYou, 1, 'a document with things to check is one that needs you')
  assert.equal(s.total.running, 1)
  assert.equal(s.status, '3 briefs · needs you · 1 running')
  assert.equal(s.activity, 'human')
})

test('an empty client says so, and an unlisted app is counted but not as a tool', () => {
  const a = client(1)
  assert.equal(summarise(a, []).status, 'No work yet')
  assert.equal(summarise(a, []).activity, 'idle')
  const s = summarise(a, [item(a, 'ie.napkin.something-else'), item(a, null)])
  assert.equal(s.total.open, 2)
  assert.equal(s.other.open, 2)
  assert.equal(s.status, '2 pieces of work')
  assert.equal(summarise(a, [item(a, BRIEF)]).status, '1 brief')
})

test('ring priority is human, then error, then work, then idle', () => {
  const t = (needs: number, failed: number, running: number) => ({ open: 1, needsYou: needs, failed, running })
  assert.equal(activityOf(t(1, 1, 1)), 'human')
  assert.equal(activityOf(t(0, 1, 1)), 'error')
  assert.equal(activityOf(t(0, 0, 1)), 'work')
  assert.equal(activityOf(t(0, 0, 0)), 'idle')
})

test('needs you is the host\'s own count, not a locked document, and a run waiting at a gate', () => {
  const a = client(1)
  assert.ok(needsYou(item(a, BRIEF, { state: { needs_you: 1, locked: false } })))
  assert.ok(!needsYou(item(a, BRIEF, { state: { needs_you: 1, locked: true } })))
  assert.ok(!needsYou(item(a, BRIEF, { state: null })))
  assert.ok(needsYou(item(a, 'ie.napkin.deck-maker', { run: { state: 'waiting', label: 'Waiting at the gate' } })))
  assert.ok(!needsYou(item(a, BRIEF, { run: { state: 'working', label: 'x' } })))
})

test('urgent clients come first, and ties keep the order the clients were made in', () => {
  const [a, b, c, d] = [1, 2, 3, 4].map(n => client(n))
  const items = [
    item(b, BRIEF, { run: { state: 'working', label: 'x' } }),
    item(c, BRIEF, { state: { needs_you: 1, locked: false } }),
    item(d, BRIEF, { run: { state: 'failed', label: 'x' } }),
    item(a, BRIEF),
  ]
  assert.deepEqual(ordered([a, b, c, d], items).map(s => s.client.name), ['Client C', 'Client D', 'Client B', 'Client A'])
  assert.deepEqual(ordered([a, b, c, d], []).map(s => s.client.name), ['Client A', 'Client B', 'Client C', 'Client D'])
})

test('the counts line leaves out what is zero and counts the real things', () => {
  const [a, b] = [client(1), client(2)]
  const items = [
    item(a, BRIEF, { state: { needs_you: 1, locked: false } }), item(a, BRIEF), item(b, RESEARCH, { run: { state: 'working', label: 'x' } }),
    item(null, BRIEF),
  ]
  const s = agencySummary([a, b], items, 1)
  assert.equal(countsLine(s), '2 clients · 4 open · 1 needs you · 1 running')
  assert.equal(s.unassigned, 1)
  assert.equal(countsLine(agencySummary([a], [], 0)), '1 client · 0 open')
  assert.equal(countsLine(agencySummary([], [], 0)), 'No clients yet')
  assert.equal(countsLine(agencySummary([], [item(null, BRIEF)], 1)), '1 piece of work and no clients yet')
})

test('search matches names without case or spacing; Show all and the page size', () => {
  assert.ok(matches('Client  A', 'client a'))
  assert.ok(matches('Client A', ' lient '))
  assert.ok(!matches('Client A', 'zzz'))
  assert.ok(matches('Anything', ''))

  const many = Array.from({ length: 11 }, (_, i) => summarise(client(i + 1, `Client ${String.fromCharCode(65 + i)}`), []))
  const first = pageOf(many, '', false)
  assert.equal(first.shown.length, FIRST_PAGE)
  assert.equal(first.hidden, 3)
  assert.ok(first.paged)
  assert.equal(pageOf(many, '', true).shown.length, 11)
  assert.equal(pageOf(many, '', true).hidden, 0)
  assert.deepEqual(pageOf(many, 'client k', false).shown.map(s => s.client.name), ['Client K'])
  const few = many.slice(0, FIRST_PAGE)
  assert.ok(!pageOf(few, '', false).paged, 'search and Show all appear only beyond a page')
  assert.equal(pageOf(few, '', false).hidden, 0)
})

test('the first three circles are large once there are many', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(i => boxFor(i, 5)), [144, 144, 144, 144, 144])
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(i => boxFor(i, 7)), [144, 144, 144, 89, 89, 89, 89])
})

test('a circle is named in words: client, status, idle', () => {
  const a = client(1)
  assert.equal(circleName(summarise(a, [item(a, BRIEF, { state: { needs_you: 1, locked: false } })])), 'Client A, 1 brief · needs you. Opens its tools')
  assert.equal(circleName(summarise(a, [])), 'Client A, No work yet, idle. Opens its tools')
})

test('initials follow the host\'s rule', () => {
  assert.equal(initialsOf('Client A'), 'CA')
  assert.equal(initialsOf('jameson'), 'JA')
  assert.equal(initialsOf('a b c'), 'AB')
  assert.equal(initialsOf('  '), '')
  assert.equal(initialsOf('Ólafsson Co'), 'ÓC')
})

test('who is signed in gives a first name and an agency, and says nothing it does not know', () => {
  assert.deepEqual(whoIs({ id: 'sam.lee@studio-a', name: null }), { first: 'Sam.Lee', agency: 'Studio-A' })
  assert.deepEqual(whoIs({ id: 'sam@studio', name: 'Sam Lee' }), { first: 'Sam', agency: 'Studio' })
  assert.deepEqual(whoIs({ id: '3f9a2b1c', name: null }), { first: null, agency: 'Your studio' })
  assert.deepEqual(whoIs({ id: 'local', name: null }), { first: null, agency: 'Your studio' })
  assert.deepEqual(whoIs(null), { first: null, agency: 'Your studio' })
})

test('the tool table: six tools, each live only with its app installed', () => {
  assert.deepEqual(TOOLS.map(t => t.id), ['brief', 'research', 'idea', 'deck', 'prod', 'ads'])
  const installed = [{ app_id: BRIEF }, { app_id: 'ie.napkin.deck-maker' }]
  assert.deepEqual(TOOLS.filter(t => isLive(t, installed)).map(t => t.id), ['brief', 'deck'])
  // Idea and Prod have no app to install: they are Soon whatever is installed.
  const all = TOOLS.filter(t => t.appId).map(t => ({ app_id: t.appId! }))
  assert.deepEqual(TOOLS.filter(t => !isLive(t, all)).map(t => t.id), ['idea', 'prod'])
  assert.equal(toolOfApp(BRIEF)?.id, 'brief')
  assert.equal(toolOfApp('ie.napkin.film')?.id, 'ads')
  assert.equal(toolOfApp(null), undefined)
  assert.equal(toolOfApp('nope'), undefined)
})

test('plurals and the greeting', () => {
  assert.equal(plural(1, 'client'), '1 client')
  assert.equal(plural(2, 'client'), '2 clients')
  assert.equal(plural(0, 'piece of work', 'pieces of work'), '0 pieces of work')
  assert.equal(greeting(new Date(2026, 10, 4, 9)), 'Good morning.')
  assert.equal(greeting(new Date(2026, 10, 4, 14)), 'Good afternoon.')
  assert.equal(greeting(new Date(2026, 10, 4, 20)), 'Good evening.')
  assert.equal(lastTouched('not a date'), '')
  assert.match(lastTouched('2026-11-04T09:00:00', new Date(2026, 10, 4, 12)), /^Today, /)
  assert.match(lastTouched('2026-11-03T09:00:00', new Date(2026, 10, 4, 12)), /^Yesterday, /)
})
