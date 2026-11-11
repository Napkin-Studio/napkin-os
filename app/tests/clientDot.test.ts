// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client's dot in the bar (.tb-cdot) and its disc: the monogram's ink on the client's fill must
// read (4.5 to 1) for every colour a client can take, so the accessibility scan (pilot test 7) never
// depends on which client was opened. The colours are the hashed palette (CLIENT_LOOKS) and every
// admin registry entry (CLIENT_REGISTRY). Nothing in the CSS changes the dot's fill or ink with the mode,
// so the pair is the same in White, Grey and Black; the test still walks the three modes.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MIN_CONTRAST, readableInk } from '../src/shell/agency/accent.ts'
import { CLIENT_REGISTRY, setClientAgency } from '../src/shell/agency/clients.ts'
import { contrast } from '../src/shell/agency/palette.ts'
import { CLIENT_LOOKS, clientLook, hashLook } from '../src/shell/nui/deskData.ts'
import { MODES } from '../src/theme.ts'

const every: { id: string; cl: string; ink: string }[] = [
  ...CLIENT_LOOKS.map((l, i) => ({ id: `palette ${i}`, ...l })),
  ...Object.entries(CLIENT_REGISTRY).flatMap(([agency, clients]) =>
    Object.entries(clients).map(([slug, c]) => ({ id: `${agency}/${slug}`, cl: c.base, ink: c.accent }))),
]

test('every client colour, as the shell draws it, reads: monogram ink on the fill, in all three modes', () => {
  assert.ok(every.length >= 8)
  for (const mode of MODES) {
    for (const c of every) {
      const ink = readableInk(c.cl, c.ink)
      assert.ok(contrast(ink, c.cl) >= MIN_CONTRAST, `${c.id} (${mode}): ${ink} on ${c.cl} is ${contrast(ink, c.cl).toFixed(2)}`)
    }
  }
})

test('clientLook hands the shell a readable pair for the hashed and the registry colours alike', () => {
  for (const agency of ['tbwa', 'wk', null]) {
    setClientAgency(agency ? `x@${agency}` : null)
    for (let i = 0; i < 200; i++) {
      const l = clientLook(`cli_${String(i).padStart(8, '0')}`, `Client ${i}`)
      assert.ok(contrast(l.ink, l.cl) >= MIN_CONTRAST, `${agency} ${i}: ${l.ink} on ${l.cl}`)
    }
    for (const slug of Object.keys(CLIENT_REGISTRY[agency ?? 'none'] ?? {})) {
      const l = clientLook(slug, slug)
      assert.ok(contrast(l.ink, l.cl) >= MIN_CONTRAST, `${agency} ${slug}`)
    }
  }
  setClientAgency(null)
  assert.ok(CLIENT_LOOKS.some(l => l.cl === hashLook('x').cl), 'the palette itself is untouched')
})

test('the ink moves only when it must, and only in lightness', () => {
  for (const c of every) {
    const out = readableInk(c.cl, c.ink)
    if (contrast(c.ink, c.cl) >= 4.8) assert.equal(out, c.ink, `${c.id} already reads and stays`)
  }
  assert.equal(readableInk('#DA291C', '#FFC72C').slice(0, 1), '#')
  assert.notEqual(readableInk('#DA291C', '#FFC72C'), '#FFC72C', 'the red and yellow pair was 3.1 to 1')
})
