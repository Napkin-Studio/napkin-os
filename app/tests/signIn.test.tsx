// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The sign-in screen asks for one name, `name@agency`, and for a password only
// when the server has passwords (features/no-password-sign-in.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SignIn } from '../src/shell/SignIn.tsx'
import { accountName, isAccountName } from '../src/shell/accountName.ts'

const render = (asksPassword: boolean) =>
  renderToStaticMarkup(createElement(SignIn, { asksPassword, onDone: () => {} }))

test('a roster studio asks for one name, name@agency, and no password', () => {
  const html = render(false)
  assert.equal((html.match(/<input/g) || []).length, 1, 'one box')
  assert.match(html, /name="username"/)
  assert.match(html, /placeholder="name@agency"/)
  assert.doesNotMatch(html, /type="password"/)
})

test('a studio with passwords still asks for one', () => {
  const html = render(true)
  assert.match(html, /name="username"/)
  assert.match(html, /type="password"/)
  assert.equal((html.match(/<input/g) || []).length, 2, 'name and password')
})

test('the account name is name@agency, trimmed and lower case', () => {
  assert.equal(accountName(' Engineer@Napkin '), 'engineer@napkin')
  assert.ok(isAccountName('engineer@napkin'))
  for (const bad of ['engineer', 'engineer@', '@napkin', 'a@b@c', ''])
    assert.ok(!isAccountName(bad), bad)
})

test('the screen is the mock card: medallion, heading, Napkin before any agency is known', () => {
  const html = render(true)
  assert.match(html, /class="nui p33-signin"/)
  assert.match(html, /data-agency="none"/)
  assert.match(html, /class="si-card"/)
  assert.match(html, /data-testid="medallion-mark"/)
  assert.match(html, /Sign in to Napkin Studio\./)
  assert.match(html, /class="btn-rect primary"/)
  assert.match(html, /Forgot your password\?/)
})

test('a roster studio offers no forgotten password', () => {
  assert.doesNotMatch(render(false), /Forgot your password/)
})

// Agency looks on the sign-in card (owner, 2026-11-11): Napkin's by default,
// the registry agency's as soon as the typed name names one, from the
// registry alone.

import { LOOK_DELAY_MS, signInLookOf } from '../src/shell/agency/signInLook.ts'
import { AGENCY_COLOURS, NAPKIN_COLOURS, agencyOfSignInName, paletteOf, surfaceCss } from '../src/shell/agency/palette.ts'

const napkinMark = { base: NAPKIN_COLOURS.base, accent: NAPKIN_COLOURS.accent }

test('the default look is Napkin: nothing typed, or no @ yet', () => {
  for (const typed of ['', 'tia', 'tbwa', 'tia@']) {
    const look = signInLookOf(typed)
    assert.equal(look.id, null, typed)
    assert.equal(look.lede, 'Sign in to Napkin Studio.')
    assert.deepEqual(look.mark, napkinMark)
  }
  assert.ok(LOOK_DELAY_MS > 0 && LOOK_DELAY_MS <= 200, 'a light debounce')
})

test('"tia@tbwa" takes tbwa\'s name and colours', () => {
  const look = signInLookOf('tia@tbwa')
  assert.equal(look.id, 'tbwa')
  assert.equal(look.lede, 'Sign in to TBWA\\Dublin on Napkin Studio.')
  assert.deepEqual(look.mark, { base: '#16181D', accent: '#FFD400' })
  assert.equal(signInLookOf(' Tia@TBWA ').id, 'tbwa', 'as the server reads it: trimmed, lower case')
  // the action colour the button takes: the base in light, the accent in dark
  assert.match(surfaceCss(AGENCY_COLOURS.tbwa), /--ag-act: #16181D;.*\n.*--ag-act: #FFD400;/)
})

test('"x@unknown" stays Napkin, as does anything that is not a registry id', () => {
  for (const typed of ['x@unknown', 'x@toString', 'x@__proto__', 'a@b@tbwa', 'x@unknown.com', 'x@com.tbwa']) {
    const look = signInLookOf(typed)
    assert.equal(look.id, null, typed)
    assert.equal(look.lede, 'Sign in to Napkin Studio.', typed)
    assert.deepEqual(look.mark, napkinMark, typed)
  }
})

test('an email maps by its domain before the TLD', () => {
  assert.equal(agencyOfSignInName('siobhan.ryan@tbwa.com'), 'tbwa')
  assert.equal(agencyOfSignInName('sam@wk.co.uk'), 'wk')
  assert.equal(agencyOfSignInName('sam@mail.ogilvy.ie'), 'ogilvy')
  assert.equal(signInLookOf('siobhan.ryan@tbwa.com').lede, 'Sign in to TBWA\\Dublin on Napkin Studio.')
  assert.equal(agencyOfSignInName('sam@tbwa.'), 'tbwa', 'mid-typing the TLD')
})

test('every registry agency is a complete look: name, base, accent and both themes\' tokens', () => {
  for (const [id, c] of Object.entries(AGENCY_COLOURS)) {
    assert.ok(c.name.trim(), `${id} has a name`)
    assert.match(c.base, /^#[0-9A-F]{6}$/i, `${id} base`)
    assert.match(c.accent, /^#[0-9A-F]{6}$/i, `${id} accent`)
    const p = paletteOf(c)
    for (const theme of ['light', 'dark'] as const)
      for (const k of ['agency', 'fg', 'soft'] as const) assert.match(p[theme][k], /^#[0-9A-F]{6}$/i, `${id} ${theme} ${k}`)
    assert.equal(signInLookOf(`someone@${id}`).id, id)
  }
})

test('after a sign-out the card is Napkin\'s again, still saying "Signed out."', () => {
  const g = globalThis as Record<string, unknown>
  const had = g.window
  const mem = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init))
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  }
  g.window = { localStorage: mem({ 'napkin.lastAgency': 'tbwa' }), sessionStorage: mem({ 'napkin.signedOut': '1' }) }
  try {
    const html = render(false)
    assert.match(html, /Signed out\./)
    assert.match(html, /data-agency="none"/)
    assert.match(html, /Sign in to Napkin Studio\./)
    assert.doesNotMatch(html, /TBWA/)
  } finally { if (had === undefined) delete g.window; else g.window = had }
})

test('no network call resolves the look', () => {
  const g = globalThis as Record<string, unknown>
  const had = g.fetch
  let calls = 0
  g.fetch = () => { calls++; return Promise.reject(new Error('no network')) }
  try {
    for (const typed of ['tia@tbwa', 'x@unknown', 'siobhan.ryan@tbwa.com', 'sam@wk', ''])
      signInLookOf(typed)
    render(true); render(false)
    assert.equal(calls, 0)
  } finally { g.fetch = had }
})
