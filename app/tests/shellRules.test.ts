// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the shell no longer has (features/align-landing-look.clan): nothing samples a logo and nothing sets
// --agency-accent, a data-mode attribute or the sampled-accent style; the files that did are gone, and the
// focus ring is var(--accent) again.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

// `npm test` runs from app/, and the bundled test does not sit where its source does.
const src = resolve(process.cwd(), 'src')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
const files = walk(src).filter(f => /\.(ts|tsx|css|js)$/.test(f))

test('no file in app/src names --agency-accent, data-mode or napkin-agency-accent', () => {
  const found: string[] = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const word of ['--agency-accent', 'data-mode', 'napkin-agency-accent']) if (text.includes(word)) found.push(`${f.slice(src.length + 1)}: ${word}`)
  }
  assert.deepEqual(found, [])
})

test('the sampling, the Agency look dialog and the third mode do not exist', () => {
  for (const gone of ['shell/agency/look.ts', 'shell/agency/accent.ts', 'shell/agency/AgencyLookPanel.tsx', 'shell/agency/look.css', 'shell/nui/modes.css', 'shell/home/Home.tsx', 'shell/home/TheO.tsx', 'shell/home/doorTargets.ts']) {
    assert.ok(!existsSync(join(src, gone)), `${gone} is gone`)
  }
  const menus = readFileSync(join(src, 'components/barMenus.ts'), 'utf8')
  assert.doesNotMatch(menus, /Agency look|onLook/)
  assert.match(menus, /label: 'View as'/)
})

test('the focus ring is var(--accent) again', () => {
  const css = readFileSync(join(src, 'index.css'), 'utf8')
  assert.match(css, /\[tabindex\]:focus-visible \{ outline: 3px solid var\(--accent\); outline-offset: 2px; \}/)
})
