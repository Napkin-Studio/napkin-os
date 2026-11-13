// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's look is palette.ts alone (features/align-landing-look.clan): ink on the agency colour reads at 4.5 to 1
// or more for every agency in the registry and for one added from the People page (registerAgencyLooks), in light
// and in dark, and an added agency repaints the same tokens a registry one does.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGENCY_COLOURS, agencyCss, applyAgency, coloursOf, contrast, inkOn, paletteOf, registerAgencyLooks, surfaceCss, type AgencyColours,
} from '../src/shell/agency/palette.ts'

const ADDED = [
  { id: 'acme', name: 'Acme Studio', base: '#0F6B5C', accent: '#9FE6D8' },
  { id: 'kiln', name: 'Kiln', base: '#16181D', accent: '#C6F432' },
  { id: 'pale', name: 'Pale', base: '#F2E9D8', accent: '#FFFFFF' },
]

const readsOn = (c: AgencyColours, label: string) => {
  const p = paletteOf(c)
  for (const theme of ['light', 'dark'] as const) {
    const t = p[theme]
    assert.ok(contrast(t.agency, t.fg) >= 4.5, `${label} ${theme}: ${t.fg} on ${t.agency} is ${contrast(t.agency, t.fg).toFixed(2)}`)
  }
  assert.ok(contrast(c.accent, inkOn(c.accent)) >= 4.5, `${label}: inkOn(accent) is ${contrast(c.accent, inkOn(c.accent)).toFixed(2)}`)
  assert.ok(contrast(c.base, inkOn(c.base)) >= 4.5, `${label}: inkOn(base) is ${contrast(c.base, inkOn(c.base)).toFixed(2)}`)
}

test('inkOn reads at 4.5 to 1 on every registry entry, accent and base, and on agencies added from the People page', () => {
  for (const [id, c] of Object.entries(AGENCY_COLOURS)) readsOn(c, id)
  registerAgencyLooks(ADDED)
  for (const a of ADDED) {
    const c = coloursOf(a.id)
    assert.ok(c, `${a.id} joined the registry`)
    readsOn(c!, a.id)
  }
  registerAgencyLooks([])
})

test('an added agency repaints --agency, --agency-fg, --agency-soft and the --ag-* tokens as a registry one does', () => {
  registerAgencyLooks(ADDED)
  applyAgency('sam@acme')
  const read = (id: string) => (document.getElementById(id) as unknown as { textContent: string } | null)?.textContent ?? ''
  assert.equal(read('napkin-agency'), agencyCss(paletteOf(coloursOf('acme'))))
  assert.match(read('napkin-agency'), /--agency: #9FE6D8/)
  const surface = read('napkin-agency-surface')
  assert.equal(surface, surfaceCss(coloursOf('acme')))
  assert.match(surface, /--ag-base: #0F6B5C; --ag-acc: #9FE6D8/)
  registerAgencyLooks([])
  applyAgency('sam@wk')
  assert.match(read('napkin-agency'), /--agency: #FFB800/, 'a registry agency is read the same way')
})

test('the registry wins over a People-page agency that takes its id, and a bad colour is not taken', () => {
  registerAgencyLooks([{ id: 'wk', name: 'Not W+K', base: '#000000', accent: '#FFFFFF' }, { id: 'bad', name: 'Bad', base: 'blue', accent: '#FFFFFF' }])
  assert.equal(coloursOf('wk')?.name, AGENCY_COLOURS.wk.name)
  assert.equal(coloursOf('bad'), null)
  registerAgencyLooks([])
})
