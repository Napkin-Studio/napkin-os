// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's accent, sampled from its logo (features/agency-look.clan):
// the colour is found among the pixels, black, white and grey are ignored,
// its lightness is set per mode until text in it reads (4.5 to 1) on all three
// papers, the three papers match modes.css, and the accent appears only where
// the allow list says it may.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { accentCss, accentFor, accentsOf, MODE_SURFACES, sampleAccent } from '../src/shell/agency/accent.ts'
import { contrast } from '../src/shell/agency/palette.ts'
import { MODES, nextMode, schemeOf } from '../src/theme.ts'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

/** RGBA pixels of a 64 by 64 logo: a disc in `disc` on `ground` (null: see-through). */
function logo(disc: string, ground: string | null): Uint8ClampedArray {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const px = new Uint8ClampedArray(64 * 64 * 4)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const o = (y * 64 + x) * 4
    const inside = (x - 32) ** 2 + (y - 32) ** 2 <= 28 ** 2
    const c = inside ? rgb(disc) : ground ? rgb(ground) : null
    if (c) px.set([...c, 255], o)
  }
  return px
}

// The five hues of the pilot's fixtures (e2e/j001-pilot.spec.ts), and the colours that are hard: pale, dark, yellow.
const FIVE = ['#d6402f', '#2f6fd6', '#2fa36b', '#8a3fd1', '#d19a1f']
const HARD = ['#FFD400', '#B2F257', '#000047', '#C61566', '#9FE6D8', '#FFD6DD', '#1E22AA']

test('the strongest colour is found in each of five logos', () => {
  for (const c of FIVE) {
    const got = sampleAccent(logo(c, null))
    assert.ok(got, `${c} gives an accent`)
    const d = [1, 3, 5].map(i => Math.abs(parseInt(got.slice(i, i + 2), 16) - parseInt(c.slice(i, i + 2), 16)))
    assert.ok(Math.max(...d) <= 2, `${c} sampled as ${got}`)
  }
})

test('black, white and grey give no accent', () => {
  assert.equal(sampleAccent(logo('#000000', '#ffffff')), null, 'the black and white logo')
  assert.equal(sampleAccent(logo('#808080', '#ffffff')), null, 'grey on white')
  assert.equal(sampleAccent(logo('#222222', null)), null, 'near-black on nothing')
  assert.equal(sampleAccent(new Uint8ClampedArray(0)), null, 'no pixels')
})

test('a colour on a black and white ground is still found, and the ground is ignored', () => {
  assert.equal(sampleAccent(logo('#2f6fd6', '#ffffff')), '#2f6fd6')
  assert.equal(sampleAccent(logo('#2f6fd6', '#000000')), '#2f6fd6')
})

test('see-through pixels are ignored, and the larger colour wins over a small one', () => {
  const px = logo('#2f6fd6', null)
  px.set([255, 0, 0, 0], 0) // a see-through red corner
  assert.equal(sampleAccent(px), '#2f6fd6')
  const two = logo('#2f6fd6', '#d6402f') // a blue disc on a red ground: the disc covers more of the logo
  assert.equal(sampleAccent(two), '#2f6fd6')
  assert.equal(sampleAccent(logo('#d6402f', '#2f6fd6')), '#d6402f')
})

test('accent text reads at 4.5 to 1 on every paper of all three modes, for every colour', () => {
  for (const c of [...FIVE, ...HARD]) {
    const a = accentsOf(c)
    for (const mode of MODES) {
      for (const paper of MODE_SURFACES[mode]) {
        assert.ok(contrast(a[mode], paper) >= 4.5, `${c} in ${mode} on ${paper}: ${a[mode]} is ${contrast(a[mode], paper).toFixed(2)}`)
      }
    }
  }
})

test('only the lightness moves: a colour that already reads is kept, and the hue stays', () => {
  const dark = accentFor('#1E22AA', 'white')
  assert.equal(dark, '#1E22AA'.toLowerCase(), 'a deep blue reads on white as it is')
  const lifted = accentFor('#1E22AA', 'black')
  assert.notEqual(lifted.toLowerCase(), '#1e22aa')
  const [r, g, b] = [1, 3, 5].map(i => parseInt(lifted.slice(i, i + 2), 16))
  assert.ok(b > r && b > g, `still blue: ${lifted}`)
  const yellow = accentFor('#FFD400', 'white')
  const [yr, yg, yb] = [1, 3, 5].map(i => parseInt(yellow.slice(i, i + 2), 16))
  assert.ok(yr >= yg && yg > yb, `yellow darkened to an olive, not another hue: ${yellow}`)
})

test('the papers the accent is checked on are the papers modes.css and the shell draw', () => {
  const grey = read('src/shell/nui/modes.css')
  const take = (css: string, name: string) => new RegExp(`${name}: (#[0-9A-Fa-f]{6});`).exec(css)?.[1].toUpperCase()
  for (const [i, tok] of ['--desk', '--paper', '--card'].entries()) assert.equal(take(grey, tok), MODE_SURFACES.grey[i], `grey ${tok}`)
  const tokens = read('src/shell/nui/tokens.css')
  const dark = tokens.slice(tokens.indexOf("[data-theme='dark']"))
  const light = tokens.slice(0, tokens.indexOf("[data-theme='dark']"))
  for (const [i, tok] of ['--desk', '--paper', '--card'].entries()) {
    assert.equal(take(light, tok), MODE_SURFACES.white[i], `white ${tok}`)
    assert.equal(take(dark, tok), MODE_SURFACES.black[i], `black ${tok}`)
  }
})

test('the accent is one token per mode, and none when there is none', () => {
  assert.equal(accentCss(null), '')
  const css = accentCss({ white: '#111111', grey: '#222222', black: '#eeeeee' })
  assert.match(css, /\[data-mode='white'\] \{ --agency-accent: #111111; \}/)
  assert.match(css, /\[data-mode='grey'\] \{ --agency-accent: #222222; \}/)
  assert.match(css, /\[data-mode='black'\] \{ --agency-accent: #eeeeee; \}/)
})

test('the three modes go round, and White and Grey are light, Black dark', () => {
  assert.deepEqual(MODES.map(m => nextMode(m)), ['grey', 'black', 'white'])
  assert.deepEqual(MODES.map(schemeOf), ['light', 'light', 'dark'])
})

// The accent appears only for focus, the selected item, where you are, and counts.
// Each use of the token in the shell's CSS is on this list, with the reason; a new
// use fails here until it is added with a reason that is one of the four.
const ALLOWED: { file: string; selector: string; use: 'focus' | 'selected' | 'where you are' | 'counts' }[] = [
  { file: 'src/index.css', selector: 'button:focus-visible,\n[tabindex]:focus-visible', use: 'focus' },
  { file: 'src/shell/landing/landing.css', selector: ".lc-crumb[aria-current='page']", use: 'where you are' },
  { file: 'src/shell/landing/landing.css', selector: '.lc-crumb:focus-visible', use: 'focus' },
  { file: 'src/components/chrome.css', selector: ".ch-seg button[aria-selected='true']", use: 'selected' },
  { file: 'src/shell/agency/look.css', selector: '.al-file:focus-within', use: 'focus' },
]

function css(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? css(p) : p.endsWith('.css') ? [p] : []
  })
}

test('every use of the accent token in the shell\'s CSS is on the allow list', () => {
  const base = new URL('src/', root).pathname
  const found: { file: string; selector: string }[] = []
  for (const f of css(base)) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*var\(--agency-accent[^{}]*)\}/g)) {
      found.push({ file: f.slice(base.length - 4), selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim() })
    }
    assert.ok(!/--agency-accent\s*:/.test(text), `${f} sets the token: only accent.ts does`)
  }
  assert.ok(found.length > 0, 'the lint found the uses')
  for (const u of found) {
    assert.ok(ALLOWED.some(a => a.file === u.file && a.selector === u.selector), `not on the allow list: ${u.file}: ${u.selector}`)
  }
  for (const a of ALLOWED) {
    assert.ok(found.some(u => u.file === a.file && u.selector === a.selector), `on the list but not used: ${a.file}: ${a.selector}`)
  }
})
