// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one OS bar (features/new-ui-shell.clan): every action the old bar and
// its More ▾ menu held keeps a visible home in the new bar or its slot menus,
// in each state of the shell: the desk, a document, a document in edit mode,
// a locked one (client review offered), client review itself, and the device.
// Owner rule: no feature that exists today may be removed or hidden.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import Toolbar from '../src/components/Toolbar.tsx'
import { continueItems, deskItems, madeFromOf, moreItems, type DocBar } from '../src/components/barMenus.ts'
import { __test as dogfood } from '../src/dogfood/recorder.ts'
import { barFrom } from '../src/shell/appBar.ts'
import { Trail } from '../src/shell/landing/Trail.tsx'

const noop = () => {}
const doc = (over: Partial<DocBar> = {}): DocBar => ({
  title: 'Spring brief', tool: { name: 'Brief' },
  onOpenFile: noop, onToggleSidebar: noop, sidebarOpen: false, onWorkspace: noop, onSave: noop,
  onKeepOffline: noop, onExport: noop, targets: [{ app_id: 'ie.napkin.deck-maker', name: 'Deck Maker', version: '1' }],
  onSpinoff: noop, onToggleEdit: noop, saved: createElement('span', { className: 'ch-saved' }, 'Saved'), ...over,
})
const bar = (props: Partial<Parameters<typeof Toolbar>[0]> = {}) => renderToStaticMarkup(createElement(Toolbar, {
  agency: 'Studio A', onAgency: noop, onHome: noop, needs: 0, onDecisions: noop, ...props,
}))
const labels = (items: { label: string }[]) => items.map(i => i.label)

test('the desk: medallion, agency pill, where you are, Offline, the theme, Decisions with the count, Sign out in More', () => {
  dogfood({ on: true, consented: false })
  const crumbs = createElement(Trail, { route: { level: 'clients' }, agency: 'Studio A', noAgency: true, onGo: noop })
  const html = bar({
    needs: 3, crumbs, user: 'sam@studio-a', onSignOut: noop,
    tools: createElement('button', { className: 'ch-btn' }, 'Offline'),
  })
  dogfood({ on: false, consented: false })
  assert.match(html, /data-where="desk"/)
  assert.match(html, /data-testid="medallion"/)
  assert.match(html, /class="ch-agency"[^>]*>.*Studio A.*Napkin Studio/)
  assert.match(html, />Clients</, 'the trail below the agency')
  assert.doesNotMatch(html, /lc-crumb"[^>]*data-level="agency"/, 'the agency is the pill, not a crumb')
  assert.match(html, />Offline</)
  assert.match(html, />Beta</, 'DogfoodBadge')
  assert.match(html, /Switch to (light|dark) mode/, 'ThemeToggle')
  assert.match(html, /aria-label="Decisions: 3 need your call"/)
  assert.match(html, /data-testid="needs-count">3</)
  assert.match(html, /aria-haspopup="menu"[^>]*>More /)
  assert.deepEqual(labels(deskItems('sam@studio-a', noop)), ['Sign out'])
  assert.deepEqual(deskItems(null, noop), [], 'no accounts, no Sign out')
  assert.doesNotMatch(html, /data-attention/, 'the desk never lights the medallion')
})

test('a document: the slot holds the tool, the title, the state, Continue in and More; Share, Saved and the chips are on the bar', () => {
  const items = barFrom({ v: 1, items: [
    { kind: 'button', id: 'a', label: 'Build', primary: true }, { kind: 'button', id: 'b', label: 'Check' }, { kind: 'button', id: 'c', label: 'Rerun' },
    { kind: 'chip', label: '0 errors', tone: 'ok' },
  ] })
  const html = bar({
    needs: 2, attention: true, decisionsOpen: true,
    doc: doc({ bar: items, isTemplate: true, trusted: true, validation: 'bad header', state: { label: 'Needs you (2)', tone: 'warn', locked: false } }),
  })
  for (const want of ['>Brief<', '>Spring brief<', 'Needs you (2)', '>Continue in <', '>More <', '>Share<', '>Saved<',
    '>Template<', '>Trusted<', 'Something’s wrong with this file', '>0 errors<', '>Build<', '>Check<']) {
    assert.ok(html.includes(want), `bar shows ${want}`)
  }
  assert.ok(!html.includes('>Rerun<'), 'a third app button goes to More')
  assert.match(html, /data-attention="true"/, 'the app you are in needs you: the medallion says so')
  assert.match(html, /aria-expanded="true"[^>]*data-testid="decisions"/)
  const more = labels(moreItems(doc({ bar: items }), 'sam@studio-a', noop))
  assert.deepEqual(more, ['Rerun', 'Edit', 'Open…', 'Save as…', 'Present offline', 'Export', 'Where it came from', 'Show the file’s details', 'Sign out'])
  assert.ok(!more.some(l => l.startsWith('Continue in')), 'Continue in is not in More')
  const cont = continueItems(doc())
  assert.deepEqual(labels(cont.spin), ['Continue in Deck Maker'])
  assert.deepEqual(cont.link, [], 'the Link group waits for the general attach (feat/brand-clan)')
  assert.deepEqual(cont.update, [], 'made from nothing: nothing to update from')
})

test('Continue in ▾ groups: Turn it into, Link to an existing one, and Made from with Update when the parent changed', () => {
  let updated = 0
  const changed = doc({ madeFrom: { title: 'Lúnasa research', changed: true, decisionsSince: 2 }, onUpdateFromUpstream: () => { updated++ } })
  const cont = continueItems(changed)
  assert.deepEqual(labels(cont.update), ['Update from Lúnasa research'])
  assert.match(cont.update[0].hint ?? '', /2 new decisions/)
  cont.update[0].run()
  assert.equal(updated, 1)
  // Current, or locked (no update handler): nothing to run, and the group says why.
  assert.deepEqual(continueItems(doc({ madeFrom: { title: 'Lúnasa research', changed: false }, onUpdateFromUpstream: noop })).update, [])
  assert.deepEqual(continueItems(doc({ madeFrom: { title: 'Lúnasa research', changed: true } })).update, [])
  // The menu itself is closed in static markup; its groups are in the source.
  const src = readFileSync('src/components/Toolbar.tsx', 'utf8')
  for (const want of ["'Turn it into'", "'Link to an existing one'", "'Made from'", 'Up to date with', 'A locked version keeps what it was made from']) {
    assert.ok(src.includes(want), `Toolbar has ${want}`)
  }
})

test('the old More menu\'s every action still has a home in the new bar (inventory)', () => {
  const OLD = ['Edit', 'Open…', 'Save as…', 'Present offline', 'Export', 'Where it came from', 'Show the file’s details', 'Sign out']
  const now = labels(moreItems(doc(), 'sam', noop))
  for (const l of OLD) assert.ok(now.includes(l), `${l} has a home`)
  assert.ok(labels(moreItems(doc({ sidebarOpen: true }), 'sam', noop)).includes('Hide the file’s details'))
  assert.ok(!labels(moreItems(doc({ onKeepOffline: undefined }))).includes('Present offline'), 'only where it makes sense, as before')
})

test('edit mode: Done editing on the bar, Edit leaves More', () => {
  const html = bar({ doc: doc({ editMode: true }) })
  assert.match(html, />Done editing</)
  assert.ok(!labels(moreItems(doc({ editMode: true }))).includes('Edit'))
})

test('a locked document: Client review, or New client answer once the client has answered', () => {
  assert.match(bar({ doc: doc({ onToggleEdit: undefined, onClientReview: noop }) }), />Client review</)
  assert.match(bar({ doc: doc({ onToggleEdit: undefined, onClientReview: noop, clientAnswered: true }) }), />New client answer</)
})

test('client review: the bar is the mode\'s, with the tag and Cancel', () => {
  const html = bar({ doc: doc({ clientMode: { onCancel: noop } }) })
  assert.match(html, /data-where="client-review"/)
  assert.match(html, /Client review<\/span>/)
  assert.match(html, />Cancel</)
  assert.ok(!html.includes('>Share<'), 'the document\'s other actions wait')
})

test('on the device: no Saved, and nothing breaks with no accounts', () => {
  const html = bar({ doc: doc({ saved: undefined, onKeepOffline: undefined }) })
  assert.ok(!html.includes('>Saved<'))
  assert.ok(!labels(moreItems(doc({ onKeepOffline: undefined }))).includes('Sign out'))
})

test('the bar never draws tabs: they are an owner removal, and a tab an older app sends is dropped', () => {
  const items = barFrom({ v: 1, items: [{ kind: 'tab', id: 't', label: 'Step', current: true }] })
  assert.deepEqual(items, [])
  assert.ok(!bar({ doc: doc({ bar: items }) }).includes('ch-bar-tab'))
})

test('what lives outside the bar keeps its home in App.tsx: device banner, update toast, install prompt, drop veil, Offline dialog', () => {
  const app = readFileSync('src/App.tsx', 'utf8') // npm test runs in app/
  for (const want of ['<DeviceBanner', 'dv-update', '<InstallPrompt', 'dv-drop', '<OfflineDialog', 'setOfflineOpen(true)', '<Launcher', '<DeviceHome', 'onAllTools']) {
    assert.ok(app.includes(want), `App.tsx still has ${want}`)
  }
})

test('madeFromOf reads the direct parent the host holds, and nothing else', () => {
  assert.equal(madeFromOf(null), null)
  assert.equal(madeFromOf({ document_id: 'd', carried: null, upstream: [] }), null)
  const view = {
    document_id: 'd', carried: null,
    upstream: [
      { document_id: 'r', direct: true, in_store: true, title: 'Lúnasa research', status: 'changed' as const, decisions_since: 3 },
      { document_id: 'c', direct: false, in_store: true, title: 'Older', status: 'not_compared' as const },
    ],
  }
  assert.deepEqual(madeFromOf(view), { title: 'Lúnasa research', changed: true, decisionsSince: 3 })
  assert.equal(madeFromOf({ ...view, upstream: [{ ...view.upstream[0], in_store: false }] }), null)
})
