// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A client's dial on the desk, as the mock draws it (gaps.md D12, D13): four
// quadrants (Brief, Research, Deck, Production) with what is in each, a hub in
// the client's colour that opens the client, number keys 1 to 4.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { LibraryItem } from '../src/host/types.ts'
import { Dial, dialBoxes } from '../src/shell/nui/Dial.tsx'

const c = { id: 'cli_00000001', name: 'Client Alpha', sector: null, look: { cl: '#DA291C', ink: '#FFC72C' } }
const item = (app: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  path: `doc-${Math.random()}`, app_id: app, title: 'Work', updated_at: '2026-11-04T10:00:00Z',
  client: { id: c.id, name: c.name }, state: { needs_you: 0, locked: false }, run: null, ...over,
})
const noop = () => {}
const dial = (items: LibraryItem[], live = new Set(['brief', 'research', 'deck'])) => renderToStaticMarkup(createElement(Dial, {
  client: c, items, live, place: { left: -8, top: -12, origin: '74px 70px' }, onOpenTool: noop, onSoon: noop, onOpenClient: noop, onClose: noop,
}))

test('five quadrants in the order Brief, Research, Territories, Production, Deck, each with its number key and what is in it', () => {
  const html = dial([
    item('ie.napkin.brief-maker', { state: { needs_you: 2, locked: false } }),
    item('ie.napkin.campaign-research', { run: { state: 'working', label: 'x' } }),
  ])
  const ids = [...html.matchAll(/data-testid="quadrant-(\w+)"/g)].map(m => m[1])
  assert.deepEqual(ids, ['brief', 'research', 'territories', 'prod', 'deck'])
  for (let i = 1; i <= 5; i++) assert.match(html, new RegExp(`aria-keyshortcuts="${i}"`))
  assert.match(html, /class="dz-tag">YOUR CALL</)
  assert.match(html, /aria-label="Brief, needs your call"/)
  assert.match(html, /title="Brief Maker for Client Alpha \(1 of 5\)"/, 'who it is for rides on the title')
  assert.match(html, /data-testid="quadrant-research"[^>]*data-activity="work"/, 'the quadrant says its ring\'s verb')
  assert.match(html, /tabindex="0"[^>]*data-testid="quadrant-brief"/)
  assert.match(html, /class="dz-sub">Agents working</)
  assert.match(html, /class="dz-sub">Nothing yet</)
  assert.match(html, /aria-label="Production, coming soon"[^>]*aria-disabled="true"/)
  assert.match(html, /class="dz-rim needs"/)
})

test('the hub is the client in its own colour and opens it; with no sector the name\'s last word goes under', () => {
  const html = dial([])
  assert.match(html, /data-testid="dial-hub"[^>]*style="--cl:#DA291C;--cl-ink:#FFC72C"[^>]*title="Open Client Alpha"/)
  assert.match(html, /<b>Client<\/b><small>Alpha<\/small>/)
  assert.match(html, /left:-8px;top:-12px;transform-origin:74px 70px/)
  assert.ok(html.indexOf('data-testid="dial-hub"') < html.indexOf('data-testid="quadrant-brief"'), 'the hub first: Shift+Tab from the first quadrant reaches it')
})

test('a quadrant counts its work in its own noun', () => {
  const html = dial([item('ie.napkin.deck-maker'), item('ie.napkin.deck-maker'), item('ie.napkin.brief-maker')])
  assert.match(html, /class="dz-sub">2 decks</)
  assert.match(html, /class="dz-sub">1 brief</)
})


test('with the Production Tool served, the Production quadrant is open, not Soon', () => {
  const soon = dial([])
  assert.match(soon, /data-testid="quadrant-prod"[^>]*aria-disabled="true"/)
  const on = dial([], new Set(['brief', 'research', 'deck', 'prod']))
  assert.doesNotMatch(on, /data-testid="quadrant-prod"[^>]*aria-disabled/)
  assert.match(on, /aria-label="Production, nothing yet"/)
})

test('a Soon quadrant dims its words and icon, never its fill (the desk would print through)', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  // npm test runs from app/, and the bundled test does not sit where its source does.
  const css = readFileSync(resolve(process.cwd(), 'src', 'shell', 'nui', 'shell.css'), 'utf8')
  assert.match(css, /\.dial \.dz\[aria-disabled="true"\] > :not\(path\) \{ opacity: \.55; \}/)
  assert.doesNotMatch(css, /\.dial \.dz\[aria-disabled="true"\] \{ opacity/)
})

test('Territories is the third quadrant: its icon, its count, Soon until its app is served', () => {
  const soon = dial([])
  assert.match(soon, /data-testid="quadrant-territories"[^>]*aria-disabled="true"/)
  assert.match(soon, /aria-label="Territories, coming soon"/)
  const live = new Set(['brief', 'research', 'territories', 'deck'])
  const none = dial([], live)
  assert.doesNotMatch(none, /data-testid="quadrant-territories"[^>]*aria-disabled/)
  assert.match(none, /aria-label="Territories, nothing yet"/)
  const two = dial([item('ie.napkin.territories'), item('ie.napkin.territories')], live)
  assert.match(two, /class="dz-sub">2 explorations</)
  assert.match(two, /aria-label="Territories, 2 explorations"/)
  // its icon is the shell's Territories icon (a ring with a core and four ticks)
  assert.match(two, /<circle cx="12" cy="12" r="8"><\/circle><circle cx="12" cy="12" r="3">/)
})

// Owner, 2026-11-23: the segments were not buttons a screen reader or getByRole could reach, the sector text ran out of
// the hub, and the page's text showed past the dial's rim.
test('every quadrant is a real button with a plain name, cut to its own shape; the picture is hidden from a screen reader', () => {
  const html = dial([item('ie.napkin.brief-maker', { state: { needs_you: 1, locked: false } })])
  const buttons = [...html.matchAll(/<button type="button" class="dz-hit"[^>]*>/g)].map(m => m[0])
  assert.equal(buttons.length, 5, 'five buttons')
  const names = buttons.map(b => /aria-label="([^"]+)"/.exec(b)![1])
  assert.deepEqual(names, ['Brief, needs your call', 'Research, nothing yet', 'Territories, coming soon', 'Production, coming soon', 'Deck, nothing yet'])
  for (const [i, b] of buttons.entries()) {
    assert.match(b, new RegExp(`aria-keyshortcuts="${i + 1}"`), 'the keys 1 to 5 stay')
    assert.match(b, /clip-path:url\(#dz-clip-\w+\)/, 'cut to its quadrant')
  }
  assert.equal([...html.matchAll(/<clipPath /g)].length, 5)
  assert.match(html, /<svg class="dial-svg"[^>]*aria-hidden="true"/, 'the picture says nothing the buttons do not')
  assert.doesNotMatch(html, /<g[^>]*role="button"/, 'no button roles on picture parts')
})

test('the hub wraps the sector inside the circle, and an open dial has a backdrop', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const css = readFileSync(resolve(process.cwd(), 'src', 'shell', 'nui', 'nui.css'), 'utf8')
  const small = css.split('\n').find(l => l.includes('.dial-hub:where(.nui, .nui *) small'))!
  assert.match(small, /overflow-wrap: anywhere/)
  assert.doesNotMatch(small, /white-space: nowrap/)
  assert.match(css, /\.dial-hub:where\(\.nui, \.nui \*\) \{[^}]*grid-template-columns: minmax\(0, 1fr\)[^}]*overflow: hidden/s, 'a long sector wraps in a column the hub can hold')
  assert.match(css, /\.dial-scrim:where\(\.nui, \.nui \*\) \{ position: fixed; inset: 0; z-index: 5; background: color-mix\(in srgb, var\(--paper\) 95%/, 'the page behind is covered')
  const desk = readFileSync(resolve(process.cwd(), 'src', 'shell', 'nui', 'Desk.tsx'), 'utf8')
  assert.match(desk, /\{open && place && <div className="dial-scrim"/, 'drawn only while a dial is open')
  const withSector = renderToStaticMarkup(createElement(Dial, { client: { ...c, name: 'Harbour Bakes', sector: 'Bakery · Snacks' }, items: [], live: new Set(['brief']), place: { left: 0, top: 0, origin: '0 0' }, onOpenTool: noop, onSoon: noop, onOpenClient: noop, onClose: noop }))
  assert.match(withSector, /<b>Harbour Bakes<\/b><small>Bakery · Snacks<\/small>/)
})

test('each button’s middle lies in its own quadrant, so a click or getByRole aimed at it does not land on the hub', () => {
  const n = 5, span = (2 * Math.PI) / n, start = -Math.PI / 2 - span / 2
  dialBoxes().forEach((b, i) => {
    const dx = b.x + b.w / 2 - 320, dy = b.y + b.h / 2 - 320, r = Math.hypot(dx, dy)
    let a = Math.atan2(dy, dx)
    while (a < start) a += 2 * Math.PI
    assert.ok(r > 100 && r < 300, `quadrant ${i}: radius ${r.toFixed(0)} is in the ring`)
    assert.ok(a >= start + i * span && a <= start + (i + 1) * span, `quadrant ${i}: angle is in its wedge`)
  })
})
