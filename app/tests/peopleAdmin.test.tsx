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
} from '../src/shell/agency/palette.ts'
import { signInLookOf } from '../src/shell/agency/signInLook.ts'
import PeoplePage, { AddSheet } from '../src/shell/people/PeoplePage.tsx'
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
  id, name: c.name, base: c.base, accent: c.accent, source: 'code',
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
  // the code registry wins a clash, and a bad colour is not taken
  registerAgencyLooks([{ id: 'napkin', name: 'Fake', base: '#000000', accent: '#000000' }, { id: 'odd', name: 'Odd', base: 'red', accent: '#FFFFFF' }])
  assert.equal(coloursOf('napkin')?.name, 'Napkin')
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
