// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Boys+Girls, Catapult and Pluto (owner, 2026-11-11): three agency looks with
// their logos. Each look is complete and reads, the other spellings map, the
// logos pick the copy for their ground, no script survives the sanitiser, and
// the sign-in card switches to each.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AGENCY_ALIASES, AGENCY_COLOURS, accentInkOf, agencyOfSignInName, canonicalAgencyId, coloursOf, contrast, groundOf, iconOf,
  markOf, paletteOf, pillLogoOf, pillOf, surfaceCss, wordmarkOf,
} from '../src/shell/agency/palette.ts'
import { ICON_PNG, ICON_SVG, WORDMARK_SVG } from '../src/shell/agency/logos.ts'
import { recolourSvg, sanitiseSvg } from '../src/shell/agency/svgSanitise.ts'
import { signInLookOf } from '../src/shell/agency/signInLook.ts'
import { bootLooks } from '../src/brand/bootLook.ts'
import { AgencyPill } from '../src/components/Toolbar.tsx'
import { logosModule, stripPng } from '../scripts/agency-logos.mjs'

const NEW = { boysandgirls: 'Boys+Girls', catapult: 'Catapult', pluto: 'Pluto' } as const
const IDS = Object.keys(NEW) as (keyof typeof NEW)[]
const LOGOS = 'src/shell/agency/logos'

/** A theme's block of the surface layer, as token: value. */
function tokens(css: string, theme: 'light' | 'dark'): Record<string, string> {
  const block = css.split('\n')[theme === 'light' ? 0 : 1]
  return Object.fromEntries([...block.matchAll(/(--[\w-]+): ([^;]+);/g)].map(m => [m[1], m[2]]))
}

test('the three looks are in the registry with the owner\'s names and colours', () => {
  for (const id of IDS) assert.equal(AGENCY_COLOURS[id]?.name, NEW[id])
  const pick = (id: keyof typeof NEW) => { const c = AGENCY_COLOURS[id]; return [c.base, c.accent] }
  assert.deepEqual(pick('boysandgirls'), ['#000000', '#FFFFFF'])
  assert.deepEqual(pick('catapult'), ['#000000', '#C61566'])
  assert.deepEqual(pick('pluto'), ['#000047', '#B2F257'])
})

test('each look is complete and reads: tokens, action colour, desk tint and mark, light and dark', () => {
  for (const id of IDS) {
    const c = AGENCY_COLOURS[id]
    const p = paletteOf(c)
    for (const theme of ['light', 'dark'] as const) {
      for (const k of ['agency', 'fg', 'soft'] as const) assert.match(p[theme][k], /^#[0-9A-F]{6}$/, `${id} ${theme} ${k}`)
      assert.ok(contrast(p[theme].agency, p[theme].fg) >= 4.5, `${id} ${theme}: text on the accent`)
    }
    assert.ok(contrast(c.accent, accentInkOf(c)) >= 4.5, `${id}: ink on the accent`)
    const css = surfaceCss(c)
    for (const theme of ['light', 'dark'] as const) {
      const t = tokens(css, theme)
      assert.ok(contrast(t['--ag-act'], t['--ag-act-ink']) >= 4.5, `${id} ${theme}: ${t['--ag-act-ink']} on the action colour ${t['--ag-act']}`)
      assert.ok(contrast(t['--ag-acc'], t['--ag-acc-ink']) >= 4.5, `${id} ${theme}: ink on the accent`)
      if (t['--needs']) assert.ok(contrast(t['--needs'], t['--needs-ink']) >= 4.5, `${id} ${theme}: the needs count`)
    }
    const pill = pillOf(c)
    assert.ok(contrast(pill.bg, pill.ink) >= 4.5, `${id}: ink on the pill`)
    for (const tok of ['--ag-act', '--ag-act-ink', '--desk', '--paper', '--line', '--ag-base', '--ag-acc'])
      assert.equal(css.split(`${tok}:`).length - 1, 2, `${id}: ${tok} in both themes`)
    if (c.surface === 'mono') assert.match(css, /--desk: #F5F5F4;[\s\S]*--desk: #000000;/, `${id}: neutral desks`)
    else assert.match(css, new RegExp(`--desk: color-mix\\(in srgb, ${c.base}`), `${id}: the desk takes its base`)
    assert.deepEqual(markOf(`x@${id}`), { base: c.base, accent: c.accent })
  }
})

test('each look as the owner\'s references draw it', () => {
  const bg = (t: 'light' | 'dark') => tokens(surfaceCss(AGENCY_COLOURS.boysandgirls), t)
  // Boys+Girls: black and white only; black buttons in light, white with black text in dark; near-white and black desks
  assert.equal(bg('light')['--ag-act'], '#000000'); assert.equal(bg('light')['--ag-act-ink'], '#FFFFFF')
  assert.equal(bg('dark')['--ag-act'], '#FFFFFF'); assert.equal(bg('dark')['--ag-act-ink'], '#141413')
  assert.equal(bg('light')['--desk'], '#F5F5F4'); assert.equal(bg('dark')['--desk'], '#000000')
  assert.deepEqual(pillOf(AGENCY_COLOURS.boysandgirls), { bg: '#000000', ink: '#FFFFFF', line: '#FFFFFF' })
  // Catapult: crimson never a big fill: actions stay black with a crimson hairline; crimson is the needs colour
  for (const t of ['light', 'dark'] as const) {
    const k = tokens(surfaceCss(AGENCY_COLOURS.catapult), t)
    assert.equal(k['--ag-act'], '#000000', t)
    assert.equal(k['--ag-act-line'], '#C61566', t)
    assert.equal(k['--needs'], '#C61566', t)
    assert.equal(k['--needs-ink'], '#FFFFFF', t)
  }
  assert.deepEqual(pillOf(AGENCY_COLOURS.catapult), { bg: '#000000', ink: '#FFFFFF', line: '#C61566' })
  // Pluto: text on lime is navy, never white: the pill, the --agency tokens, and the dark action
  assert.equal(paletteOf(AGENCY_COLOURS.pluto).light.fg, '#000047')
  assert.equal(paletteOf(AGENCY_COLOURS.pluto).dark.fg, '#000047')
  assert.deepEqual(pillOf(AGENCY_COLOURS.pluto), { bg: '#B2F257', ink: '#000047', line: null })
  assert.equal(tokens(surfaceCss(AGENCY_COLOURS.pluto), 'dark')['--ag-act-ink'], '#000047')
  assert.equal(tokens(surfaceCss(AGENCY_COLOURS.pluto), 'light')['--ag-act'], '#000047')
  // the agencies before them write none of the new tokens: their looks are as they were
  for (const id of ['wk', 'tbwa', 'ogilvy', 'harbour', 'droga', 'napkin'])
    assert.doesNotMatch(surfaceCss(AGENCY_COLOURS[id]), /--ag-pill|--ag-act-line|--needs/, id)
})

test('the boot screen picks the three up from the registry', () => {
  const looks = bootLooks()
  for (const id of IDS) {
    assert.ok(looks.a[id], `${id} in the boot map`)
    assert.ok(looks.a[id].s.includes(AGENCY_COLOURS[id].base), `${id}: its surface`)
  }
})

test('the other spellings map to Boys+Girls, for the look, the colours and the sign-in card', () => {
  for (const alias of ['bg', 'boysgirls', 'b+g', 'BG', 'B+G']) {
    assert.equal(canonicalAgencyId(alias), 'boysandgirls', alias)
    assert.equal(coloursOf(alias.toLowerCase()), AGENCY_COLOURS.boysandgirls, alias)
    assert.equal(agencyOfSignInName(`x@${alias}`), 'boysandgirls', alias)
  }
  for (const target of Object.values(AGENCY_ALIASES)) assert.ok(AGENCY_COLOURS[target], `${target} is a registry id`)
  assert.equal(canonicalAgencyId('boys'), null)
  assert.equal(canonicalAgencyId(null), null)
})

test('the logos pick the copy for their ground', () => {
  const svgOf = (uri: string | null) => decodeURIComponent(String(uri).replace(/^data:image\/svg\+xml,/, ''))
  for (const id of IDS) {
    const c = AGENCY_COLOURS[id]
    const light = svgOf(wordmarkOf(c, 'light')), dark = svgOf(wordmarkOf(c, 'dark'))
    // a light ground's copy is dark ink, a dark ground's is white: each reads on its own ground
    const fills = (s: string) => [...new Set([...s.matchAll(/fill="(#[0-9a-f]{6})"/g)].map(m => m[1]))]
    for (const f of fills(light)) assert.ok(contrast(f, '#FFFDF8') >= 4.5, `${id} on light: ${f}`)
    for (const f of fills(dark)) assert.ok(contrast(f, '#1B1A18') >= 4.5, `${id} on dark: ${f}`)
    assert.equal(fills(light).length, 1)
    assert.equal(fills(dark).length, 1)
  }
  // B+G's own wordmark is white: it is the dark copy as sent, and the light copy is the same shapes in black
  assert.equal(wordmarkOf(AGENCY_COLOURS.boysandgirls, 'dark'), 'data:image/svg+xml,' + encodeURIComponent(WORDMARK_SVG.boysandgirls))
  assert.equal(wordmarkOf(AGENCY_COLOURS.boysandgirls, 'light'), 'data:image/svg+xml,' + encodeURIComponent(recolourSvg(WORDMARK_SVG.boysandgirls, '#000000')))
  assert.equal(wordmarkOf(AGENCY_COLOURS.pluto, 'light'), 'data:image/svg+xml,' + encodeURIComponent(WORDMARK_SVG.pluto), 'Pluto keeps its navy on light')
  // the square mark: B+G's icon, Catapult's ring C; Pluto keeps initials
  assert.equal(iconOf(AGENCY_COLOURS.boysandgirls), 'data:image/png;base64,' + ICON_PNG.boysandgirls)
  assert.equal(iconOf(AGENCY_COLOURS.catapult), 'data:image/svg+xml,' + encodeURIComponent(ICON_SVG.catapult))
  assert.equal(iconOf(AGENCY_COLOURS.pluto), null)
  // the pill: B+G and Catapult on black take the white wordmark; Pluto on lime takes the navy one
  const pillGround = { boysandgirls: 'dark', catapult: 'dark', pluto: 'light' } as const
  for (const id of IDS) {
    assert.equal(groundOf(pillOf(AGENCY_COLOURS[id]).bg), pillGround[id], id)
    assert.equal(pillLogoOf(AGENCY_COLOURS[id]).wordmark, wordmarkOf(AGENCY_COLOURS[id], pillGround[id]), id)
  }
  // agencies without logos keep their names and initials
  assert.deepEqual(pillLogoOf(AGENCY_COLOURS.wk), { wordmark: null, icon: null })
  assert.deepEqual(pillLogoOf(null), { wordmark: null, icon: null })
})

test('the pill shows the wordmark in place of the name, and the name where there is none', () => {
  const pill = (agency: string, id: string) => renderToStaticMarkup(createElement(AgencyPill, { agency, logo: pillLogoOf(coloursOf(id)), onDesk: () => {} }))
  const bg = pill('Boys+Girls', 'boysandgirls')
  assert.match(bg, /data-testid="agency-wordmark"/)
  assert.match(bg, /<img class="sl-wordmark" src="data:image\/svg\+xml,[^"]+" alt="Boys\+Girls"/)
  assert.match(bg, /class="sl-icon" src="data:image\/png;base64,/)
  assert.doesNotMatch(pill('Pluto', 'pluto'), /sl-icon/, 'no icon, no narrow-bar swap')
  const wk = pill('Wieden+Kennedy', 'wk')
  assert.doesNotMatch(wk, /<img/)
  assert.match(wk, /<span class="sl-big">Wieden\+Kennedy<\/span>/)
})

// Owner, 2026-11-11: "I told you to put just Napkin Studio there, not Napkin twice".
test('Napkin’s own pill says Napkin Studio once; every other agency keeps its name over Napkin Studio', () => {
  const pill = (agency: string, id: string) => renderToStaticMarkup(createElement(AgencyPill, { agency, logo: pillLogoOf(coloursOf(id)), onDesk: () => {} }))
  const own = pill('Napkin', 'napkin')
  assert.match(own, /<span class="sl-big">Napkin Studio<\/span>/)
  assert.doesNotMatch(own, /sl-mono/)
  const lockup = own.slice(own.indexOf('id="header-lockup"'))
  assert.equal((lockup.match(/Napkin/g) || []).length, 1, 'Napkin appears once on the pill')
  assert.match(pill('Wieden+Kennedy', 'wk'), /<span class="sl-mono">.*Napkin Studio<\/span>/)
})

test('no script, style, link or handler survives the sanitiser', () => {
  const hostile = `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
    <script>alert(1)</script><script xlink:href="https://evil.example/x.js"/>
    <style>path{fill:url(https://evil.example)}</style><!-- note -->
    <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(1)"/></body></foreignObject>
    <a href="javascript:alert(1)"><path d="M0 0H5V5Z"/></a>
    <use href="#x"/><image href="https://evil.example/i.png"/>
    <g fill="#123456" style="x" onclick="alert(1)"><path id="v" onmouseover="alert(1)" style="fill:red" d="M0 0L10 10Z javascript:alert(1)"/><path d="M1.23456 2.5e-1L3 4Z"/></g>
    <rect x="1" y="1" width="2" height="2" fill="url(#g)"/></svg>`
  const out = sanitiseSvg(hostile)
  for (const bad of [/script/i, /style/i, /href/i, /on\w+=/i, /javascript/i, /foreignObject/i, /<a\b/, /<use\b/, /<image\b/, /evil/, /url\(/, /\bid=/, /<!--/, /<\?xml/])
    assert.doesNotMatch(out, bad, String(bad))
  assert.equal(out, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path fill="#123456" d="M1.23 0.25L3 4Z"/><rect fill="#000000" x="1" y="1" width="2" height="2"/></svg>')
  assert.throws(() => sanitiseSvg('<svg><script>alert(1)</script></svg>'), /viewBox/)
})

test('the committed logos are sanitised, small, and logos.ts is written from them', () => {
  const files = readdirSync(LOGOS).sort()
  assert.deepEqual(files, ['boysandgirls-icon.png', 'boysandgirls-logo.svg', 'catapult-icon.svg', 'catapult-logo.svg', 'pluto-logo.svg'])
  for (const f of files) {
    const buf = readFileSync(`${LOGOS}/${f}`)
    assert.ok(buf.length < 6000, `${f} is small (${buf.length} bytes)`)
    if (f.endsWith('.svg')) {
      const svg = buf.toString('utf8').trim()
      assert.equal(sanitiseSvg(svg), svg, `${f} is already sanitised`)
      assert.doesNotMatch(svg, /script|style|href|on\w+=|<(?!\/?(svg|path|circle|rect)\b)/i, f)
    } else {
      assert.ok(buf.equals(stripPng(buf)), `${f} carries only its image chunks`)
    }
  }
  const generated = logosModule({ list: () => files, text: (f: string) => readFileSync(`${LOGOS}/${f}`, 'utf8'), bytes: (f: string) => readFileSync(`${LOGOS}/${f}`) })
  assert.equal(readFileSync('src/shell/agency/logos.ts', 'utf8'), generated, 'run node scripts/agency-logos.mjs')
})

test('the sign-in card switches to each look as its name or email is typed', () => {
  for (const id of IDS) {
    for (const typed of [`x@${id}`, `x@${id}.ie`, `first.last@${id}.ie`, ` X@${id.toUpperCase()} `]) {
      const look = signInLookOf(typed)
      assert.equal(look.id, id, typed)
      assert.equal(look.lede, `Sign in to ${NEW[id]} on Napkin Studio.`, typed)
      assert.deepEqual(look.mark, { base: AGENCY_COLOURS[id].base, accent: AGENCY_COLOURS[id].accent })
      assert.equal(look.wordmark.light, wordmarkOf(AGENCY_COLOURS[id], 'light'))
      assert.equal(look.wordmark.dark, wordmarkOf(AGENCY_COLOURS[id], 'dark'))
    }
  }
  assert.equal(signInLookOf('x@b+g').id, 'boysandgirls')
  assert.equal(signInLookOf('x@bg.ie').id, 'boysandgirls')
  // an agency without logos shows no wordmark; nor does Napkin's own look
  assert.deepEqual(signInLookOf('x@wk').wordmark, { light: null, dark: null })
  assert.deepEqual(signInLookOf('').wordmark, { light: null, dark: null })
})
