// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Deep O is the studio's only mark, drawn by one engine (brand/DeepOMark.tsx)
// from one geometry (brand/deepOSvg.ts): the bar, sign-in, every loading sign,
// the boot splash, the favicon, the app icons and the home CLAN app.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DeepOMark } from '../src/brand/DeepOMark.tsx'
import { LogoSpinner, LogoSpinnerFill, LogoSpinnerVeil } from '../src/brand/LogoSpinner.tsx'
import {
  DEEP_O_CSS, faviconSvg, homeAppRegions, INDETERMINATE_LEN, NAPKIN_MARK, rimFor, staticMarkSvg,
} from '../src/brand/deepOSvg.ts'
import { bootMarkHtml } from '../src/brand/bootLook.ts'
import { AGENCY_COLOURS, NEUTRAL_MARK } from '../src/shell/agency/palette.ts'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const wk = { base: AGENCY_COLOURS.wk.base, accent: AGENCY_COLOURS.wk.accent }

test('above 24 px the mark is the satin cut, at 24 px and below the grammar\'s small cut', () => {
  for (const size of [25, 54, 120]) {
    const html = renderToStaticMarkup(createElement(DeepOMark, { size, palette: wk }))
    assert.match(html, /data-cut="satin"/, `${size}px`)
    assert.match(html, /data-k="wave"/, 'the satin cut has its horizon')
  }
  for (const size of [16, 20, 24]) {
    const html = renderToStaticMarkup(createElement(DeepOMark, { size, palette: wk }))
    assert.match(html, /data-cut="small"/, `${size}px`)
    assert.doesNotMatch(html, /data-k="wave"/, 'the small cut has no horizon line (it read as a minus sign)')
  }
})

test('loading is working: an indeterminate arc when the length is unknown, the real share when it is known', () => {
  const unknown = renderToStaticMarkup(createElement(DeepOMark, { size: 54, state: 'working', palette: wk }))
  const circ = 2 * Math.PI * 44.2
  assert.match(unknown, new RegExp(`data-k="arc"[^>]*stroke-dasharray="${(INDETERMINATE_LEN * circ).toFixed(1)} `))
  assert.match(unknown, /data-state="working"/)
  const half = renderToStaticMarkup(createElement(DeepOMark, { size: 54, state: 'working', progress: 0.5, palette: wk }))
  assert.match(half, new RegExp(`data-k="arc"[^>]*stroke-dasharray="${(0.5 * circ).toFixed(1)} `))
  const tiny = renderToStaticMarkup(createElement(DeepOMark, { size: 16, state: 'working', palette: wk }))
  assert.match(tiny, /data-k="arc"[^>]*stroke-dasharray="0\.280 0\.720"/)
  assert.match(tiny, new RegExp(`stroke="${wk.accent}"`), 'the small cut\'s ring is the agency accent')
})

test('a mark that is not told its colours is neutral before any agency is known, never Napkin\'s blue', () => {
  const html = renderToStaticMarkup(createElement(DeepOMark, { size: 16 }))
  assert.match(html, new RegExp(`fill="${NEUTRAL_MARK.base}"`, 'i'))
  assert.doesNotMatch(html, new RegExp(NAPKIN_MARK.base, 'i'))
})

test('the loading signs keep their API and draw Deep O working', () => {
  for (const el of [createElement(LogoSpinner, { size: 'xs', label: 'Loading…' }), createElement(LogoSpinnerFill, { label: 'Opening the studio…' }), createElement(LogoSpinnerVeil, { label: 'Opening…' })]) {
    const html = renderToStaticMarkup(el)
    assert.match(html, /data-testid="deep-o-mark" data-state="working"/)
    assert.match(html, /role="status"/)
  }
  assert.match(renderToStaticMarkup(createElement(LogoSpinner, { size: 'xs' })), /data-cut="small"/)
  assert.match(renderToStaticMarkup(createElement(LogoSpinnerFill, { label: 'x' })), /data-cut="satin"/)
})

test('the small cut gets a contrast rim on a surface too close to it', () => {
  assert.equal(rimFor('#16181D', '#1B1A18'), '#E9EAEC', 'TBWA\'s near-black on dark paper')
  assert.equal(rimFor(NAPKIN_MARK.base, '#FFFFFF'), null)
})

test('the boot splash is put in at build from the same source, in the person\'s own look (bootLook.test.tsx)', () => {
  const html = read('index.html')
  assert.match(html, /<!-- deep-o:boot -->/)
  assert.match(read('vite.config.ts'), /bootMarkHtml\(\)/)
  const boot = bootMarkHtml()
  assert.match(boot, /class="deep-o-spin"/, 'the ring turns by CSS, with no script')
  assert.match(DEEP_O_CSS, /prefers-reduced-motion:reduce/)
})

test('the favicon and the home app are the written copies of the source (node scripts/deep-o-icons.mjs)', () => {
  assert.equal(read('public/favicon.svg'), faviconSvg() + '\n')
  const home = read('../crates/napkin-host/assets/home_app.html')
  assert.equal(home, homeAppRegions(home))
  assert.match(staticMarkSvg({ size: 120 }), /width="120"/)
})

test('nothing draws the old mark', () => {
  for (const p of ['index.html', 'public/favicon.svg', '../crates/napkin-host/assets/home_app.html']) {
    const s = read(p)
    assert.doesNotMatch(s, /rotate\(-45 11 11\)|napkin-spinner-mark|var\(--produce/, p)
  }
})
