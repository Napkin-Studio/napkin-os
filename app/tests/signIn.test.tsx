// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The sign-in screen asks for a user name and an agency, and for a password
// only when the server has passwords (features/no-password-sign-in.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SignIn } from '../src/shell/SignIn.tsx'
import { accountName } from '../src/shell/accountName.ts'

const render = (asksPassword: boolean) =>
  renderToStaticMarkup(createElement(SignIn, { asksPassword, onDone: () => {} }))

test('a roster studio asks for a user name and an agency, and no password', () => {
  const html = render(false)
  assert.match(html, /name="user"/)
  assert.match(html, /name="agency"/)
  assert.doesNotMatch(html, /type="password"/)
})

test('a studio with passwords still asks for one', () => {
  const html = render(true)
  assert.match(html, /name="user"/)
  assert.match(html, /name="agency"/)
  assert.match(html, /type="password"/)
})

test('the account name is user@agency, trimmed and lower case', () => {
  assert.equal(accountName(' Engineer ', 'Napkin '), 'engineer@napkin')
})
