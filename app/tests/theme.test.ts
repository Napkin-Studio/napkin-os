// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// There are two themes (features/align-landing-look.clan): light and dark. What an earlier build stored (white, grey,
// black) is read as the theme it sat in, so no one's choice is lost; nothing sets data-mode any more.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bootHeadScript } from '../src/brand/bootLook.ts'
import { getTheme, parseTheme, setTheme, toggleTheme } from '../src/theme.ts'

test('the three stored values of the earlier build map to light or dark, and the two of develop stay', () => {
  assert.equal(parseTheme('white'), 'light')
  assert.equal(parseTheme('grey'), 'light', 'a stored Grey reads as light')
  assert.equal(parseTheme('black'), 'dark')
  assert.equal(parseTheme('light'), 'light')
  assert.equal(parseTheme('dark'), 'dark')
  for (const odd of [null, '', 'blue', 'GREY', ' dark']) assert.equal(parseTheme(odd), null, String(odd))
})

test('the theme is one attribute, data-theme; data-mode is never set', () => {
  setTheme('dark')
  assert.equal(getTheme(), 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  toggleTheme()
  assert.equal(getTheme(), 'light')
  assert.equal(document.documentElement.dataset.theme, 'light')
  assert.equal(document.documentElement.dataset.mode, undefined)
})

test('the boot script reads the stored values the same way and sets no data-mode', () => {
  const script = bootHeadScript()
  assert.doesNotMatch(script, /data-mode/)
  assert.match(script, /t==='white'\|\|t==='grey'/)
  assert.match(script, /t==='black'/)
})
