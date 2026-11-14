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

import {
  AGENCY_COLOURS, CHROME_INK, NEUTRAL, agencyCss, agencyIdOf, applyAgency, basicLook, canonicalAgencyId, coloursOf, contrast, logoFill, lookChecks,
  paletteOf, pillOf, registerAgencyLooks, surfaceCss, surfaceTokens, type AgencyColours,
} from '../src/shell/agency/palette.ts'
import { recolourSvg } from '../src/shell/agency/svgSanitise.ts'

test('every agency in the registry reads: lookChecks passes it, text at 4.5:1 and logos at 3:1, light and dark', () => {
  for (const [id, colours] of Object.entries(AGENCY_COLOURS)) {
    const checks = lookChecks(colours, true)
    for (const k of checks) {
      assert.ok(k.ratio >= k.need, `${id}: ${k.label}, ${k.fg} on ${k.bg} is ${k.ratio.toFixed(2)}, needs ${k.need}`)
      assert.equal(k.ratio, contrast(k.bg, k.fg))
    }
    const by = Object.fromEntries(checks.map(k => [k.label, k]))
    const p = paletteOf(colours)
    for (const theme of ['light', 'dark'] as const) {
      // the --agency tokens: their ink on their colour is "Ink on the accent", in both themes
      const t = p[theme]
      assert.deepEqual([by['Ink on the accent'].bg, by['Ink on the accent'].fg], [t.agency, t.fg], `${id} ${theme}: ${t.fg} on ${t.agency}`)
      // the wash sits under the chrome's own ink (hover, selected rows)
      const wash = by[`Ink on the wash, ${theme}`]
      assert.deepEqual([wash.bg, wash.fg, wash.need], [t.soft, CHROME_INK[theme], 4.5], `${id} ${theme}: ink on the soft wash`)
    }
  }
})

test('lookChecks: the editor\'s six rows, and a look that does not read is flagged', () => {
  // a basic agency with a wordmark: the mock's six rows, in its order
  const wm = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="#1f4e3d" cx="5" cy="5" r="5"/></svg>'
  const kestrel = basicLook({ name: 'Kestrel Lane', base: '#1F4E3D', accent: '#F2C14E', logo: wm })!
  const rows = lookChecks(kestrel)
  assert.deepEqual(rows.map(r => r.label), [
    'Text on the pill', 'Text on the base (buttons, light)', 'Text on the accent (buttons, dark)',
    'Logo on the pill', 'Logo on a light ground (sign-in card)', 'Logo on a dark ground (recoloured white)',
  ])
  assert.ok(rows.every(r => r.ratio >= r.need), 'Kestrel reads')
  assert.deepEqual(rows.map(r => r.need), [4.5, 4.5, 4.5, 3, 3, 3])
  assert.deepEqual([rows[5].bg, rows[5].fg], [surfaceTokens(kestrel, 'dark')['--card'], '#FFFFFF'])
  assert.match(rows[5].bg, /^#[0-9A-F]{6}$/, 'the warm dark card, mixed to a colour')
  // a sage accent puts the dark wordmark on a mid-green pill: the mock's warning, 2.9:1
  const sage = lookChecks(basicLook({ name: 'Kestrel Lane', base: '#1F4E3D', accent: '#5A9A78', logo: wm })!)
  const bad = sage.filter(r => r.ratio < r.need)
  assert.deepEqual(bad.map(r => r.label), ['Logo on the pill'])
  assert.equal(bad[0].ratio.toFixed(1), '2.9')
  // no wordmark: the three text rows only
  assert.equal(lookChecks(AGENCY_COLOURS.wk).length, 3)
  // Pluto with white ink on its lime does not read
  const white: AgencyColours = { ...AGENCY_COLOURS.pluto, accentInk: '#FFFFFF' }
  assert.ok(lookChecks(white).some(r => r.label === 'Text on the pill' && r.ratio < 4.5))
  assert.equal(logoFill('data:image/svg+xml,' + encodeURIComponent('<svg><path fill="#abc"/></svg>')), '#AABBCC')
  assert.equal(logoFill('data:image/png;base64,AAAA'), null)
})

test('a basic agency\'s look: two colours and one wordmark, recoloured white for dark grounds', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect fill="#0e3b5c" x="0" y="0" width="10" height="10"/></svg>'
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg)
  registerAgencyLooks([{ id: 'saltmarsh', name: 'Saltmarsh', base: '#0e3b5c', accent: '#9ad1e8', aliases: ['salt marsh'], logo: uri, rev: 3 }])
  const c = coloursOf('saltmarsh')!
  assert.deepEqual({ ...c }, { name: 'Saltmarsh', base: '#0E3B5C', accent: '#9AD1E8', logo: uri, logoOnDark: 'data:image/svg+xml,' + encodeURIComponent(recolourSvg(svg, '#FFFFFF')) })
  assert.equal(canonicalAgencyId('salt marsh'), 'saltmarsh')
  // base64 data: URIs read the same; a logo that is not an SVG, or does not survive the sanitiser, is dropped
  registerAgencyLooks([
    { id: 'b64', name: 'B64', base: '#000000', accent: '#FFFFFF', logo: 'data:image/svg+xml;base64,' + btoa(svg) },
    { id: 'png', name: 'Png', base: '#000000', accent: '#FFFFFF', logo: 'data:image/png;base64,AAAA' },
    { id: 'empty', name: 'Empty', base: '#000000', accent: '#FFFFFF', logo: 'data:image/svg+xml,' + encodeURIComponent('<svg viewBox="0 0 1 1"><script>x</script></svg>') },
  ])
  assert.equal(coloursOf('b64')!.logo, uri)
  assert.equal(coloursOf('png')!.logo, undefined)
  assert.equal(coloursOf('empty')!.logo, undefined)
  registerAgencyLooks([])
  assert.equal(coloursOf('saltmarsh'), null)
})

test('an agency in code takes only its published display name; its look stays the code\'s', () => {
  const code = AGENCY_COLOURS.boysandgirls
  registerAgencyLooks([{ id: 'boysandgirls', name: 'Boys+Girls Dublin', base: '#FF0066', accent: '#00FF00', aliases: ['bgd'], logo: 'data:image/svg+xml,x', rev: 2 }])
  const c = coloursOf('bg')!
  assert.equal(c.name, 'Boys+Girls Dublin')
  assert.deepEqual({ ...c, name: code.name }, { ...code }, 'every other field is the code\'s')
  assert.equal(canonicalAgencyId('bgd'), null, 'spellings of a code agency stay in code')
  assert.equal(AGENCY_COLOURS.boysandgirls.name, 'Boys+Girls', 'AGENCY_COLOURS is never changed')
  // its code name again, or none: the code entry itself
  registerAgencyLooks([{ id: 'boysandgirls', name: 'Boys+Girls' }])
  assert.equal(coloursOf('boysandgirls'), code)
  registerAgencyLooks([])
  assert.equal(coloursOf('boysandgirls'), code)
  assert.equal(pillOf(code).bg, '#000000')
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

test('registerAgencyLooks takes a basic look\'s style (features/agency-style.clan); absent or default is today\'s look', () => {
  registerAgencyLooks([
    { id: 'greenline', name: 'Greenline', base: '#000000', accent: '#86bc25', pill: 'base', accent_use: 'line', surface: 'mono', accent_ink: null },
    { id: 'marlow', name: 'Marlow Bay', base: '#0B1F4D', accent: '#A8E04A', accent_ink: '#0b1f4d' },
    { id: 'plain', name: 'Plain', base: '#0B1F4D', accent: '#A8E04A' },
    { id: 'spelled', name: 'Spelled', base: '#0B1F4D', accent: '#A8E04A', pill: 'accent', accent_use: 'fill', surface: 'warm' },
    { id: 'junk', name: 'Junk', base: '#0B1F4D', accent: '#A8E04A', pill: 'round' as never, accent_ink: 'navy' },
  ])
  const g = coloursOf('greenline')!
  assert.deepEqual([g.pill, g.accentUse, g.surface, g.accentInk], ['base', 'line', 'mono', undefined])
  // the shell draws it as ACNE's code look does: same pill, same surfaces
  assert.equal(surfaceCss(g), surfaceCss({ ...AGENCY_COLOURS.acne, name: 'Greenline' }))
  assert.equal(coloursOf('marlow')!.accentInk, '#0B1F4D')
  assert.equal(paletteOf(coloursOf('marlow')).light.fg, '#0B1F4D')
  for (const id of ['plain', 'spelled', 'junk']) {
    const c = coloursOf(id)!
    assert.deepEqual(Object.keys(c).sort(), ['accent', 'base', 'name'], `${id}: no style fields`)
    assert.equal(surfaceCss(c), surfaceCss({ name: c.name, base: c.base, accent: c.accent }))
  }
  // the outline-only look's checks: buttons named for the base, the needs badge and the outline
  assert.deepEqual(lookChecks(g).map(r => r.label), [
    'Text on the pill', 'Text on the base (buttons, light)', 'Text on the base (buttons, dark)',
    'Text on the accent (needs badge)', 'Accent outline on the base (pill, buttons)',
  ])
  assert.equal(lookChecks(g).filter(r => r.line).length, 1)
  registerAgencyLooks([])
})
