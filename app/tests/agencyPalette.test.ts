// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency layer (shell/agency/palette.ts, features/new-ui-shell.clan):
// admin-set colours from the registry, legible in light and dark, a layer of
// its own that the app theme reset never clears, and never the --create accent.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { AGENCY_COLOURS, NEUTRAL, agencyCss, agencyIdOf, applyAgency, coloursOf, contrast, paletteOf } from '../src/shell/agency/palette.ts'

const INK = { light: '#14161B', dark: '#F2F3F5' }

test('every agency in the registry reads: its ink on its colour at 4.5:1 or more, light and dark', () => {
  for (const [id, colours] of Object.entries(AGENCY_COLOURS)) {
    const p = paletteOf(colours)
    for (const theme of ['light', 'dark'] as const) {
      const t = p[theme]
      assert.ok(contrast(t.agency, t.fg) >= 4.5, `${id} ${theme}: ${t.fg} on ${t.agency} is ${contrast(t.agency, t.fg).toFixed(2)}`)
      // the wash sits under the chrome's own ink (hover, selected rows)
      assert.ok(contrast(t.soft, INK[theme]) >= 4.5, `${id} ${theme}: ink on the soft wash`)
    }
  }
})

test('the neutral pair reads too, and is what an agency with no colours gets', () => {
  for (const theme of ['light', 'dark'] as const) assert.ok(contrast(NEUTRAL[theme].agency, NEUTRAL[theme].fg) >= 4.5)
  assert.deepEqual(paletteOf(null), NEUTRAL)
  assert.deepEqual(paletteOf({ accent: 'orange', base: '#000000' }), NEUTRAL, 'not a colour: neutral')
  assert.equal(coloursOf('someone-else'), null)
  assert.equal(coloursOf(null), null)
})

test('the agency is read from who signed in: name@agency, lower case; none for the desktop', () => {
  assert.equal(agencyIdOf('sam@WK'), 'wk')
  assert.equal(agencyIdOf('local'), null)
  assert.equal(agencyIdOf('sam@'), null)
  assert.equal(agencyIdOf(null), null)
  assert.deepEqual(coloursOf(agencyIdOf('sam@tbwa')), AGENCY_COLOURS.tbwa)
})

test('the layer is its own <style>, for both themes, setting only the three agency tokens', () => {
  applyAgency('sam@wk')
  const el = document.getElementById('napkin-agency') as unknown as { textContent: string }
  assert.ok(el, 'a style element of its own')
  assert.equal(el.textContent, agencyCss(paletteOf(AGENCY_COLOURS.wk)))
  assert.match(el.textContent, /:root\[data-theme='dark'\] \{ --agency: #FFB800;/)
  const names = [...el.textContent.matchAll(/(--[\w-]+):/g)].map(m => m[1])
  assert.deepEqual([...new Set(names)].sort(), ['--agency', '--agency-fg', '--agency-soft'], 'never --create or --accent')
  applyAgency('sam@nowhere')
  assert.equal(el.textContent, agencyCss(NEUTRAL), 'a later sign-in replaces it in place')
})

test('the app theme reset never clears the agency layer: it is not one of the inline THEME_VARS', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  const vars = /const THEME_VARS[^}]+}/.exec(app)![0]
  assert.doesNotMatch(vars, /--agency/)
  // the chrome uses --agency only in chrome.css: the department colour stays --create
  const css = readFileSync('src/components/chrome.css', 'utf8')
  assert.doesNotMatch(css, /--create:\s*var\(--agency/)
  assert.doesNotMatch(readFileSync('src/index.css', 'utf8'), /--create:\s*var\(--agency/)
})
