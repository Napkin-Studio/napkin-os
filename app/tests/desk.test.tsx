// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The desk and one client's page as the approved mock draws them (gaps.md §1,
// §2, §10), rendered from data with no host: the greeting and the circles
// with their needs badges and lines, Find a client, Archived and ⋯, Show all
// past a page, Pick up (Everyone / Me) and Worth a look, the empty desk, the
// add form, and the client page's groups, Needs you and Brand Clan card. What
// the old agency home and clients wheel said (counts, strips, state in words)
// is checked where it lives now. Placeholder names.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ClientRecord, LibraryItem } from '../src/host/types.ts'
import { AddForm, Desk } from '../src/shell/nui/Desk.tsx'
import { ClientView } from '../src/shell/nui/ClientView.tsx'
import { CLIENT_LOOKS, ago, clientLine, clientLook, deskClients, pickRows, stateWords, worthItems, type DocFacts } from '../src/shell/nui/deskData.ts'
import { clientBrand, setClientAgency, slugOf } from '../src/shell/agency/clients.ts'
import { agencyNameOf } from '../src/shell/agency/palette.ts'
import { initialsOf } from '../src/shell/landing/model.ts'
import type { LandingData } from '../src/shell/landing/store.ts'

const name = (i: number) => `Client ${String.fromCharCode(65 + i)}`
const client = (i: number): ClientRecord => ({
  id: `cli_${String(i + 1).padStart(8, '0')}`, name: name(i), initials: initialsOf(name(i)), material: 'pearl', owner: 'human:t', created_at: '2025-03-01T00:00:00Z',
})
let seq = 0
const item = (c: ClientRecord | null, app: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${++seq}`, app_id: app, title: `Work ${seq}`, updated_at: '2026-11-04T10:00:00Z',
  client: c ? { id: c.id, name: c.name } : null, state: { needs_you: 0, locked: false }, run: null, ...over,
})
const BRIEF = 'ie.napkin.brief-maker', RESEARCH = 'ie.napkin.campaign-research', DECK = 'ie.napkin.deck-maker'
const noop = () => {}
const count = (html: string, re: RegExp) => (html.match(re) || []).length
const LIVE = new Set(['brief', 'research', 'deck'])
const data = (clients: ClientRecord[], items: LibraryItem[] = []): LandingData => ({
  clients, items, unassigned: items.filter(i => !i.client).length, person: { actor: 'human:sam@studio-a', id: 'sam@studio-a', name: 'Sam Test' }, apps: [BRIEF, RESEARCH, DECK],
})
const desk = (d: LandingData, extra: Partial<Parameters<typeof Desk>[0]> = {}) => renderToStaticMarkup(createElement(Desk, {
  data: d, facts: {}, live: LIVE, first: 'Sam', onAdd: async () => null, onOpenClient: noop, onOpenTool: noop, onSoon: noop,
  onOpenDocument: noop, onSay: noop, onOpenFile: noop, onOffline: noop, ...extra,
}))

test('the desk: eyebrow, Clients., the greeting, Find a client and ⋯ always, one circle per client', () => {
  const [a, b, c] = [client(0), client(1), client(2)]
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 3, locked: false } }),
    item(b, DECK, { title: 'Pitch', run: { state: 'working', label: 'Building: Layout' } }),
    item(null, BRIEF, { title: 'Loose one' }),
  ]
  const html = desk(data([a, b, c], items))
  assert.match(html, />YOUR DESK · 3 CLIENTS · 3 OPEN · 1 NEEDS YOU · 1 RUNNING</, 'the old agency home\'s counts line, in the eyebrow')
  assert.match(html, /data-testid="unassigned">1 piece of work is not attached to a client yet\./)
  assert.match(html, /<h1[^>]*>Clients<span class="period-dot"/)
  assert.match(html, /Good (morning|afternoon|evening), Sam\. Pick a client to open their work, or add a new one\./)
  assert.match(html, /placeholder="Find a client"/, 'search is always there, not only past a page')
  assert.match(html, /data-testid="desk-more"/)
  assert.equal(count(html, /data-testid="client-circle"/g), 3)
  // the badge is the calls, the line names the work (what the strips said, now on the circle)
  assert.match(html, /data-testid="needs-badge">3</)
  assert.match(html, /class="cl-line">Spring brief · 3 need you</)
  assert.match(html, /class="cl-line">Pitch · agents working</)
  assert.match(html, /class="cl-line">No work yet</)
  assert.match(html, /aria-description="Client A: Spring brief · 3 need you\. 3 need you\. Opens its tools"/)
  // urgent first (needs you, running, then the rest), one tab stop, each saying its ring's verb in words
  assert.ok(html.indexOf('Client A') < html.indexOf('Client B') && html.indexOf('Client B') < html.indexOf('Client C'))
  assert.match(html, /aria-description="Client B: Pitch · agents working, working\. Opens its tools" data-testid="client-circle" data-activity="work"/)
  assert.match(html, /aria-description="Client C: No work yet, idle\. Opens its tools"/)
  assert.equal(count(html, /class="cl-circle[^"]*"[^>]*tabindex="0"/g), 1)
  assert.equal(count(html, /class="cl-circle[^"]*"[^>]*tabindex="-1"/g), 2)
  // no legend: every state is in words on its circle
  assert.doesNotMatch(html, /Every state is also said in words/)
})

test('Pick up where you left off: the newest work with its client and state; Worth a look beside it', () => {
  const a = client(0)
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 2, locked: false } }),
    item(a, RESEARCH, { title: 'Category scan', run: { state: 'working', label: 'Working', stage: 'research' } }),
    item(null, BRIEF, { title: 'Loose one', state: { needs_you: 0, locked: true } }),
    item(a, BRIEF, { title: 'Fourth' }),
  ]
  const html = desk(data([a], items))
  assert.equal(count(html, /data-testid="pick-row"/g), 3, 'three at most')
  assert.match(html, /<b>Spring brief<\/b><small>Client A · /)
  assert.match(html, /class="pk-st needs">2 calls</)
  assert.match(html, /class="pk-st ">Agents working</)
  assert.match(html, /<b>Loose one<\/b><small>No client · /, 'work with no client is still picked up')
  assert.match(html, /class="pk-st ">Done</)
  assert.match(html, /aria-pressed="true"[^>]*>Everyone</)
  assert.match(html, /data-testid="worth-a-look"/)
})

test('Me is what this person wrote last (the library\'s last_editor); an entry without one is not theirs', () => {
  const a = client(0)
  const items = [
    item(a, BRIEF, { title: 'Mine', last_editor: 'sam@studio-a' }),
    item(a, BRIEF, { title: 'Theirs', last_editor: 'aoife@studio-a' }),
    item(a, BRIEF, { title: 'Unknown' }),
  ]
  const now = new Date('2026-11-06T10:00:00Z')
  const me = pickRows(items, {}, 'me', 'sam@studio-a', now)
  assert.deepEqual(me.map(r => r.title), ['Mine'])
  assert.match(me[0].sub, /^Client A · edited by you 2 days ago$/)
  const all = pickRows(items, {}, 'all', 'sam@studio-a', now)
  assert.match(all[1].sub, /^Client A · Aoife, 2 days ago$/)
  assert.deepEqual(pickRows(items, {}, 'me', null, now), [], 'nobody signed in: nothing is Me')
})

test('Worth a look is what can be derived: thin findings, an upstream change, finished research; nothing about layers', () => {
  const a = client(0)
  const r = item(a, RESEARCH, { title: 'Category scan', run: { state: 'done', label: 'Done' } })
  const b = item(a, BRIEF, { title: 'Spring brief' })
  const f = (over: Partial<DocFacts>): DocFacts => ({ editor: null, calls: [], thin: [], upstreamChanged: null, locked: false, canLock: true, decisions: 0, ...over })
  const w = worthItems([b, r], { [b.path]: f({ thin: [{ text: 'Finding · Two clips only' }], upstreamChanged: { title: 'Category scan' } }) })
  assert.deepEqual(w.map(x => x.title), ['A thin finding is waiting', 'Category scan changed', 'Client A: Category scan is done'])
  assert.match(w[0].sub, /^Two clips only · Spring brief$/)
  assert.ok(!w.some(x => /tracker|layer/i.test(x.title)))
})

test('the empty desk: the greeting says to add the first client, the row has only the add circle, no lower grid', () => {
  const html = desk(data([]))
  assert.match(html, />YOUR DESK · NO CLIENTS YET</)
  assert.match(html, /Add your first client to start their desk\./)
  assert.match(html, /class="cl-name">Add your first client</)
  assert.doesNotMatch(html, /client-circle/)
  assert.doesNotMatch(html, /p33-desk"/)
})

test('a desk with clients but no work says so in each section', () => {
  const html = desk(data([client(0)]))
  assert.match(html, /Nothing to pick up yet\. Open a client to start the first piece of work\./)
  assert.match(html, /Nothing new since you last looked\./)
})

test('beyond eight clients: eight circles, then Show all', () => {
  const cs = Array.from({ length: 11 }, (_, i) => client(i))
  const html = desk(data(cs))
  assert.equal(count(html, /data-testid="client-circle"/g), 8)
  assert.match(html, /data-testid="show-all"[^>]*>\s*Show all 11/)
  for (const n of [20, 100]) {
    const many = Array.from({ length: n }, (_, i) => ({ ...client(0), id: `cli_${String(i + 1).padStart(8, '0')}`, name: `Client ${i}` }))
    assert.equal(count(desk(data(many)), /data-testid="client-circle"/g), 8, `${n} clients`)
  }
})

test('Archived · N is on the desk where the registry can be managed', () => {
  assert.doesNotMatch(desk(data([client(0)])), /archived-link/)
  const manage = { rename: async () => null, archive: async () => null, restore: async () => null, archived: async () => [], legacy: async () => [], adopt: async () => ({ words: '' }) }
  assert.match(desk(data([client(0)]), { manage }), /data-testid="archived-link"[^>]*>Archived · 0</)
})

test('the add form: Client name and Sector, sixty characters each, Add client and Cancel', () => {
  const html = renderToStaticMarkup(createElement(AddForm, { onAdd: async () => null, onClose: noop }))
  assert.match(html, /<label>Client name<input[^>]*placeholder="e\.g\. Kerrygold"/)
  assert.match(html, /<label>Sector<input[^>]*placeholder="e\.g\. Dairy · Export"/)
  assert.equal(count(html, /maxLength="60"|maxlength="60"/gi), 2)
  assert.match(html, />Add client</)
  assert.match(html, />Cancel</)
})

test('client looks: the admin registry by id or name slug, its display name; else a colour hashed from the id', () => {
  assert.equal(slugOf('McDonald\'s Ireland'), 'mcdonalds-ireland')
  assert.equal(slugOf('Diageo · Guinness 0.0'), 'diageo-guinness-0-0')
  setClientAgency('tia@tbwa')
  assert.deepEqual(clientLook('cli_00000009', 'McDonald\'s Ireland'), { cl: '#DA291C', ink: '#FFC72C' })
  assert.deepEqual(clientBrand({ id: 'x', name: 'Bord Bia · Origin Green' }), { base: '#1F6B3A', accent: '#CDE8B5' })
  const hashed = clientLook('cli_00000001', 'Nobody Known')
  assert.ok(CLIENT_LOOKS.includes(hashed))
  assert.deepEqual(clientLook('cli_00000001', 'Nobody Known'), hashed, 'the same client, the same colour')
  setClientAgency('sam@nowhere')
  assert.equal(clientBrand({ id: 'x', name: 'McDonald\'s Ireland' }), null, 'another agency, another registry')
  setClientAgency(null)
  assert.equal(agencyNameOf('tia@tbwa', 'Tbwa'), 'TBWA\\Dublin')
  assert.equal(agencyNameOf('sam@wk', 'Wk'), 'Wieden+Kennedy')
  assert.equal(agencyNameOf('ann@elsewhere', 'Elsewhere'), 'Elsewhere')
})

test('lines and states in words', () => {
  const a = client(0)
  assert.equal(clientLine([]), 'No work yet')
  assert.equal(clientLine([item(a, BRIEF, { title: 'X', state: { needs_you: 1, locked: false } })]), 'X · 1 needs you')
  assert.equal(clientLine([item(a, BRIEF, { title: 'X', state: { needs_you: 0, locked: true } })]), 'X · done')
  assert.equal(clientLine([item(a, BRIEF, { title: 'X', run: { state: 'failed', label: 'Failed' } })]), 'X · failed')
  assert.equal(stateWords(item(a, BRIEF, { run: { state: 'waiting', label: 'Asked' } })).text, 'Your answer')
  assert.equal(ago('2026-11-06T09:56:00Z', new Date('2026-11-06T10:00:00Z')), '4m ago')
  assert.equal(deskClients([a], [item(a, BRIEF, { state: { needs_you: 2, locked: false } }), item(a, BRIEF, { run: { state: 'waiting', label: 'x' } })])[0].badge, 3)
})

// ── the client page ─────────────────────────────────────────────────────────

const page = (items: LibraryItem[], extra: Partial<Parameters<typeof ClientView>[0]> = {}) => renderToStaticMarkup(createElement(ClientView, {
  client: client(0), items, facts: {}, live: LIVE, onOpenItem: noop, onNew: noop, onOpenTool: noop, onSoon: noop, ...extra,
}))

test('the client page: since, the name, a line naming the work, Needs you, work by tool with +, no wheel', () => {
  const a = client(0)
  const items = [
    item(a, BRIEF, { title: 'Spring brief', state: { needs_you: 2, locked: false } }),
    item(a, BRIEF, { title: 'Autumn brief' }),
    item(a, DECK, { title: 'Pitch' }),
    item(a, 'ie.napkin.other', { title: 'Odd one' }),
  ]
  const html = page(items)
  assert.match(html, />CLIENT · SINCE MAR 2025</)
  assert.match(html, /<h1[^>]*>Client A<span class="period-dot"/)
  assert.match(html, /Spring brief live · 2 calls need you/)
  assert.match(html, /data-testid="client-needs"/)
  assert.match(html, /class="cp-st needs">2 calls</)
  for (const g of ['brief', 'research', 'deck', 'other']) assert.match(html, new RegExp(`data-testid="group-${g}"`))
  assert.doesNotMatch(html, /data-testid="group-prod"/, 'Production once there is some')
  assert.match(html, /data-testid="group-research".*?Nothing here yet\./s)
  assert.match(html, /data-testid="new-brief"[^>]*>\+</)
  assert.match(html, /aria-label="New deck for Client A"/)
  assert.equal(count(html, /data-testid="work-item"/g), 5, 'each document in its group, the one that needs you also on top')
  // no wheel: each group's heading is its tool's door, one tab stop for them, named with its count
  assert.match(html, /aria-description="Brief Maker for Client A, 2 open, needs you \(1 of 4\)"/)
  assert.match(html, /data-testid="tool-brief"[^>]*tabindex="0"|tabindex="0"[^>]*data-testid="tool-brief"/)
  assert.match(html, /data-testid="tool-deck"[^>]*tabindex="-1"|tabindex="-1"[^>]*data-testid="tool-deck"/)
  assert.match(html, /role="group" aria-label="Tools for Client A"/)
  assert.match(html, /aria-description="Research Tool for Client A, none open, start one \(2 of 4\)"/)
  assert.match(html, /class="cp-st ">Draft</)
})

test('a new client: No work yet, Briefs and Research each say Nothing here yet', () => {
  const html = page([])
  assert.match(html, /data-testid="client-line">No work yet</)
  assert.equal(count(html, /Nothing here yet\./g), 2)
  assert.match(html, /No work yet\. Start the first brief or research for Client A with its \+\./)
})

test('Brand Clan: nothing invented; Open kit kept, disabled, saying why; its document listed once there is one', () => {
  const html = page([])
  assert.match(html, /Brand Clan · not started/)
  assert.match(html, /data-testid="brand-start"/)
  assert.match(html, /aria-disabled="true"[^>]*aria-describedby="cp-clan-why"|aria-describedby="cp-clan-why"[^>]*data-testid="brand-start"/)
  assert.match(html, /arrives with the Brand Clan app/)
  const withKit = page([item(client(0), 'ie.napkin.brand', { title: 'Client A brand' })])
  assert.match(withKit, /data-testid="brand-clan".*Client A brand/s)
  assert.doesNotMatch(withKit, /not started/)
})

test('Rename and Archive live in the ⋯ menu, only where the registry can be managed; Production says Soon', () => {
  assert.doesNotMatch(page([]), /data-testid="client-more"/)
  assert.match(page([], { onRename: async () => null, onArchive: async () => null }), /aria-label="Options for Client A"/)
  const prod = page([item(client(0), 'ie.napkin.film', { title: 'Film' })], { live: LIVE })
  assert.doesNotMatch(prod, /group-ads/)
})
