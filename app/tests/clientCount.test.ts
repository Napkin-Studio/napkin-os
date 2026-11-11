// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The count beside a tool's name on a client's page (`.cp-h small`, "4" next to Brief) is text, so it
// reads at 4.5 to 1 on the papers in White, Grey and Black. --faint did not on a tinted white paper
// (#736859 on #ece8e8 measured 4.48 to 1, which axe reports as color-contrast); the count uses --muted.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { MODE_SURFACES } from '../src/shell/agency/accent.ts'
import { contrast } from '../src/shell/agency/palette.ts'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

/** The value a custom property is given inside the rule whose selector contains `selector`. */
function token(css: string, selector: string, name: string): string {
  const at = css.indexOf(selector)
  assert.ok(at >= 0, `${selector} is in the stylesheet`)
  const body = css.slice(css.indexOf('{', at), css.indexOf('}', at))
  const m = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  assert.ok(m, `${name} is set in ${selector}`)
  return m[1]
}

const tokens = read('src/shell/nui/tokens.css')
const modes = read('src/shell/nui/modes.css')
const muted = {
  white: token(tokens, ':root,\n:root[data-theme=\'light\'] {', '--muted'),
  grey: token(modes, ':root[data-theme=\'light\'][data-mode=\'grey\']', '--muted'),
  black: token(tokens, ':root[data-theme=\'dark\'] {', '--muted'),
}
// Papers a count can sit on: the three of the mode, and the tinted white paper axe measured it on.
const sit: Record<keyof typeof muted, string[]> = {
  white: [...MODE_SURFACES.white, '#ece8e8'],
  grey: [...MODE_SURFACES.grey],
  black: [...MODE_SURFACES.black],
}

test('the stylesheet colours the count with --muted, not --faint', () => {
  const rule = read('src/shell/nui/nui.css').split('\n').find(l => l.includes('.cp-h:where(.nui, .nui *) small'))
  assert.ok(rule, 'the count rule exists')
  assert.match(rule, /color: var\(--muted\)/)
})

for (const mode of ['white', 'grey', 'black'] as const) {
  test(`the count reads at 4.5 to 1 on every paper in ${mode}`, () => {
    for (const paper of sit[mode]) {
      assert.ok(contrast(muted[mode], paper) >= 4.5, `${muted[mode]} on ${paper} in ${mode}: ${contrast(muted[mode], paper).toFixed(2)}`)
    }
  })
}
