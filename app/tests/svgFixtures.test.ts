// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shared SVG corpus (tests/fixtures/svg, features/agency-looks-admin.clan):
// the shell's sanitiser makes each <name>.svg into <name>.out.svg byte for
// byte, the hostile files are refused for what they carry and where, and the
// invalid ones are refused by the sanitiser. napkin-web's port
// (crates/napkin-web/src/svg_sanitise.rs) is held to the same files, so the
// People page's preview and the stored wordmark never differ.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { activeContent, sanitiseSvg } from '../src/shell/agency/svgSanitise.ts'

const DIR = 'tests/fixtures/svg'
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')

test('each fixture sanitises to its .out.svg, byte for byte, and again to itself', () => {
  const names = readdirSync(DIR).filter(f => f.endsWith('.svg') && !f.endsWith('.out.svg')).sort()
  assert.ok(names.length >= 12, `${names.length} fixtures`)
  for (const f of names) {
    const out = read(f.replace(/\.svg$/, '.out.svg'))
    assert.equal(sanitiseSvg(read(f)), out, f)
    assert.equal(sanitiseSvg(out), out, `${f}: idempotent`)
    assert.deepEqual(activeContent(read(f)), [], `${f}: nothing active`)
  }
})

test('every hostile file is refused, with what it carries and the line, as the server says', () => {
  const names = readdirSync(join(DIR, 'hostile')).filter(f => f.endsWith('.svg')).sort()
  assert.ok(names.length >= 11, `${names.length} hostile files`)
  for (const f of names) {
    const found = activeContent(read(`hostile/${f}`))
    assert.ok(found.length > 0, `${f} is refused`)
    assert.deepEqual(found, JSON.parse(read(`hostile/${f.replace(/\.svg$/, '.found.json')}`)), f)
  }
})

test('the invalid files are refused by the sanitiser: not an SVG, no viewBox, no shapes', () => {
  const why: Record<string, RegExp> = { 'not-svg.svg': /not an svg/, 'no-viewbox.svg': /viewBox/, 'no-shapes.svg': /no shapes/ }
  for (const f of readdirSync(join(DIR, 'invalid')).filter(f => f.endsWith('.svg')).sort())
    assert.throws(() => sanitiseSvg(read(`invalid/${f}`)), why[f] ?? /./, f)
})
