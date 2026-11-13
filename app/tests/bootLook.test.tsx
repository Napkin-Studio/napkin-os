// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A reload goes from blank to the desk in the person's own look: the boot
// screen (brand/bootLook.ts) takes the last agency's desk and mark before any
// module runs, the shell's loading signs keep the same desk, palette and clock
// (brand/lateShow.ts), and nothing shows on a quick load but the background.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BOOT_CSS, BOOT_INK, bootHeadScript, bootLooks, bootMark, bootMarkHtml, bootSurfaceCss, markColours } from '../src/brand/bootLook.ts'
import { HANDOFF_MS, lateBegin, lateDelay, lateEnd, resetLateClock, SHOW_AFTER_MS, waitStart } from '../src/brand/lateShow.ts'
import { LogoSpinnerFill, LogoSpinnerVeil } from '../src/brand/LogoSpinner.tsx'
import { AGENCY_COLOURS, applyAgency, BOOT_SURFACE_ID, coloursOf, DESK_BASE, NAPKIN_COLOURS, NEUTRAL_MARK, registerAgencyLooks, surfaceCss } from '../src/shell/agency/palette.ts'
import { lastAgency, lastAgencyLook, rememberAgency } from '../src/shell/agency/lastAgency.ts'
import { useAgencyMark } from '../src/brand/useAgencyMark.ts'
import { AGENCY_LOOK_KEY, bootLookOf } from '../src/brand/bootLook.ts'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

test('the boot map is generated from the agency registry and matches it', () => {
  const looks = bootLooks()
  assert.deepEqual(Object.keys(looks.a).sort(), Object.keys(AGENCY_COLOURS).sort())
  for (const [id, c] of Object.entries(AGENCY_COLOURS)) {
    assert.equal(looks.a[id].s, surfaceCss(c).replace(/:root/g, ':root:root'), `${id}: the shell's own surface layer`)
    assert.deepEqual(looks.a[id].m, markColours({ base: c.base, accent: c.accent }), `${id}: its mark`)
    assert.ok(looks.a[id].m.includes(c.base) || looks.a[id].m.some(x => x.toUpperCase() === c.base.toUpperCase()), `${id}: its base is in the mark`)
  }
  assert.equal(looks.d.s, bootSurfaceCss(NAPKIN_COLOURS), 'an agency the registry does not colour gets what the shell will give it')
  // the head script carries exactly this map
  assert.ok(bootHeadScript().includes(JSON.stringify(looks)))
})

test('the page is written at build from the same source, with no hand copy', () => {
  const html = read('index.html')
  assert.match(html, /<!-- boot:look -->/)
  assert.match(html, /<!-- deep-o:boot -->/)
  assert.doesNotMatch(html.slice(html.indexOf('<title>')), /#[0-9A-Fa-f]{6}/, 'no colour in the boot screen by hand')
  const vite = read('vite.config.ts')
  assert.match(vite, /bootHeadScript\(\)/)
  assert.match(vite, /bootMarkHtml\(\)/)
  // the neutral desk and ink are tokens.css's
  const tokens = read('src/shell/nui/tokens.css')
  const block = (sel: string) => tokens.slice(tokens.indexOf(sel), tokens.indexOf('}', tokens.indexOf(sel)))
  const light = block(":root[data-theme='light'] {"), dark = block(":root[data-theme='dark'] {")
  assert.match(light, new RegExp(`--desk: ${DESK_BASE.light};`))
  assert.match(dark, new RegExp(`--desk: ${DESK_BASE.dark};`))
  assert.match(light, new RegExp(`--muted: ${BOOT_INK.light};`))
  assert.match(dark, new RegExp(`--muted: ${BOOT_INK.dark};`))
  assert.match(BOOT_CSS, /html,body\{background:var\(--desk\)\}/, 'html and body are on the desk from the first paint')
})

test('the boot mark and words show only on a slow load, and respect reduced motion', () => {
  assert.match(BOOT_CSS, new RegExp(`\\.napkin-boot>\\*\\{animation:napkin-late \\d+ms ease ${SHOW_AFTER_MS}ms both\\}`))
  assert.match(BOOT_CSS, /@keyframes napkin-late\{from\{opacity:0\}/)
  assert.match(BOOT_CSS, /prefers-reduced-motion:reduce\)\{\.napkin-boot>\*\{animation-duration:1ms/)
})

/** Run the head script against a stand-in page. */
function runHead(storage: Record<string, string> | 'throws', light = true) {
  const attrs: Record<string, string> = {}
  const appended: { id: string; textContent: string }[] = []
  const win: Record<string, unknown> = {}
  const localStorage = storage === 'throws'
    ? { getItem() { throw new Error('SecurityError') } }
    : { getItem: (k: string) => storage[k] ?? null }
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v }, style: {} as Record<string, string> },
    head: { appendChild: (el: { id: string; textContent: string }) => appended.push(el) },
    createElement: () => ({ id: '', textContent: '' }),
  }
  win.window = win
  Object.assign(win, { document, localStorage, matchMedia: () => ({ matches: light }) })
  runInNewContext(bootHeadScript(), win)
  return { attrs, appended, mark: win.__napkinBootMark as string[] | null, scheme: document.documentElement.style.colorScheme }
}

test('the head script: storage that throws, or holds nothing, gives the neutral look in the OS theme', () => {
  for (const storage of ['throws', {}] as const) {
    const light = runHead(storage, true)
    assert.equal(light.attrs['data-theme'], 'light')
    assert.equal(light.scheme, 'light')
    assert.deepEqual(light.appended, [], 'no agency layer: the neutral desk')
    assert.equal(light.mark, null, 'the neutral mark stays')
    assert.equal(runHead(storage, false).attrs['data-theme'], 'dark')
  }
  assert.equal(runHead({ 'napkin.lastAgency': '"><script>' }).mark, null, 'not an agency id: neutral')
})

test('the head script: the last agency and theme, before the first paint', () => {
  const tbwa = runHead({ 'napkin.lastAgency': 'TBWA', 'napkin.theme': 'dark' }, true)
  assert.equal(tbwa.attrs['data-theme'], 'dark', 'the stored theme wins over the OS')
  assert.equal(tbwa.appended.length, 1)
  assert.equal(tbwa.appended[0].id, BOOT_SURFACE_ID)
  assert.equal(tbwa.appended[0].textContent, bootSurfaceCss(AGENCY_COLOURS.tbwa))
  assert.deepEqual(Array.from(tbwa.mark ?? []), markColours({ base: AGENCY_COLOURS.tbwa.base, accent: AGENCY_COLOURS.tbwa.accent }))
  const other = runHead({ 'napkin.lastAgency': 'acme' })
  assert.equal(other.appended[0].textContent, bootSurfaceCss(NAPKIN_COLOURS), 'an uncoloured agency: Napkin\'s kit, as the shell gives it')
  assert.equal(runHead({ 'napkin.lastAgency': 'toString' }).appended[0].textContent, bootSurfaceCss(NAPKIN_COLOURS), 'never a prototype key')
})

test('the boot mark is neutral (never Napkin\'s blue) and recolours to the agency\'s exactly', () => {
  const html = bootMarkHtml()
  assert.ok(html.startsWith(bootMark(NEUTRAL_MARK)))
  assert.ok(!html.toUpperCase().includes(NAPKIN_COLOURS.base.toUpperCase()), 'no Napkin blue')
  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'))
  for (const c of Object.values(AGENCY_COLOURS)) {
    const p = { base: c.base, accent: c.accent }
    const el = { outerHTML: bootMark(NEUTRAL_MARK) }
    runInNewContext(script, { window: { __napkinBootMark: markColours(p) }, document: { getElementById: () => el } })
    assert.equal(el.outerHTML, bootMark(p))
  }
  const el = { outerHTML: bootMark(NEUTRAL_MARK) }
  runInNewContext(script, { window: { __napkinBootMark: null }, document: { getElementById: () => el } })
  assert.equal(el.outerHTML, bootMark(NEUTRAL_MARK), 'no agency: left neutral')
})

test('the shell\'s layer replaces the boot one', () => {
  const doc = document as unknown as { createElement: () => { id: string; remove?: () => void }; getElementById: (id: string) => unknown }
  const boot = doc.createElement()
  let removed = false
  boot.remove = () => { removed = true }
  boot.id = BOOT_SURFACE_ID
  applyAgency('tia@tbwa')
  assert.ok(removed)
})

test('the loading signs: on the desk, the agency\'s palette, shown late', () => {
  resetLateClock()
  // Before any agency is known: neutral, never Napkin's blue (as the boot screen).
  const none = renderToStaticMarkup(createElement(LogoSpinnerFill, { label: 'x' }))
  assert.ok(none.includes(NEUTRAL_MARK.base) && !none.toUpperCase().includes(NAPKIN_COLOURS.base))
  // A page has no applied agency during a render on the server; the last one signed in to stands in, as at boot.
  const kept: Record<string, string> = { 'napkin.lastAgency': 'wk' }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => kept[k] ?? null, setItem() {}, removeItem() {} } })
  for (const el of [createElement(LogoSpinnerFill, { label: 'Opening the studio…' }), createElement(LogoSpinnerVeil, { label: 'Opening…' })]) {
    const html = renderToStaticMarkup(el)
    assert.match(html, /logo-spinner-late[^>]*style="animation-delay:-?\d+ms"/)
    assert.ok(html.toUpperCase().includes(AGENCY_COLOURS.wk.base.toUpperCase()), 'the agency\'s base in the mark')
  }
  const css = read('src/brand/LogoSpinner.css')
  const rule = (sel: string) => css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')))
  assert.match(rule('.logo-spinner-fill'), /background: var\(--desk\)/)
  assert.match(rule('.logo-spinner-veil'), /var\(--desk\)/)
  assert.match(css, /\.logo-spinner-late \{ animation: logo-spinner-fade 300ms ease 400ms both; \}/)
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.logo-spinner-late \{ animation-duration: 1ms/)
})

test('one clock: a sign carries on the boot screen\'s wait and the sign before it', () => {
  resetLateClock()
  // the first sign, the boot screen still up: the wait began with the page
  assert.equal(waitStart(250, true), 0)
  assert.equal(lateDelay(0, 250), SHOW_AFTER_MS - 250)
  assert.equal(lateDelay(0, 900), SHOW_AFTER_MS - 900, 'past the delay: negative, already shown')
  lateBegin(0)
  // the sign-in check hands over to the shell's: same wait, even after its cleanup
  assert.equal(waitStart(600, false), 0)
  lateEnd(600)
  assert.equal(waitStart(600 + HANDOFF_MS, false), 0)
  // a wait much later is a wait of its own
  assert.equal(waitStart(5000, false), 5000)
  assert.equal(lateDelay(5000, 5000), SHOW_AFTER_MS)
  // the very first sign after the boot screen went: its own wait
  resetLateClock()
  assert.equal(waitStart(3000, false), 3000)
})

test('a basic agency\'s look is kept when applied, so the next boot paints it and not Napkin\'s', () => {
  const had = (globalThis as Record<string, unknown>).localStorage
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } })
  try {
    registerAgencyLooks([{ id: 'kestrellane', name: 'Kestrel Lane', base: '#1F4E3D', accent: '#F2C14E', aliases: ['kestrel'] }])
    rememberAgency('ruth@kestrel')
    const c = coloursOf('kestrellane')!
    assert.equal(lastAgency(), 'kestrellane')
    assert.deepEqual(lastAgencyLook(), { ...bootLookOf(c), base: '#1F4E3D', accent: '#F2C14E' })
    // the head script takes it before any module runs (the build's table has no such agency)
    const boot = runHead(Object.fromEntries(m))
    assert.equal(boot.appended[0].textContent, bootSurfaceCss(c))
    assert.deepEqual(Array.from(boot.mark ?? []), markColours({ base: '#1F4E3D', accent: '#F2C14E' }))
    // and the loading signs, before the shell applies it
    assert.equal(renderToStaticMarkup(createElement(() => { const p = useAgencyMark(); return createElement('i', null, p.base + p.accent) })), '<i>#1F4E3D#F2C14E</i>')
    // an agency in code always boots in the build's look: a kept look is never taken for it, nor kept
    const build = bootSurfaceCss(AGENCY_COLOURS.wk)
    assert.equal(runHead({ 'napkin.lastAgency': 'wk', [AGENCY_LOOK_KEY]: JSON.stringify({ id: 'wk', ...bootLookOf(c) }) }).appended[0].textContent, build)
    registerAgencyLooks([{ id: 'wk', name: 'W+K Dublin' }])
    rememberAgency('tom@wk')
    assert.equal(m.get(AGENCY_LOOK_KEY), undefined)
    // another agency's kept look, or a malformed one, is not taken: Napkin's kit, as before
    const napkin = bootSurfaceCss(NAPKIN_COLOURS)
    for (const bad of ['{', JSON.stringify({ id: 'other', ...bootLookOf(c) }), JSON.stringify({ id: 'acme', s: 'x', m: ['red'] }), JSON.stringify({ id: 'acme', s: '</style><script>', m: bootLookOf(c).m }), JSON.stringify({ id: 'acme', s: 1, m: [] })])
      assert.equal(runHead({ 'napkin.lastAgency': 'acme', [AGENCY_LOOK_KEY]: bad }).appended[0].textContent, napkin, bad)
    // an agency the registry does not colour keeps nothing
    rememberAgency('x@nowhere')
    assert.equal(m.get(AGENCY_LOOK_KEY), undefined)
  } finally {
    registerAgencyLooks([])
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: had })
  }
})
