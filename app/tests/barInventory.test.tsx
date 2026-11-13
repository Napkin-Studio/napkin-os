// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one OS bar (features/new-ui-shell.clan): every action the old bar and
// its More ▾ menu held keeps a visible home in the new bar or its slot menus,
// in each state of the shell: the desk, a document, a document in edit mode,
// a locked one (client review offered), client review itself, and the device.
// Owner rule: no feature that exists today may be removed or hidden, except
// what the owner removes by name (2026-11-11: All tools, Your agents, Install
// the app, Change password and Flat circles are gone; the agency pill goes to
// the desk; the account menu is on the avatar).

import './domFakes.ts'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import Toolbar, { AgencyPill, LinkPicker, LinkedList } from '../src/components/Toolbar.tsx'
import { accountItems, continueItems, deskItems, docMenuItems, linkList, linkedChip, linkedRows, linksOf, linksRead, madeFromOf, moreItems, pressContinue, shareItems, type DocBar } from '../src/components/barMenus.ts'
import { __test as dogfood } from '../src/dogfood/recorder.ts'
import { betaNoticeOpen, betaNoticeOpener, closeBetaNotice } from '../src/dogfood/notice.ts'
import { barFrom } from '../src/shell/appBar.ts'

const noop = () => {}
const doc = (over: Partial<DocBar> = {}): DocBar => ({
  title: 'Spring brief', tool: { name: 'Brief' }, toolKey: 'brief',
  onOpenFile: noop, onToggleSidebar: noop, sidebarOpen: false, onLineage: noop, onSave: noop,
  onKeepOffline: noop, onExport: noop, targets: [{ app_id: 'ie.napkin.deck-maker', name: 'Deck Maker', version: '1' }],
  onSpinoff: noop, onToggleEdit: noop, saved: createElement('span', { className: 'ch-saved' }, 'Saved'), ...over,
})
const bar = (props: Partial<Parameters<typeof Toolbar>[0]> = {}) => renderToStaticMarkup(createElement(Toolbar, {
  agency: 'Studio A', onAgency: noop, onHome: noop, needs: 0, onDecisions: noop, ...props,
}))
const labels = (items: { label: string }[]) => items.map(i => i.label)

const sam = { name: 'Sam Agent', initials: 'SA', line: 'Studio A', onOffline: noop, offlineCount: 2 }

test('the desk: medallion, the agency pill back to the desk, the client chip, the theme, your avatar, Decisions with the count', () => {
  dogfood({ on: true, consented: false })
  const html = bar({
    needs: 3, user: 'sam@studio-a', onSignOut: noop, account: sam,
    client: { name: 'Client A', mono: 'CA', look: { cl: '#DA291C', ink: '#FFC72C' }, switcher: [{ id: 'cli_1', name: 'Client A' }], onSwitch: noop },
    tools: createElement('button', { className: 'ch-btn' }, 'Offline'),
  })
  dogfood({ on: false, consented: false })
  assert.match(html, /data-where="desk"/)
  assert.match(html, /data-testid="medallion"/)
  assert.match(html, /<button type="button" class="name-pill pill-accent" id="header-name-pill" title="Studio A: back to the desk" aria-label="Studio A Napkin Studio: back to the desk" data-testid="agency-pill">.*Studio A.*Napkin Studio/, 'the pill is a button back to the desk')
  assert.doesNotMatch(html, /id="header-name-pill"[^>]*aria-haspopup/, 'no menu opens from the agency pill')
  // Your avatar, beside the theme and Decisions: a menu button with your initials.
  assert.match(html, /<button type="button" class="tb-me" id="tb-me" aria-haspopup="menu" aria-expanded="false" aria-label="SA, Sam Agent: your account"[^>]*data-testid="account-button"><i class="cw" aria-hidden="true">SA<\/i><\/button>/)
  assert.ok(html.indexOf('Switch to') < html.indexOf('id="tb-me"') && html.indexOf('id="tb-me"') < html.indexOf('id="tb-decisions-btn"'), 'after the theme, before Decisions')
  assert.doesNotMatch(html, /Flat circles|flat-circles/, 'no Flat circles toggle')
  assert.match(html, /data-testid="client-chip"[^>]*>.*Client A/, 'on a client page: the chip, a switcher')
  assert.match(html, /id="p33-cswitch"[^>]*title="Switch client"/)
  assert.match(html, />Offline</, 'a caller\'s own tools still have a place')
  assert.doesNotMatch(html, /tb-beta|>Beta</, 'no Beta chip in the bar (owner, 2026-11-13)')
  assert.match(html, /Switch to (White|Grey|Black)/, 'ThemeToggle')
  assert.match(html, /aria-description="3 need your call"/)
  assert.match(html, /data-testid="needs-count">3</)
  assert.doesNotMatch(html, />More </, 'no More ▾ on the desk: its actions are in the account and desk menus')
  // The avatar's menu (owner, 2026-11-11): who you are (its header), Offline copies with its count, Sign out last.
  const items = accountItems(sam, 'sam@studio-a', noop)
  assert.deepEqual(labels(items), ['Offline copies', 'Sign out'])
  assert.match(items[0].hint ?? '', /^2 on this device · /, 'Offline copies keeps its count line')
  assert.ok(items[1].apart, 'Sign out sits apart, last')
  for (const gone of ['All tools', 'Your agents', 'Install the app', 'Change password', 'Flat circles']) {
    assert.ok(!labels(items).includes(gone), `no ${gone}`)
  }
  assert.deepEqual(labels(accountItems({ ...sam, onOffline: undefined }, 'sam@studio-a', noop)), ['Sign out'])
  assert.deepEqual(labels(accountItems(undefined, null, noop)), [], 'no accounts, no Sign out')
  assert.deepEqual(labels(deskItems('sam@studio-a', noop)), ['Sign out'])
  assert.deepEqual(deskItems(null, noop), [], 'no accounts, no Sign out')
  // Open… (a .clan from this computer) sits in the desk's More too (open question answered 9 Nov 2026).
  assert.deepEqual(labels(deskItems('sam@studio-a', noop, noop)), ['Open…', 'Sign out'])
  assert.deepEqual(labels(deskItems(null, noop, noop)), ['Open…'])
  assert.doesNotMatch(html, /data-attention/, 'the desk never lights the medallion')
})

test('no client, no rule after the pill: nothing stands for a missing chip (owner, 2026-11-12)', () => {
  assert.doesNotMatch(bar(), /tb-vsep/)
  const withClient = bar({ client: { name: 'Client A', mono: 'CA', look: { cl: '#123456', ink: '#ffffff' } } as never })
  assert.match(withClient, /tb-vsep/)
})

test('the agency pill takes you to the desk; the avatar menu is a proper menu button', () => {
  let went = 0
  const pill = AgencyPill({ agency: 'Studio A', onDesk: () => { went++ } })
  ;(pill.props as { onClick: () => void }).onClick()
  assert.equal(went, 1, 'a click on the pill goes to the desk')
  // The bar hands the pill the desk route (onAgency), and the medallion too; App.tsx gives both the agency level.
  const src = readFileSync('src/components/Toolbar.tsx', 'utf8')
  assert.match(src, /<AgencyPill agency=\{agency\} logo=\{agencyLogo\} onDesk=\{onAgency \?\? onHome\} \/>/)
  const app = readFileSync('src/App.tsx', 'utf8')
  assert.match(app, /onHome=\{\(\) => leaveTo\(\{ level: 'agency' \}\)\}/, 'in a document the medallion goes to the desk')
  assert.match(app, /onAgency=\{\(\) => leaveTo\(\{ level: 'agency' \}\)\}/, 'in a document the pill goes to the desk')
  assert.match(app, /onAgency=\{toAgency\}\s+onHome=\{toAgency\}/, 'on the desk and client page both go to the desk')
  // The menu opens under the avatar, right-aligned; Escape closes it and gives focus back (Pop + popKit).
  assert.match(src, /<Pop anchor=\{pop\.open\.anchor\} align="right" onClose=\{pop\.close\} label="Your account" testid="account-menu">/)
  assert.match(readFileSync('src/shell/nui/popKit.ts', 'utf8'), /case 'Escape': e\.preventDefault\(\); e\.stopPropagation\(\); close\(\)/)
  assert.match(readFileSync('src/shell/nui/Pop.tsx', 'utf8'), /onListKey\(e, ref\.current, \(\) => onClose\(true\)\)/, 'Escape refocuses the button')
  // No account (no accounts on this server): no avatar.
  assert.doesNotMatch(bar({}), /tb-me/)
})

test('in a document the avatar is you; the crew beside it is everyone else', () => {
  const crew = { people: [{ name: 'Sam', initials: 'SA', you: true }, { name: 'Ana', initials: 'AN' }] }
  const html = bar({ account: sam, user: 'sam', onSignOut: noop, doc: doc({ crew }) })
  assert.match(html, /data-testid="account-button"/)
  assert.match(html, /data-testid="crew"[^>]*>(<i[^>]*>AN<\/i>)<\/span>/, 'the crew shows the others only')
  assert.doesNotMatch(bar({ account: sam, doc: doc({ crew: { people: [crew.people[0]] } }) }), /data-testid="crew"/, 'alone: just the avatar')
  assert.match(bar({ doc: doc({ crew }) }), /data-testid="crew"[^>]*>(<i[^>]*>SA<\/i>)(<i[^>]*>AN<\/i>)/, 'no account: the crew as before')
})

test('the removed pieces are gone from the shell: All tools, Your agents, Install, Change password, Flat circles, 3D circles', () => {
  for (const f of ['src/shell/nui/AccountModals.tsx', 'src/shell/agents/AgentGallery.tsx', 'src/orbs', 'src/shell/landing/useOrb.ts', 'src/shell/nui/use3D.ts']) {
    assert.ok(!existsSync(f), `${f} is gone`)
  }
  const app = readFileSync('src/App.tsx', 'utf8')
  for (const gone of ['AllToolsModal', 'CrewModal', 'onAllTools', 'onCrew', 'setFlatPref', 'napkin.circles.flat', 'useCanGL', 'allTools']) {
    assert.ok(!app.includes(gone), `App.tsx has no ${gone}`)
  }
  const desk = readFileSync('src/shell/nui/Desk.tsx', 'utf8')
  assert.doesNotMatch(desk, /orbs|use3D|installPressGate|<Circle /, 'the desk draws flat discs only')
})

test('a document: its tool icon and name with saved · valid under it, Continue in and Share; the chips are on the bar; no state pill', () => {
  const items = barFrom({ v: 1, items: [
    { kind: 'button', id: 'a', label: 'Build', primary: true }, { kind: 'button', id: 'b', label: 'Check' }, { kind: 'button', id: 'c', label: 'Rerun' },
    { kind: 'chip', label: '0 errors', tone: 'ok' },
  ] })
  const html = bar({
    needs: 2, attention: true, decisionsOpen: true,
    doc: doc({ bar: items, isTemplate: true, trusted: true, validation: 'bad header', state: { label: 'Draft', tone: null, locked: false } }),
  })
  for (const want of ['class="tba-name tba-brief"', '>Spring brief<', '>Continue in ▾<', '>Share<', '>Saved<', '· not valid',
    '>Template<', '>Trusted<', 'Something’s wrong with this file', '>0 errors<', '>Build<', '>Check<']) {
    assert.ok(html.includes(want), `bar shows ${want}`)
  }
  assert.ok(!html.includes('data-testid="state-pill"') && !html.includes('>Draft<'), 'no state pill in the bar (mock phase 26)')
  assert.match(html, /aria-haspopup="menu"[^>]*data-testid="doc-name"/, 'the document menu is on the name')
  assert.ok(!html.includes('>Rerun<'), 'a third app button goes to More')
  assert.match(html, /data-attention="true"/, 'the app you are in needs you: the medallion says so')
  assert.match(html, /aria-expanded="true"[^>]*data-testid="decisions"/)
  const more = labels(moreItems(doc({ bar: items }), 'sam@studio-a', noop))
  assert.deepEqual(more, ['Rerun', 'Edit', 'Open…', 'Save as…', 'Present offline', 'Export', 'Where it came from', 'Show the file’s details', 'Sign out'])
  // The document menu on the name holds them now, in the mock's order; Sign out is the account's.
  const menu = labels(docMenuItems(doc({ bar: items, onRename: noop }), noop))
  assert.deepEqual(menu, ['Rerun', 'Rename', 'Open…', 'Save as…', 'File details', 'Edit', 'Present offline', 'Export', 'Where it came from'])
  assert.ok(!menu.some(l => l.startsWith('Continue in')), 'Continue in is not in the document menu')
  // "Where it came from" opens the Decisions drawer on its Lineage tab, in both menus; never the old floating panel.
  let opened = 0
  const lineageDoc = doc({ bar: items, onLineage: () => { opened++ } })
  docMenuItems(lineageDoc, noop).find(i => i.label === 'Where it came from')!.run()
  moreItems(lineageDoc).find(i => i.label === 'Where it came from')!.run()
  assert.equal(opened, 2, 'both menus open the Lineage tab')
  assert.deepEqual(labels(continueItems(doc({ onStartFresh: noop })).fresh), ['New brief for this client'], 'Start fresh, in Continue in')
  const cont = continueItems(doc())
  assert.deepEqual(labels(cont.spin), ['Deck'])
  assert.match(cont.spin[0].hint ?? '', /A board deck from this/)
  assert.deepEqual(cont.link, [], 'nothing to link: the group says so')
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
  for (const want of ['>Turn it into<', '>Link to an existing one<', '>Made from<', '>Start fresh<', 'Up to date with', 'A locked version keeps what it was made from']) {
    assert.ok(src.includes(want), `Toolbar has ${want}`)
  }
})

test('the old More menu\'s every action still has a home in the new bar (inventory)', () => {
  // The old More ▾: each action's home is now the document menu on the name, or the avatar's menu (Sign out).
  const OLD: [string, string][] = [['Edit', 'Edit'], ['Open…', 'Open…'], ['Save as…', 'Save as…'], ['Present offline', 'Present offline'],
    ['Export', 'Export'], ['Where it came from', 'Where it came from'], ['Show the file’s details', 'File details'], ['Sign out', 'Sign out']]
  const now = [...labels(docMenuItems(doc())), ...labels(accountItems(undefined, 'sam', noop))]
  for (const [was, is] of OLD) assert.ok(now.includes(is), `${was} has a home (${is})`)
  assert.ok(labels(docMenuItems(doc({ sidebarOpen: true }))).includes('Hide the file details'))
  assert.ok(!labels(docMenuItems(doc({ onKeepOffline: undefined }))).includes('Present offline'), 'only where it makes sense, as before')
  assert.ok(labels(moreItems(doc(), 'sam', noop)).includes('Show the file’s details'), 'the inventory function is kept')
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
  assert.ok(!html.includes('>Share <'), 'the document\'s other actions wait')
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
  for (const want of ['<DeviceBanner', 'dv-update', '<InstallPrompt', 'dv-drop', '<OfflineDialog', 'setOfflineOpen(true)', '<Launcher', '<DeviceHome']) {
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
  assert.equal(madeFromOf({ ...view, upstream: [{ ...view.upstream[0], path: 'store/r' }] })?.path, 'store/r', 'the chip opens it where the store can say')
})

test('one needs indicator: Decisions is amber with the count; the state pill never repeats it', () => {
  const html = bar({ needs: 2, attention: true, doc: doc({ state: { label: 'Draft', tone: null, locked: false } }) })
  assert.match(html, /class="tb-decisions-btn has-needs"/)
  assert.doesNotMatch(html, /Needs you \(/)
  assert.doesNotMatch(bar({ needs: 0, doc: doc() }), /has-needs/, 'nothing needs a call: not amber')
  // A run waiting on the person's answer counts as one call (gaps.md X8), never "0" in amber.
  const waiting = bar({ needs: 0, doc: doc({ crew: { people: [], waiting: true } }) })
  assert.match(waiting, /has-needs/)
  assert.match(waiting, /data-testid="needs-count">1</)
  // The medallion reacts only for the open app, and never on the desk.
  assert.match(html, /data-testid="medallion-mark" data-state="needs"/)
  assert.doesNotMatch(bar({ needs: 0, doc: doc() }), /data-state="needs"/)
  // The desk: asleep until the person engages (the mock's wakeMark), and its count never lights it.
  assert.match(bar({ needs: 5, attention: true }), /data-testid="medallion-mark" data-state="sleep"/, 'the desk count never lights it')
})

test('Share ▾: Copy link where there is a server, Download a copy always; the client copy once locked; the crew says it is not built', () => {
  const clientBtn = { kind: 'button' as const, id: 'client', label: 'Client copy · PDF', primary: false, disabled: false, title: '' }
  const on = shareItems({ onSave: noop, onCopyLink: noop, locked: false, bar: [clientBtn], onBarAction: noop })
  assert.deepEqual(labels(on), ['Copy link', 'Download a copy', 'Send the client copy', 'Invite to the crew'])
  assert.match(on[2].hint ?? '', /Lock it first: the client sees the version you lock/)
  assert.ok(on[2].disabled && on[3].disabled, 'shown, never faked')
  // Locked: it runs the app's own client copy export (Confidential hides nothing from the client; owner, 2026-11-13).
  const ran: string[] = []
  const locked = shareItems({ onSave: noop, locked: true, bar: [clientBtn], onBarAction: id => { ran.push(id) } })[1]
  assert.ok(!locked.disabled, 'enabled on a locked document')
  assert.doesNotMatch(locked.hint ?? '', /confidential|not built/i)
  locked.run()
  assert.deepEqual(ran, ['client'], 'the brief’s own Client copy · PDF')
  assert.ok(shareItems({ onSave: noop, locked: true, bar: [], onBarAction: noop })[1].disabled, 'a tool with no client copy says so')
  assert.deepEqual(labels(shareItems({ onSave: noop })), ['Download a copy', 'Send the client copy', 'Invite to the crew'], 'no server: no link')
  let saved = 0
  shareItems({ onSave: () => { saved++ } })[0].run()
  assert.equal(saved, 1, 'the old Share (download a copy) keeps its home')
})

test('lineage chips beside the name; the crew is people only, and a job shows as the working chip', () => {
  const opened: string[] = []
  const html = bar({ doc: doc({
    madeFrom: { title: 'Lúnasa research', path: 'store/r1', changed: true },
    madeInto: { count: 2, noun: 'deck' },
    onOpenDocument: p => { opened.push(p) },
    crew: { people: [{ name: 'Sam', initials: 'SA', you: true }], working: 'writing' },
  }) })
  assert.match(html, /data-testid="lineage-from"[^>]*>from <b>Lúnasa research<\/b>/)
  assert.match(html, /→ <b>2 decks<\/b>/)
  assert.match(html, /aria-label="In this document: Sam \(you\); an agent is writing"/)
  assert.ok(html.indexOf('data-testid="crew"') < html.indexOf('data-testid="decisions"'), 'the crew sits before Decisions')
  // the agent is never drawn in the bar (owner, 2026-11-09): only the job chip says one works
  assert.match(html, /data-testid="agent-working"[^>]*data-st="working"[^>]*><i class="sdot"[^>]*><\/i>Writing<\/span>/)
  assert.doesNotMatch(html, /class="nk-ag"/, 'no agent sphere in the bar')
  const knowing = bar({ doc: doc({ crew: { people: [{ name: 'Sam', initials: 'SA', you: true }], working: 'reading', agent: 'knowledge', progress: [1, 4] } }) })
  assert.match(knowing, /aria-label="In this document: Sam \(you\); the Knowledge agent is reading"/)
  assert.match(knowing, />Reading · step 1\/4<\/span>/)
  assert.doesNotMatch(knowing, /class="nk-ag"/)
  const idle = bar({ doc: doc({ crew: { people: [{ name: 'Sam', initials: 'SA', you: true }], working: null } }) })
  assert.doesNotMatch(idle, /agent-working/, 'no job: no chip')
  assert.doesNotMatch(bar({ doc: doc() }), /tba-line/, 'made from nothing: no chips')
})

const HERE = { id: 'cli_aaaa0001', name: 'UAT 11121025' }
const target = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  app_id: 'ie.napkin.campaign-research', app_name: 'Research Tool', document_id: id, title,
  path: `store/${id}`, updated_at: '2026-11-09T10:00:00Z', attached: false, many: true, locked: false,
  client: HERE as { id: string; name: string } | null, ...over,
})

test('Link to an existing one: the way into the Link list, then Update and Unlink for what is linked', () => {
  const ran: string[] = []
  let listed = 0
  const cont = continueItems(doc({
    linkTargets: [target('r1', 'Irish summer treats'), target('r2', 'Oat milk', { attached: true })],
    onLink: id => { ran.push(`link:${id}`) },
    linked: [{ documentId: 'r2', title: 'Oat milk', dir: 'in', changed: true, taken: 1 }, { documentId: 'd9', title: 'Q3 deck', dir: 'out' }],
    onUpdateLinked: id => { ran.push(`update:${id}`) },
    onUnlink: id => { ran.push(`unlink:${id}`) },
  }), () => { listed++ })
  assert.deepEqual(labels(cont.link), ['↔ Link research…', 'Update Oat milk', 'Unlink Oat milk'], 'one way into the list; linked into another: not here')
  assert.match(cont.link[0].hint ?? '', /^This client’s research, newest first; search finds any client’s/)
  assert.match(cont.link[1].hint ?? '', /\(v1\)/)
  assert.ok(cont.link[1].apart, 'what is linked sits apart from what could be')
  cont.link.forEach(i => i.run())
  assert.equal(listed, 1, 'Link research… opens the Link list')
  assert.deepEqual(ran, ['update:r2', 'unlink:r2'])
  // Locked: offered, disabled, saying why.
  const locked = continueItems(doc({ linkTargets: [target('r1', 'Irish summer treats', { locked: true })], onLink: noop }), noop)
  assert.equal(locked.link[0].disabled, true)
  assert.match(locked.link[0].hint ?? '', /locked/)
  assert.deepEqual(continueItems(doc({ linkTargets: [], onLink: noop }), noop).link, [], 'nothing to link: the group says so')
})

test('the linked chip: one chip for any number of links, the dot when one changed, and its list', () => {
  assert.equal(linkedChip([]), null)
  const ran: string[] = []
  const linked: DocBar['linked'] = [
    { documentId: 'r1', title: 'Oatly · Ireland and Great Britain', path: 'store/r1', dir: 'in', changed: true, taken: 1, noun: 'research' },
    { documentId: 'r2', title: 'Guinness 0.0 · Ireland', path: 'store/r2', dir: 'in', changed: false, taken: 2, noun: 'research' },
    { documentId: 'r3', title: 'Barista milk · cafés', path: 'store/r3', dir: 'in', taken: 1, noun: 'research' },
    { documentId: 'd1', title: 'Q3 deck', path: 'store/d1', dir: 'out', noun: 'deck' },
  ]
  for (const n of [1, 2, 4]) {
    const html = bar({ doc: doc({ linked: linked.slice(0, n), onOpenDocument: noop }) })
    assert.equal(html.match(/data-testid="lineage-linked"/g)?.length, 1, `${n} links: one chip`)
    assert.match(html, new RegExp(`data-testid="lineage-linked"[^>]*>↔ <b>${n} linked</b>`))
    assert.ok(!html.includes('Oatly'), 'no title on the bar: the name keeps its room')
  }
  assert.match(bar({ doc: doc({ linked: linked.slice(0, 2) }) }), /<b>2 linked<\/b><i class="ch-line-dot"/, 'one changed: the dot')
  assert.doesNotMatch(bar({ doc: doc({ linked: linked.slice(1, 3) }) }), /ch-line-dot/, 'none changed: no dot')
  assert.deepEqual(linkedChip(linked), { count: 4, changed: true })

  const d = doc({
    linked, linkTargets: [target('r9', 'Oat drinks')], onLink: noop,
    onOpenDocument: p => { ran.push(`open:${p}`) }, onUpdateLinked: id => { ran.push(`update:${id}`) }, onUnlink: id => { ran.push(`unlink:${id}`) },
  })
  const { into, out } = linkedRows(d)
  assert.deepEqual(into.map(r => [r.sub, labels(r.actions)]), [
    ['Research · v1 taken · changed since', ['Update', 'Open', 'Unlink']],
    ['Research · v2 taken', ['Open', 'Unlink']],
    ['Research · v1 taken', ['Open', 'Unlink']],
  ], 'Update only when it changed')
  assert.deepEqual(out.map(r => labels(r.actions)), [['Open']], 'linked into another: open it, unlink there')
  into[0].actions.forEach(a => a.run())
  assert.deepEqual(ran, ['update:r1', 'open:store/r1', 'unlink:r1'])
  // Locked: no Update or Unlink.
  assert.deepEqual(labels(linkedRows({ linked, onOpenDocument: noop }).into[0].actions), ['Open'])

  const html = renderToStaticMarkup(createElement(LinkedList, { doc: d, close: noop, onLinkAnother: noop }))
  assert.match(html, />Linked into this brief</)
  assert.match(html, />This brief is linked into</)
  assert.equal(html.match(/data-testid="linked-row" data-dir="in"/g)?.length, 3)
  assert.match(html, /aria-label="Update Oatly · Ireland and Great Britain"/)
  assert.match(html, /data-testid="link-another"[^>]*>＋ Link another research…</)
})

test('the Link list: this client first and newest first, a search over every client, and all clients grouped', () => {
  const now = new Date('2026-11-12T12:00:00Z')
  const linked: string[] = []
  const d = doc({
    client: HERE,
    onLink: id => { linked.push(id) },
    linkTargets: [
      target('m1', 'Barista milk · cafés in Dublin', { updated_at: '2026-11-09T12:00:00Z', version: 3 }),
      target('m2', 'Oatly · Ireland and Great Britain', { updated_at: '2026-11-12T10:00:00Z', version: 1, attached: true }),
      target('m3', 'Oat drinks · UK supermarkets', { updated_at: '2026-11-11T12:00:00Z', version: 1 }),
      target('o1', 'Oat milk pricing · Germany', { client: { id: 'cli_bbbb0002', name: 'Alpro' } }),
      target('o2', 'Oat drinks · Ireland', { client: { id: 'cli_cccc0003', name: 'UAT Edge' } }),
      target('o3', 'Coffee culture', { client: { id: 'cli_bbbb0002', name: 'Alpro' } }),
      target('u1', 'An old oat study', { client: null }),
    ],
  })
  const l = linkList(d, '', now)
  assert.equal(l.noun, 'research')
  assert.equal(l.here, 'UAT 11121025')
  assert.equal(l.locked, null)
  assert.deepEqual(l.mine.map(r => r.target.document_id), ['m2', 'm3', 'm1'], 'this client only, newest first')
  assert.deepEqual(l.mine.map(r => r.sub), ['v1 · 2 hours ago', 'v1 · 1 day ago', 'v3 · 3 days ago'])
  assert.deepEqual(l.mine.map(r => r.state), ['linked', 'link', 'link'], 'linked already: LINKED, not Link')
  assert.deepEqual(l.others, [], 'other clients only by searching')
  l.mine.forEach(r => r.run())
  assert.deepEqual(linked, ['m3', 'm1'], 'Link runs onLink; a linked one does nothing')

  // Searching: other clients' research by title or by client name, each naming its client.
  const s = linkList(d, 'oat', now)
  assert.equal(s.mine.length, 3, 'this client stays listed')
  assert.deepEqual(s.others.map(r => [r.target.document_id, r.sub]), [['o1', 'Alpro'], ['o2', 'UAT Edge'], ['u1', 'Unknown client']])
  assert.deepEqual(linkList(d, 'alpro', now).others.map(r => r.target.document_id), ['o1', 'o3'], 'by client name')

  // All clients: grouped, this client first, unknown last; the search narrows each.
  assert.deepEqual(l.groups.map(g => [g.name, g.here, g.rows.map(r => r.target.document_id)]), [
    ['UAT 11121025', true, ['m2', 'm3', 'm1']],
    ['Alpro', false, ['o1', 'o3']],
    ['UAT Edge', false, ['o2']],
    ['Unknown client', false, ['u1']],
  ])
  assert.deepEqual(linkList(d, 'coffee', now).groups.map(g => g.name), ['Alpro'])

  // Locked: listed, Link disabled, the reason said once.
  const lk = linkList({ ...d, linkTargets: d.linkTargets!.map(t => ({ ...t, locked: true })) }, '', now)
  assert.match(lk.locked ?? '', /locked/)
  assert.deepEqual(lk.mine.map(r => r.state), ['linked', 'locked', 'locked'])
  linked.length = 0
  lk.mine.forEach(r => r.run())
  assert.deepEqual(linked, [], 'a locked document links nothing')

  // Drawn: the client view, a search, and all clients.
  const draw = (props: { startQuery?: string; startAll?: boolean }, over: Partial<DocBar> = {}) =>
    renderToStaticMarkup(createElement(LinkPicker, { doc: { ...d, ...over }, close: noop, ...props }))
  const mine = draw({})
  assert.match(mine, />Link research · UAT 11121025</)
  assert.equal(mine.match(/data-testid="link-row"/g)?.length, 3)
  assert.match(mine, /data-state="linked"[^]*?>Linked</)
  assert.match(mine, /placeholder="Search research for other clients"/)
  assert.match(mine, /data-testid="link-all"[^>]*>Show research for all clients</)
  assert.doesNotMatch(mine, /Other clients/)
  const found = draw({ startQuery: 'oat' })
  assert.match(found, />Other clients</)
  assert.match(found, /<b>Oat milk pricing · Germany<\/b><small>Alpro<\/small>/)
  const every = draw({ startAll: true })
  assert.match(every, />Link research · all clients</)
  assert.match(every, />UAT 11121025 · this client</)
  assert.ok(every.indexOf('UAT 11121025 · this client') < every.indexOf('>Alpro<'), 'this client first')
  assert.match(every, /data-testid="link-only-here"[^>]*>Only this client</)
  const shut = draw({}, { linkTargets: d.linkTargets!.map(t => ({ ...t, locked: true })) })
  assert.match(shut, /data-testid="link-locked"/)
  assert.match(shut, /aria-disabled="true"[^>]*>Link</)
})

// UAT round 4 (2026-11-12): "Link to an existing one" said there was nothing to link while a
// finished Research on the same client existed; a reload listed it (features/stale-token-and-menus.clan).
test('Continue in ▾ reads what it lists again as it opens, and a failed read never empties it', () => {
  const asked: string[] = []
  let open = false
  const d = { onContinueOpen: () => { asked.push('read') } }
  const toggle = () => { open = !open }
  pressContinue(d, open, toggle)
  assert.deepEqual(asked, ['read'], 'opening reads /attach-targets again')
  assert.equal(open, true)
  pressContinue(d, open, toggle)
  assert.deepEqual(asked, ['read'], 'closing asks nothing')
  assert.equal(open, false)
  pressContinue({}, false, toggle)
  assert.equal(open, true, 'a bar with nothing to read still opens')

  const t = (id: string) => ({ app_id: 'ie.napkin.campaign-research', app_name: 'Research Tool', document_id: id, title: id, path: `store/${id}`, updated_at: '', attached: false, many: true, locked: false, client: null })
  const first = linksRead(null, 'brief-1', [], null)
  assert.deepEqual(first.targets, [], 'nothing yet')
  const later = linksRead(first, 'brief-1', [t('research-1')], null)
  assert.deepEqual(later.targets.map(x => x.document_id), ['research-1'], 'a research finished since is listed on the next read')
  assert.deepEqual(linksRead(later, 'brief-1', null, null).targets.map(x => x.document_id), ['research-1'], 'a read that failed keeps the list; it never says "nothing to link"')
  assert.deepEqual(linksRead(later, 'brief-2', null, null).targets, [], 'another document starts from nothing')
})

test('linksOf reads /related into the lineage chips, both ways, and what was made from it', () => {
  assert.deepEqual(linksOf(null), { linked: [], madeInto: null })
  const view = {
    document_id: 'b1',
    upstream: [
      { document_id: 'r0', title: 'Lúnasa research', how: 'made_from' as const, status: 'current' as const },
      { document_id: 'r1', title: 'Oat milk', path: 'store/r1', how: 'linked' as const, status: 'changed' as const, taken: 3 },
    ],
    downstream: [
      { document_id: 'd1', title: 'Q3 deck', path: 'store/d1', how: 'made_into' as const, noun: 'deck' },
      { document_id: 'd2', title: 'Q4 deck', path: 'store/d2', how: 'made_into' as const, noun: 'deck' },
      { document_id: 'p1', title: 'Spring film', path: 'store/p1', how: 'linked_in' as const, noun: 'production' },
    ],
  }
  const { linked, madeInto } = linksOf(view)
  assert.deepEqual(madeInto, { count: 2, noun: 'deck', path: 'store/d1' })
  assert.deepEqual(linked.map(l => [l.documentId, l.dir, !!l.changed]), [['r1', 'in', true], ['p1', 'out', false]])
  const html = bar({ doc: doc({ linked, madeInto, onOpenDocument: noop }) })
  assert.match(html, /data-testid="lineage-linked"[^>]*>↔ <b>2 linked<\/b><i class="ch-line-dot"/, 'both ways under one chip')
  assert.deepEqual(linkedRows({ linked }).into.map(r => r.sub), ['Linked · v3 taken · changed since'])
  assert.deepEqual(linkedRows({ linked }).out.map(r => [r.doc.title, r.sub]), [['Spring film', 'Production · holds this one']])
})

test('the bar: who and where, then the document left-aligned (phase 36), then the tools after the spacer', () => {
  const html = bar({ doc: doc(), client: { name: 'Client A', mono: 'CA', look: { cl: '#111111', ink: '#FFFFFF' }, onOpen: noop } })
  const dock = html.indexOf('dock-connected'), chip = html.indexOf('data-testid="client-chip"'), app = html.indexOf('id="tb-app"'), sp = html.indexOf('tb-spacer')
  assert.ok(dock > 0 && dock < chip && chip < app && app < sp)
  assert.ok(html.indexOf('data-testid="medallion"') < app && html.indexOf('data-testid="doc-name"') > app && html.indexOf('data-testid="decisions"') > sp)
  assert.match(html, /title="Back to Client A"/, 'in a document the chip goes back to its client')
})

test('a long title never pushes the bar\'s tools off: the document slot shrinks and its name truncates (gaps.md B8)', () => {
  const css = readFileSync('src/shell/nui/shell.css', 'utf8')
  assert.match(css, /\.nui \.tb-locked > \* \{ flex-shrink: 0; \}/)
  assert.match(css, /\.nui \.tb-locked > \.tb-app \{ flex: 1 1 auto !important; min-width: 0; overflow: hidden !important; \}/)
  assert.match(css, /\.nui \.tb-app > \.tba-name \{ flex-shrink: 1;/)
  const html = bar({ doc: doc({ title: 'A'.repeat(200), onToggleEdit: undefined, onClientReview: noop }) })
  assert.ok(html.indexOf('>Client review<') > html.indexOf('tb-spacer'), 'Client review sits with the tools, after the slot')
})

test('no Beta chip and no thumbs in the bar; the notice is in the account menu (owner, 2026-11-13)', () => {
  dogfood({ on: true, consented: true })
  for (const html of [bar({ user: 'sam@studio-a', onSignOut: noop, account: sam }), bar({ user: 'sam@studio-a', onSignOut: noop, account: sam, doc: doc() })]) {
    assert.doesNotMatch(html, /tb-beta|>Beta</, 'no Beta chip')
    assert.doesNotMatch(html, /df-thumb|👍|👎/, 'no screen thumbs in the bar')
    assert.doesNotMatch(html, /records everything you do/, 'the notice is closed until chosen')
  }
  // The bar passes an opener only while recording, and the menu has the row only then.
  assert.equal(betaNoticeOpener(false), undefined)
  assert.deepEqual(labels(accountItems(sam, 'sam@studio-a', noop, betaNoticeOpener(false))), ['Offline copies', 'Sign out'], 'dogfood off: no row')
  const items = accountItems(sam, 'sam@studio-a', noop, betaNoticeOpener(true))
  assert.deepEqual(labels(items), ['Offline copies', 'About this beta', 'Sign out'])
  assert.equal(items[1].hint, 'What this beta records, and why')
  assert.ok(items[2].apart, 'Sign out sits apart, last')
  assert.ok(accountItems({ ...sam, onOffline: undefined }, 'sam@studio-a', noop, noop)[1].apart)

  // Choosing it opens the notice in the bar, to read again: Close, not I understand.
  items[1].run()
  assert.ok(betaNoticeOpen())
  const shown = bar({ user: 'sam@studio-a', onSignOut: noop, account: sam })
  assert.match(shown, /records everything you do/)
  assert.match(shown, />Close</)
  assert.doesNotMatch(shown, /I understand/)
  closeBetaNotice()
  assert.doesNotMatch(bar({ user: 'sam@studio-a', onSignOut: noop, account: sam }), /records everything you do/)
  dogfood({ on: false, consented: false })
})
