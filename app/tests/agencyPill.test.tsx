// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency pill's visible words are inside its accessible name (WCAG 2.5.3, Label in Name). axe reads the
// text of the pill as one string, so the agency and "Napkin Studio" need a space between them in the markup,
// or "Wieden+KennedyNapkin Studio" is not in "Wieden+Kennedy Napkin Studio: back to the desk".

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgencyPill } from '../src/components/Toolbar.tsx'

for (const agency of ['Wieden+Kennedy', 'Boys+Girls', 'Pluto', 'Napkin Studio']) {
  test(`the pill for ${agency} says in its name what it shows`, () => {
    const html = renderToStaticMarkup(createElement(AgencyPill, { agency, onDesk: () => {} }))
    const name = html.match(/aria-label="([^"]*)"/)![1].replace(/&amp;/g, '&')
    const shown = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    assert.ok(shown.length > 0)
    assert.ok(name.toLowerCase().includes(shown.toLowerCase()), `"${shown}" is in "${name}"`)
  })
}
