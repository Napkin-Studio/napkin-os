// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The People page (features/people-admin.clan): an agency recognised by id,
// name or alias, the sign-in name made from a name and an agency, a new
// agency's look, the page in Napkin's look whoever signs in, and the entry for
// engineer@napkin alone. napkin-web's lists (crates/napkin-web/src/people.rs)
// are kept in step with the shell's here.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { accountItems } from '../src/components/barMenus.ts'
import {
  AGENCY_ALIASES, AGENCY_COLOURS, NAPKIN_COLOURS, agencyNameOf, canonicalAgencyId, coloursOf, markOf, pillOf, registerAgencyLooks,
  type AgencyColours,
} from '../src/shell/agency/palette.ts'
import { signInLookOf } from '../src/shell/agency/signInLook.ts'
import PeoplePage, { AddSheet } from '../src/shell/people/PeoplePage.tsx'
import { AgencyEditorView } from '../src/shell/people/agencies/AgencyEditor.tsx'
import { discard, edit, openNew, openRow, publish, resetName, saveDraft, toggleCopy, upload, type EditorState } from '../src/shell/people/agencies/editor.ts'
import { registerRows, startInk, type BasicRow } from '../src/shell/people/agencies/model.ts'
import { MOCK_PEOPLE, cannedFiles, fakePeopleApi, mockAgencies } from './peopleFake.ts'
import {
  PEOPLE_ADMINS, agencyFieldFromSignInName, agencySlug, isPeopleAdmin, napkinPageCss, newAgencyLook, peopleEntryFor,
  recogniseAgency, signInNameOf, type AgencyRow, type PersonRow,
} from '../src/shell/people/model.ts'

function repo(): string { let d = dirname(fileURLToPath(import.meta.url)); while (!existsSync(join(d, 'Dockerfile'))) { const up = dirname(d); if (up === d) throw new Error('no repository root'); d = up } return d }
const rust = readFileSync(join(repo(), 'crates/napkin-web/src/people.rs'), 'utf8')
const block = (name: string) => rust.slice(rust.indexOf(`pub const ${name}`), rust.indexOf('];', rust.indexOf(`pub const ${name}`)))
const unescape = (s: string) => s.replace(/\\\\/g, '\\')

const noop = () => {}
const AGENCIES: AgencyRow[] = Object.entries(AGENCY_COLOURS).map(([id, c]) => ({
  id, kind: 'code', name: c.name, code_name: c.name, draft: null, rev: 1,
  aliases: Object.entries(AGENCY_ALIASES).filter(([, to]) => to === id).map(([a]) => a), people: id === 'napkin' ? 3 : 0,
}))
const PEOPLE: PersonRow[] = [
  { id: 'engineer@napkin', name: 'Shrey', agency: 'napkin', admin: true, added_by: 'roster', added_at: '2026-10-05T09:00:00Z' },
  { id: 'ann@napkin', name: 'Ann Murphy', agency: 'napkin', admin: false, added_by: 'roster', added_at: '2026-10-05T09:00:00Z' },
  { id: 'plu@pluto', name: 'Pluto Test', agency: 'pluto', admin: false, added_by: 'roster', added_at: '2026-11-10T09:00:00Z' },
  { id: 'gone@napkin', name: 'Gone', agency: 'napkin', admin: false, added_by: 'engineer@napkin', added_at: '2026-11-11T09:00:00Z', removed_at: '2026-11-12T09:00:00Z' },
]
const draft = (over: object = {}) => ({ name: '', agency: '', username: '', touched: false, shown: null, from: '', base: '#0F6B5C', accent: '#9FE6D8', ...over })
const sheet = (over: object) => renderToStaticMarkup(createElement(AddSheet, { draft: draft(over), setDraft: noop, agencies: AGENCIES, busy: false, onCancel: noop, onAdd: noop }))
const page = (user: string) => renderToStaticMarkup(createElement(PeoplePage, { user, onClose: noop, initial: { people: PEOPLE, agencies: AGENCIES } }))

test('an agency is recognised by its id, its name or another spelling, in any case', () => {
  for (const [typed, want] of [
    ['napkin', 'napkin'], ['Napkin', 'napkin'], ['bg', 'boysandgirls'], ['BG', 'boysandgirls'], ['Boys+Girls', 'boysandgirls'],
    ['b+g', 'boysandgirls'], ['boysgirls', 'boysandgirls'], ['Wieden+Kennedy', 'wk'], ['w+k', 'wk'], ['Harbour & Co', 'harbour'], [' pluto ', 'pluto'],
  ]) assert.equal(recogniseAgency(typed, AGENCIES), want, typed)
  assert.equal(recogniseAgency('Rothco', AGENCIES), null)
  assert.equal(recogniseAgency('', AGENCIES), null)
  // the card says which, in that agency's own colours
  const html = sheet({ name: 'Bea Byrne', agency: 'bg' })
  assert.match(html, /data-agency="boysandgirls"/)
  const pill = pillOf(AGENCY_COLOURS.boysandgirls)
  assert.match(html, new RegExp(`class="pa-pv" style="background:${pill.bg};color:${pill.ink}`))
  assert.match(html, /<b>Boys\+Girls<\/b> <small>· boysandgirls · 0 people · its look is set/)
  assert.doesNotMatch(html, /data-testid="new-agency"/)
})

test('the sign-in name is the first name at the agency, and typing name@agency sets the agency', () => {
  assert.equal(signInNameOf('Shaunagh Kelly', 'napkin'), 'shaunagh@napkin')
  assert.equal(signInNameOf('  Aoife   Byrne ', 'rothco'), 'aoife@rothco')
  assert.equal(signInNameOf('', null), 'name@agency')
  assert.match(sheet({ name: 'Shaunagh Kelly', agency: 'Napkin' }), /id="pa-em" value="shaunagh@napkin"/)
  assert.match(sheet({ name: 'Cal Cole', agency: 'B+G' }), /id="pa-em" value="cal@boysandgirls"/)
  // typed by hand, it stays as typed
  assert.match(sheet({ name: 'Shaunagh Kelly', agency: 'napkin', username: 'shay@napkin', touched: true }), /id="pa-em" value="shay@napkin"/)
  // name@agency in the sign-in name fills the Agency field
  assert.equal(agencyFieldFromSignInName('cal@bg', AGENCIES), 'Boys+Girls')
  assert.equal(agencyFieldFromSignInName('ann@napkin', AGENCIES), 'Napkin')
  assert.equal(agencyFieldFromSignInName('aoife@rothco', AGENCIES), 'rothco')
  assert.equal(agencyFieldFromSignInName('aoife', AGENCIES), null)
})

test('a new agency gets its look on the page, and its people wear it after sign-in', () => {
  const html = sheet({ name: 'Aoife Byrne', agency: 'Rothco', base: '#0F6B5C', accent: '#9FE6D8' })
  assert.match(html, /data-agency="new"/)
  assert.match(html, /data-testid="new-agency"/)
  assert.match(html, /New agency: Rothco/)
  assert.match(html, /id="pa-shown" placeholder="Rothco" value="Rothco"/, 'the name as shown starts as typed')
  assert.match(html, /<b>New agency<\/b> <small>· id rothco · set its look below/)
  assert.match(html, /id="pa-em" value="aoife@rothco"/)
  assert.match(html, /<option value="" selected="">Plain<\/option><option value="wk">Like Wieden\+Kennedy<\/option>/)
  const look = newAgencyLook('Rothco', '#0f6b5c', '#9fe6d8')
  assert.deepEqual(look, { name: 'Rothco', base: '#0F6B5C', accent: '#9FE6D8' })
  assert.match(html, new RegExp(`class="pa-pv" style="background:${pillOf(look).bg};color:${pillOf(look).ink}`))
  assert.equal(agencySlug('Boys+Girls'), 'boysandgirls')
  assert.equal(agencySlug('Harbour & Co'), 'harbourandco')

  // the server's agencies join the registry: id, alias, name, look, medallion
  assert.equal(coloursOf('rothco'), null)
  registerAgencyLooks([{ id: 'rothco', name: 'Rothco', base: '#0f6b5c', accent: '#9fe6d8', aliases: ['roth'] }])
  assert.equal(canonicalAgencyId('ROTHCO'), 'rothco')
  assert.equal(canonicalAgencyId('roth'), 'rothco')
  assert.deepEqual(coloursOf('rothco'), { name: 'Rothco', base: '#0F6B5C', accent: '#9FE6D8' })
  assert.equal(agencyNameOf('aoife@rothco', 'x'), 'Rothco')
  assert.deepEqual(markOf('aoife@rothco'), { base: '#0F6B5C', accent: '#9FE6D8' })
  assert.equal(signInLookOf('aoife@rothco').name, 'Rothco')
  // an agency in code takes only a published name (its look stays the code's), and a bad colour is not taken
  registerAgencyLooks([{ id: 'napkin', name: 'Napkin Dublin', base: '#000000', accent: '#000000' }, { id: 'odd', name: 'Odd', base: 'red', accent: '#FFFFFF' }])
  assert.deepEqual(coloursOf('napkin'), { ...AGENCY_COLOURS.napkin, name: 'Napkin Dublin' })
  assert.equal(coloursOf('odd'), null)
  registerAgencyLooks([])
})

test('the page wears Napkin\'s look, whoever is signed in', () => {
  const css = napkinPageCss()
  assert.match(css, /^\.pa-page \{ --ag-base: #515BFF; --ag-acc: #C8CBFF;/)
  assert.match(css, /:root\[data-theme='dark'\] \.pa-page \{ --ag-base: #515BFF;/)
  assert.doesNotMatch(css, /:root,|:root \{|:root\[data-theme='light'\]/, 'scoped to the page, never the studio')
  assert.equal(NAPKIN_COLOURS.base, '#515BFF')
  assert.equal(NAPKIN_COLOURS.accent, '#C8CBFF')
  for (const user of ['engineer@napkin', 'plu@pluto', 'mock@boysandgirls']) {
    const html = page(user)
    assert.match(html, /class="pa-page" role="dialog"[^>]*data-look="napkin"/, user)
    assert.ok(html.includes(css.replace(/'/g, '&#x27;')) || html.includes(css), `${user}: the Napkin layer`)
    assert.doesNotMatch(html.slice(0, html.indexOf('</style>')), /#B2F257|#000047/i, `${user}: never the agency's look`)
  }
})

test('the list shows everyone who can sign in, and not the removed', () => {
  const html = page('engineer@napkin')
  assert.match(html, /<b>Shrey<\/b><br\/><small>engineer@napkin<\/small>/)
  assert.match(html, /<span class="pa-tag pa-admin">ADMIN<\/span>/)
  assert.match(html, /2026-10-05 · roster/)
  assert.match(html, /<b>Pluto Test<\/b>/)
  assert.doesNotMatch(html, /gone@napkin/)
  assert.match(html, /placeholder="Find a person or agency"/)
  assert.match(html, />Add a person</)
  // an admin has no Remove on their own row
  const shreyRow = html.slice(html.indexOf('engineer@napkin</small>'), html.indexOf('ann@napkin</small>'))
  assert.doesNotMatch(shreyRow, />Remove</)
})

test('only engineer@napkin sees the People entry; anyone else is told to ask an admin', () => {
  assert.deepEqual(PEOPLE_ADMINS, ['engineer@napkin'])
  assert.ok(isPeopleAdmin('engineer@napkin'))
  for (const who of ['ann@napkin', 'plu@pluto', 'shrey@napkin', null, '']) assert.ok(!isPeopleAdmin(who), String(who))
  const labels = (user: string) => accountItems({ name: 'X', initials: 'X', line: 'Napkin', onPeople: peopleEntryFor(user, noop) }, user, noop).map(i => i.label)
  assert.deepEqual(labels('engineer@napkin'), ['People', 'Sign out'])
  assert.deepEqual(labels('ann@napkin'), ['Sign out'])
  assert.deepEqual(labels('plu@pluto'), ['Sign out'])
  const denied = page('ann@napkin')
  assert.match(denied, /data-testid="people-denied"/)
  assert.match(denied, /Ask <b>Shrey<\/b> or another admin/)
  assert.doesNotMatch(denied, /Add a person|<table/)
})

test('napkin-web keeps the same admins, agencies and aliases as the shell', () => {
  const admins = [...block('PEOPLE_ADMINS').matchAll(/"([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(admins, [...PEOPLE_ADMINS])
  const agencies = [...block('CODE_AGENCIES').matchAll(/\("([^"]+)", "((?:[^"\\]|\\.)*)", "(#[0-9A-Fa-f]{6})", "(#[0-9A-Fa-f]{6})"\)/g)]
    .map(m => [m[1], unescape(m[2]), m[3], m[4]])
  assert.deepEqual(agencies, Object.entries(AGENCY_COLOURS).map(([id, c]) => [id, c.name, c.base, c.accent]))
  const aliases = Object.fromEntries([...block('CODE_ALIASES').matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map(m => [m[1], m[2]]))
  assert.deepEqual(aliases, { ...AGENCY_ALIASES })
})

// ---- Agencies (features/agency-looks-admin.clan; mock people-agencies-v3), against the fake napkin-web ----

const view = (st: EditorState) => renderToStaticMarkup(createElement(AgencyEditorView, { st, user: 'engineer@napkin', actions: NOOP_ACTIONS }))
const NOOP_ACTIONS = { onEdit: noop, onUpload: noop, onRemoveWordmark: noop, onResetName: noop, onPublish: noop, onDiscard: noop, onCopy: noop, onBack: noop }
const rowOf = (api: ReturnType<typeof fakePeopleApi>, id: string) => api.rows.find(r => r.id === id)!
const calls = (api: ReturnType<typeof fakePeopleApi>) => api.heard.map(h => h.call)
const buttonOf = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? ''

test('People | Agencies: the list has every agency with its kind, and the People list wears each agency\'s pill', () => {
  const agencies = mockAgencies()
  const list = renderToStaticMarkup(createElement(PeoplePage, { user: 'engineer@napkin', onClose: noop, initial: { people: MOCK_PEOPLE, agencies }, initialTab: 'agencies' }))
  assert.match(list, /Agencies <small>12<\/small>/)
  assert.match(list, /People <small>11<\/small>/)
  const tagsOf = (id: string) => { const tr = list.slice(list.indexOf(`data-agency="${id}"`)); return [...tr.slice(0, tr.indexOf('</tr>')).matchAll(/class="pa-tag ag-(\w+)">([^<]+)</g)].map(m => m[2]) }
  for (const id of Object.keys(AGENCY_COLOURS)) assert.deepEqual(tagsOf(id), ['In code'], id)
  assert.deepEqual(tagsOf('saltmarsh'), ['Basic'])
  assert.deepEqual(tagsOf('kestrellane'), ['Basic', 'Draft'])
  assert.match(list, /<b>Boys\+Girls<\/b><br\/><span class="ag-mono">@boysandgirls<\/span><\/td><td class="ag-mono">bg, boysgirls, b\+g<\/td><td>1<\/td>/)
  assert.match(list, />New agency</)
  // the list's pill is what people see now: Kestrel Lane's published look (no wordmark), not its draft
  const kestrel = list.slice(list.indexOf('data-agency="kestrellane"'))
  assert.match(kestrel.slice(0, kestrel.indexOf('</td>')), /<span class="big">Kestrel Lane<\/span>/)

  const people = renderToStaticMarkup(createElement(PeoplePage, { user: 'engineer@napkin', onClose: noop, initial: { people: MOCK_PEOPLE, agencies } }))
  const cell = (id: string) => { const at = people.indexOf(`<small>${id}</small>`); const td = people.slice(at, people.indexOf('</tr>', at)); return td }
  assert.match(cell('niamh@bg'), /data-testid="look-pill" style="background:#000000;color:#FFFFFF;box-shadow:inset 0 0 0 1.5px #FFFFFF"/, 'B+G by its other spelling')
  assert.match(cell('niamh@bg'), /<img src="data:image\/svg\+xml,[^"]+" alt="Boys\+Girls"/)
  assert.match(cell('owen@saltmarsh'), /<img src="data:image\/svg\+xml,[^"]+" alt="Saltmarsh"/, 'a basic agency\'s published wordmark')
  assert.match(cell('ella@kestrel'), /<span class="big">Kestrel Lane<\/span>/)
  assert.match(cell('engineer@napkin'), /<span class="big">Napkin Studio<\/span><\/span>/, 'Napkin Studio once')
  assert.doesNotMatch(cell('engineer@napkin'), /NAPKIN STUDIO/)
  assert.match(cell('ann@napkin'), /<small>member<\/small>/)
  registerAgencyLooks([])
})

test('a new basic agency: a draft on the page until Publish makes it, its id from the name', async () => {
  const api = fakePeopleApi()
  let st = openNew()
  let html = view(st)
  assert.match(html, /Not saved yet\. Your first edit starts a draft\./)
  assert.match(html, /class="pa-tag ag-new">New/)
  assert.match(html, /value="@…"/)
  assert.match(html, /Placeholder colours until you pick a base and an accent\./)
  assert.match(buttonOf(html, 'Publish'), /disabled/)
  assert.match(buttonOf(html, 'Copy to code'), /disabled.*title="Publish first"/)
  st = edit(st, { name: 'Rothco & Sons' })
  html = view(st)
  assert.match(html, /value="@rothcoandsons"/, 'Signs in as, made from the name')
  assert.match(html, /Draft by engineer@napkin, .*not live.*Publish needs a name and both colours\./)
  assert.match(buttonOf(html, 'Publish'), /disabled/)
  st = edit(edit(st, { base: '#0F6B5C' }), { accent: '#9FE6D8', aliases: ['rothco'] })
  assert.doesNotMatch(buttonOf(view(st), 'Publish'), /disabled/)
  // edits of a new agency stay on the page
  assert.deepEqual(await saveDraft(api, st, ['name']), st)
  // its wordmark is checked on the page, and sent with it at Publish
  const { good } = cannedFiles('Rothco', '#0F6B5C')
  st = await upload(api, st, good.name, good.src)
  assert.ok(st.look.wordmark?.startsWith('data:image/svg+xml,'))
  assert.ok(st.report?.ok)
  assert.deepEqual(calls(api), [])
  st = await publish(api, st)
  assert.deepEqual(calls(api), ['createAgency', 'putWordmark', 'publish'])
  assert.deepEqual(api.heard[0].args[0], { name: 'Rothco & Sons', aliases: ['rothco'], base: '#0F6B5C', accent: '#9FE6D8' }, 'no id sent')
  assert.deepEqual(api.heard[2].args, ['rothcoandsons', 2], 'published with the rev the wordmark returned')
  assert.equal(st.row?.id, 'rothcoandsons')
  assert.equal(st.flash?.lead, 'Published.')
  assert.ok(rowOf(api, 'rothcoandsons').kind === 'basic' && (rowOf(api, 'rothcoandsons') as BasicRow).published)
  // discarding a new one makes nothing
  assert.equal(await discard(api, edit(openNew(), { name: 'X' })), null)
})

test('a wordmark upload: the server\'s cleaned SVG replaces the preview; a refusal says why and where, and keeps the old one', async () => {
  const api = fakePeopleApi()
  const files = cannedFiles('Kestrel Lane', '#1F4E3D')
  const open = openRow(rowOf(api, 'kestrellane'))
  const before = open.look.wordmark
  const took = await upload(api, open, files.good.name, files.good.src)
  assert.deepEqual(calls(api), ['putWordmark'])
  assert.equal(took.look.wordmark, (rowOf(api, 'kestrellane') as BasicRow).draft!.wordmark, 'the server\'s SVG')
  assert.equal(took.row!.rev, rowOf(api, 'kestrellane').rev, 'the returned rev is the next call\'s')
  assert.ok(took.report?.ok && took.report.dropped.includes('metadata'))
  assert.match(view(took), /kestrel-wordmark\.svg<\/b> taken, in the draft\. Cleaned: .* kept of .*; dropped: metadata\./)
  assert.match(view(took), /Now: <span class="ag-mono">kestrel-wordmark\.svg<\/span>/)

  const refused = await upload(api, open, files.bad.name, files.bad.src)
  assert.equal(refused.look.wordmark, before, 'the wordmark is unchanged')
  assert.ok(refused.report && !refused.report.ok)
  assert.equal(refused.report.why, 'Refused: the file has a script on line 4.')
  const html = view(refused)
  assert.match(html, /data-testid="upload-refused"/)
  assert.match(html, /kestrel-wordmark-final\.svg<\/b> · Refused: the file has a script on line 4\. The wordmark is unchanged\./)
  assert.match(html, /<mark> {2}4 {2}&lt;script&gt;new Image\(\)/, 'the line, marked')
  assert.match(html, /<span> {2}2 {2}&lt;svg /)
  // the server's refusal is what counts: a 422 with found lines, as the fake (napkin-web) answers
  assert.equal(api.heard.at(-1)!.call, 'putWordmark')
})

test('Does it read? warns on a hard-to-read draft and never blocks Publish', async () => {
  const api = fakePeopleApi()
  let st = edit(openRow(rowOf(api, 'kestrellane')), { accent: '#5A9A78' })
  st = await saveDraft(api, st, ['accent'])
  assert.deepEqual(api.heard.map(h => [h.call, h.args[1]]), [['patchDraft', { rev: 6, accent: '#5A9A78' }]])
  const html = view(st)
  assert.match(html, /1 hard to read/)
  assert.match(html, /<li class="bad" data-ok="false">.*Logo on the pill.*2\.9:1.*needs 3:1/)
  assert.doesNotMatch(buttonOf(html, 'Publish'), /disabled/, 'a warning never stops publishing')
  const good = view(openRow(mockAgencies().find(r => r.id === 'kestrellane')!))
  assert.match(good, /all read/)
  assert.equal((good.match(/<li class="good"/g) ?? []).length, 6)
})

test('Publish and Discard draft call the server and say what happened; a stale rev reloads', async () => {
  const api = fakePeopleApi()
  const live = await publish(api, openRow(rowOf(api, 'kestrellane')))
  assert.deepEqual(api.heard.at(-1), { call: 'publish', args: ['kestrellane', 6] })
  assert.equal(live.flash?.text, 'People at Kestrel Lane see it the next time a page loads.')
  assert.match(view(live), /Published by engineer@napkin, 13 Nov 2026 · 14:40/)
  assert.match(buttonOf(view(live), 'Discard draft'), /disabled/, 'nothing to discard')
  assert.match(buttonOf(view(live), 'Publish'), /disabled/)

  const api2 = fakePeopleApi()
  const gone = await discard(api2, openRow(rowOf(api2, 'kestrellane')))
  assert.deepEqual(api2.heard.at(-1), { call: 'discardDraft', args: ['kestrellane'] })
  assert.equal(gone?.flash?.lead, 'Draft discarded.')
  assert.equal(gone?.look.accent, '#E8B04A', 'as it was')

  // another tab moved the rev on: the agency is reloaded and the page says so
  const api3 = fakePeopleApi()
  const old = openRow(structuredClone(rowOf(api3, 'kestrellane')))
  rowOf(api3, 'kestrellane').rev = 9
  const reloaded = await saveDraft(api3, edit(old, { name: 'Kestrel' }), ['name'])
  assert.equal(reloaded.flash?.lead, 'Changed elsewhere.')
  assert.equal(reloaded.row?.rev, 9)
  assert.equal(reloaded.look.name, 'Kestrel Lane')
})

test('an agency in code: its look read-only, its display name a draft, Reset name back to the code\'s', async () => {
  const api = fakePeopleApi()
  const open = openRow(rowOf(api, 'boysandgirls'))
  assert.throws(() => edit(open, { base: '#FF0000' }), /name only/)
  assert.throws(() => edit(open, { aliases: ['bgd'] }), /name only/)
  let html = view(open)
  assert.match(html, /data-kind="code"/)
  assert.match(html, /This look is in code\. Change it through a PR\./)
  assert.match(html, /AGENCY_COLOURS\.boysandgirls/)
  for (const no of [/type="color"/, /Choose an SVG|Replace the SVG/, /Does it read\?/, /Add a spelling/, /data-testid="copy-to-code"/]) assert.doesNotMatch(html, no)
  assert.match(html, /<div class="ag-chips ro"><span>bg<\/span><span>boysgirls<\/span><span>b\+g<\/span><\/div>/)
  assert.match(html, /As in code/)
  assert.doesNotMatch(html, /Reset name/)

  let st = await saveDraft(api, edit(open, { name: 'Boys+Girls Dublin' }), ['name'])
  assert.deepEqual(api.heard.at(-1), { call: 'patchDraft', args: ['boysandgirls', { rev: 1, name: 'Boys+Girls Dublin' }] })
  html = view(st)
  assert.match(html, /In code: <b>Boys\+Girls<\/b>\. <button type="button" class="pa-link">Reset name<\/button>/)
  assert.match(html, /class="pa-tag ag-code">In code<\/span><span class="pa-tag ag-draft">Draft/)
  assert.match(html, /As in code<\/span><span> · <\/span><b>Draft by engineer@napkin, 13 Nov 2026 · 14:40<\/b>/)
  assert.match(html, /Sign in to Boys\+Girls Dublin on Napkin Studio\./, 'the previews show the draft name')
  // Reset name is an edit of the draft, back to the code's name (then Publish)
  st = await resetName(api, st)
  assert.deepEqual(api.heard.at(-1), { call: 'patchDraft', args: ['boysandgirls', { rev: 2, name: 'Boys+Girls' }] })
  assert.equal(st.look.name, 'Boys+Girls')
  assert.ok(!calls(api).includes('putWordmark') && !calls(api).includes('exportCode'))
})

test('Copy to code: only for a published basic agency, with its four boxes and three steps', async () => {
  const api = fakePeopleApi()
  // not published yet: the button waits, and nothing is asked
  const made = await api.createAgency({ name: 'Rothco', base: '#0F6B5C', accent: '#9FE6D8' })
  api.heard.length = 0
  const draft = openRow(made)
  assert.match(buttonOf(view(draft), 'Copy to code'), /disabled.*title="Publish first"/)
  assert.equal(await toggleCopy(api, draft), draft)
  assert.deepEqual(calls(api), [])
  // published: the code it would be
  const salt = openRow(rowOf(api, 'saltmarsh'))
  assert.doesNotMatch(buttonOf(view(salt), 'Copy to code'), /disabled/)
  const shown = await toggleCopy(api, salt)
  assert.deepEqual(calls(api), ['exportCode'])
  const html = view(shown)
  assert.match(html, /Copy to code <span class="ag-mono">the published look, for a pull request/)
  assert.match(html, /1\. Save the SVG into the owner’s assets folder\..*2\. Run .*node scripts\/agency-logos\.mjs.*3\. Paste the entry and open a PR\./)
  for (const box of ['The look', 'saltmarsh-logo.svg', 'The logo file', 'The server’s copy']) assert.match(html, new RegExp(`<b>${box.replace('.', '\\.')}</b>`), box)
  assert.equal((html.match(/>Copy<\/button>/g) ?? []).length, 4)
  assert.match(html, /&#x27;salt marsh&#x27;: &#x27;saltmarsh&#x27;,/, 'the other spellings go to code too')
  assert.match(html, />Hide the code</)
  assert.equal((await toggleCopy(api, shown)).copy, null)
})

// The Style card (features/agency-style.clan; mock people-agencies-v4, states 9-11)
const segOf = (html: string, name: string) => {
  const at = html.indexOf(`data-testid="seg-${name}"`)
  return [...html.slice(at, html.indexOf('</span>', at)).matchAll(/<button type="button"( class="on")? aria-pressed="(true|false)">([^<]+)<\/button>/g)].map(m => [m[3], m[2] === 'true'] as const)
}
const onOf = (html: string, name: string) => segOf(html, name).find(([, on]) => on)?.[0]
const frame = (html: string, theme: 'light' | 'dark') => { const at = html.indexOf(`data-testid="preview-${theme}"`); return html.slice(html.lastIndexOf('<div', at), html.indexOf('BRIEF HEADER', at)) }

test('the Style card: four switches between Colours and Wordmark, defaults are today\'s look', () => {
  const api = fakePeopleApi()
  const html = view(openRow(rowOf(api, 'saltmarsh')))
  assert.ok(html.indexOf('data-testid="colours"') < html.indexOf('data-testid="style-card"') && html.indexOf('data-testid="style-card"') < html.indexOf('data-testid="wordmark-card"'), 'between Colours and Wordmark')
  assert.deepEqual(segOf(html, 'Pill'), [['Accent fill', true], ['Base with accent outline', false]])
  assert.deepEqual(segOf(html, 'Accent use'), [['Fill', true], ['Outline only', false]])
  assert.deepEqual(segOf(html, 'Surfaces'), [['Warm paper', true], ['Plain', false]])
  assert.deepEqual(segOf(html, 'Text on accent'), [['Automatic', true], ['Choose a colour', false]])
  assert.match(html, /data-testid="auto-ink"><i style="background:#101114"><\/i>near-black, worked out/)
  assert.match(html, /These change how the two colours are used, not the colours\./)
  // today's look, unchanged: the accent pill, warm desk, and the six rows
  assert.match(frame(html, 'light'), /data-testid="look-pill" style="background:#9AD1E8;color:#101114"/)
  assert.match(frame(html, 'light'), /--desk:#/)
  assert.doesNotMatch(frame(html, 'light'), /--ag-pill-line|--ag-act-line|--desk:#F5F5F4/)
  assert.equal((html.match(/<li class="good"/g) ?? []).length, 6)
  // an agency in code has no switches
  assert.doesNotMatch(view(openRow(rowOf(api, 'acne'))), /data-testid="style-card"/)
})

test('the Style card: an ACNE twin made on the page; each switch goes to the draft, previews and checks follow, publish carries them', async () => {
  const api = fakePeopleApi()
  let st = openRow(rowOf(api, 'saltmarsh'))
  st = edit(st, { base: '#000000', accent: '#86BC25' })
  st = edit(st, { pill: 'base' })
  st = edit(st, { accentUse: 'line' })
  st = edit(st, { surface: 'mono' })
  st = await saveDraft(api, st, ['base', 'accent', 'pill', 'accentUse', 'surface', 'accentInk'])
  assert.deepEqual(api.heard.at(-1), { call: 'patchDraft', args: ['saltmarsh', { rev: 4, base: '#000000', accent: '#86BC25', pill: 'base', accent_use: 'line', surface: 'mono', accent_ink: null }] })
  const d = (rowOf(api, 'saltmarsh') as BasicRow).draft!
  assert.deepEqual([d.pill, d.accent_use, d.surface, d.accent_ink], ['base', 'line', 'mono', undefined])
  const html = view(st)
  assert.equal(onOf(html, 'Pill'), 'Base with accent outline')
  assert.equal(onOf(html, 'Accent use'), 'Outline only')
  assert.equal(onOf(html, 'Surfaces'), 'Plain')
  // the previews: the base pill with the accent rim, plain surfaces, outlined buttons, in both themes
  for (const theme of ['light', 'dark'] as const) {
    const f = frame(html, theme)
    assert.match(f, /data-testid="look-pill" style="background:#000000;color:#FFFFFF;box-shadow:inset 0 0 0 1.5px #86BC25"/, theme)
    assert.match(f, /--ag-act:#000000/, `${theme}: the buttons are the base`)
    assert.match(f, /--ag-act-line:#86BC25/, theme)
    assert.match(f, theme === 'light' ? /--desk:#F5F5F4/ : /--desk:#000000/, `${theme}: plain`)
  }
  // Does it read? follows: the buttons named for the base, the needs badge and the outline
  const checks = html.slice(html.indexOf('data-testid="checks"'))
  for (const l of ['Text on the pill', 'Text on the base \\(buttons, light\\)', 'Text on the base \\(buttons, dark\\)', 'Text on the accent \\(needs badge\\)', 'Accent outline on the base \\(pill, buttons\\)'])
    assert.match(checks, new RegExp(`<span>${l}</span>`), l)
  assert.match(checks, /<span class="sw" style="background:#000000;box-shadow:inset 0 0 0 2px #86BC25"><\/span><span>Accent outline/)
  assert.match(checks, /all read/)
  // back to a default clears the field (null on the wire)
  const back = await saveDraft(api, edit(st, { surface: 'warm' }), ['surface'])
  assert.deepEqual(api.heard.at(-1)!.args[1], { rev: 5, surface: null })
  assert.equal((rowOf(api, 'saltmarsh') as BasicRow).draft!.surface, undefined)
  // publish: the live look carries them, and so does what /agency-looks would serve
  const live = await publish(api, await saveDraft(api, edit(back, { surface: 'mono' }), ['surface']))
  const row = rowOf(api, 'saltmarsh') as BasicRow
  assert.deepEqual([row.pill, row.accent_use, row.surface, row.accent_ink], ['base', 'line', 'mono', undefined])
  assert.equal(live.look.pill, 'base')
  registerRows(api.rows)
  assert.deepEqual(pick(coloursOf('saltmarsh')!), { pill: 'base', accentUse: 'line', surface: 'mono', accentInk: undefined })
  registerAgencyLooks([])
  // Copy to code has the style lines
  const copy = await toggleCopy(api, live)
  assert.match(copy.copy!.palette_ts, /\n {4}name: 'Saltmarsh', base: '#000000', accent: '#86BC25', pill: 'base', accentUse: 'line', surface: 'mono',\n/)
  assert.match(view(copy), /pill: &#x27;base&#x27;, accentUse: &#x27;line&#x27;, surface: &#x27;mono&#x27;,/)
})

test('the Style card: text on the accent set (Marlow Bay, navy on lime) starts from the base and reads', async () => {
  const api = fakePeopleApi()
  let st = edit(openNew(), { name: 'Marlow Bay', base: '#0B1F4D', accent: '#A8E04A' })
  assert.match(view(st), /near-black, worked out/)
  // "Choose a colour" starts from the base, which reads on the lime
  assert.equal(startInk(st.look), '#0B1F4D')
  assert.equal(startInk({ base: '#1F4E3D', accent: '#5A9A78' }), '#101114', 'a base that does not read: the worked-out ink')
  st = edit(st, { accentInk: startInk(st.look) })
  const html = view(st)
  assert.equal(onOf(html, 'Text on accent'), 'Choose a colour')
  assert.match(html, /aria-label="Text on accent" class="ag-hex" maxLength="7" placeholder="#RRGGBB" value="#0B1F4D"/)
  assert.doesNotMatch(html, /data-testid="auto-ink"/)
  assert.match(frame(html, 'light'), /data-testid="look-pill" style="background:#A8E04A;color:#0B1F4D"/)
  assert.match(frame(html, 'dark'), /--ag-act:#A8E04A;--ag-act-ink:#0B1F4D/, 'the dark buttons: navy on lime')
  // a new agency: made, its style to the draft, then published
  const live = await publish(api, st)
  assert.deepEqual(calls(api), ['createAgency', 'patchDraft', 'publish'])
  assert.deepEqual(api.heard[1].args, ['marlowbay', { accent_ink: '#0B1F4D', rev: 1 }])
  assert.equal((rowOf(api, 'marlowbay') as BasicRow).accent_ink, '#0B1F4D')
  assert.equal(live.look.accentInk, '#0B1F4D')
  assert.match((await toggleCopy(api, live)).copy!.palette_ts, /accent: '#A8E04A', accentInk: '#0B1F4D',\n/, 'accentInk at the end of the first line')
  // a default-style new agency sends no style at all
  const api2 = fakePeopleApi()
  await publish(api2, edit(openNew(), { name: 'Plain Co', base: '#0B1F4D', accent: '#A8E04A' }))
  assert.deepEqual(calls(api2), ['createAgency', 'publish'])
})

test('the fake server refuses a bad style value, and an agency in code takes no style', async () => {
  const api = fakePeopleApi()
  await assert.rejects(api.patchDraft('saltmarsh', { rev: 4, pill: 'round' as never }), /pill/)
  await assert.rejects(api.patchDraft('saltmarsh', { rev: 4, accent_ink: 'navy' }), /accent_ink/)
  await assert.rejects(api.patchDraft('acne', { rev: 1, pill: 'base' }), /name only/)
  assert.throws(() => edit(openRow(rowOf(api, 'acne')), { surface: 'warm' }), /name only/)
})

test('an agency in code lists its style read-only', () => {
  const api = fakePeopleApi()
  const html = view(openRow(rowOf(api, 'acne')))
  const style = html.slice(html.indexOf('>', html.indexOf('data-testid="code-style"')) + 1, html.indexOf('<label>Logos'))
  const words = style.replace(/<[^>]+>/g, '').split('·').map(s => s.trim())
  assert.deepEqual(words, ['Pill: base with accent outline', 'Accent: outline only', 'Surfaces: plain', 'Text on accent: automatic'])
  const pluto = view(openRow(rowOf(api, 'pluto')))
  assert.match(pluto, /Text on accent: <i style="background:#000047"><\/i><span class="ag-mono">#000047<\/span>/)
  assert.match(pluto, /Pill: accent fill.*Accent: fill.*Surfaces: warm paper/)
})

const pick = (c: AgencyColours) => ({ pill: c.pill, accentUse: c.accentUse, surface: c.surface, accentInk: c.accentInk })
