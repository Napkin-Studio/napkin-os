// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The boot screen (index.html, before any module runs) in the person's own
// look, so a reload goes from blank to the desk with no other colours on the
// way. vite.config.ts (deepOBoot) writes all of this into the page at build:
//
//   - BOOT_CSS: the boot screen on the desk colour, html and body on it too,
//     and the mark and its words shown only once the wait passes SHOW_AFTER_MS;
//   - bootHeadScript(): reads the theme and the agency this browser last
//     signed in to (agency/lastAgency.ts), sets data-theme, and puts that
//     agency's surface layer (palette.ts surfaceCss) on the page at once;
//   - bootMarkHtml(): the mark, in the neutral colours, and a line of script
//     that recolours it to the agency's.
//
// Everything is generated from palette.ts and deepOSvg.ts, so there is no
// hand-kept copy of a colour here to drift.

import { AGENCY_COLOURS, BOOT_SURFACE_ID, DESK_BASE, NAPKIN_COLOURS, NEUTRAL_MARK, surfaceCss, type AgencyColours } from '../shell/agency/palette'
import { staticMarkSvg, type MarkPalette } from './deepOSvg'
import { SHOW_AFTER_MS, SHOW_FADE_MS } from './lateShow'

/** localStorage keys the boot reads: theme.ts's and lastAgency.ts's. */
export const THEME_KEY = 'napkin.theme'
export const AGENCY_KEY = 'napkin.lastAgency'

/** The boot words' ink: tokens.css's --muted, light and dark. */
export const BOOT_INK = { light: '#6D655A', dark: '#A49B8D' } as const

const MARK_ID = 'napkin-boot-mark'
const MARK_SIZE = 64
const HEX = /#[0-9A-Fa-f]{6}\b/g

/** The boot mark for a palette: LogoSpinnerFill's size and state, as a static, CSS-turned cut. */
export function bootMark(p: MarkPalette): string {
  return staticMarkSvg({ size: MARK_SIZE, state: 'working', uid: 'boot', palette: p, attrs: `id="${MARK_ID}"` })
}

/** The colours of a mark in document order; the rest of the markup is the same for every palette. */
export function markColours(p: MarkPalette): string[] {
  return bootMark(p).match(HEX) ?? []
}

const skeleton = (svg: string) => svg.replace(HEX, '#')

/** A look the boot can take: the surface layer for the page, and the mark's colours. */
export interface BootLook { s: string; m: string[] }

/** What the head script chooses from: each registry agency, and `d` for an agency the registry does not colour. */
export interface BootLooks { a: Record<string, BootLook>; d: BootLook }

/**
 * The surface layer at boot: surfaceCss, with `:root` doubled so it outranks
 * tokens.css (whose link comes after it in <head>) until applyAgency puts the
 * shell's own layer on and removes this one.
 */
export function bootSurfaceCss(c: AgencyColours | null): string {
  return surfaceCss(c).replace(/:root/g, ':root:root')
}

/** The looks, generated from the registry; throws if any mark's markup differs from the neutral one but for colour. */
export function bootLooks(): BootLooks {
  const base = skeleton(bootMark(NEUTRAL_MARK))
  const look = (c: AgencyColours): BootLook => {
    const p = { base: c.base, accent: c.accent }
    if (skeleton(bootMark(p)) !== base) throw new Error('boot mark: markup differs between palettes; it cannot be recoloured')
    return { s: bootSurfaceCss(c), m: markColours(p) }
  }
  const a: Record<string, BootLook> = {}
  for (const [id, c] of Object.entries(AGENCY_COLOURS)) a[id] = look(c)
  return { a, d: look(NAPKIN_COLOURS) }
}

/** The boot screen's stylesheet: the desk from the first paint; the mark and words only on a slow load. */
export const BOOT_CSS = `:root,:root[data-theme='light']{--desk:${DESK_BASE.light};--boot-ink:${BOOT_INK.light}}`
  + `:root[data-theme='dark']{--desk:${DESK_BASE.dark};--boot-ink:${BOOT_INK.dark}}`
  + 'html,body{background:var(--desk)}'
  + '.napkin-boot{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;'
  + "background:var(--desk);color:var(--boot-ink);font:500 13px/1 'Geist','Helvetica Neue',Arial,sans-serif;letter-spacing:-.01em}"
  + `.napkin-boot>*{animation:napkin-late ${SHOW_FADE_MS}ms ease ${SHOW_AFTER_MS}ms both}`
  + '@keyframes napkin-late{from{opacity:0}to{opacity:1}}'
  + '@media (prefers-reduced-motion:reduce){.napkin-boot>*{animation-duration:1ms}}'

/** The head script: theme and agency from the last session, before the first paint. Storage may throw: then neutral. */
export function bootHeadScript(looks: BootLooks = bootLooks()): string {
  return '(function(){var L=' + JSON.stringify(looks) + ',d=document.documentElement,t,a,k;'
    + `try{t=localStorage.getItem('${THEME_KEY}');a=localStorage.getItem('${AGENCY_KEY}')}catch(e){}`
    + "if(t==='white'||t==='grey')t='light';else if(t==='black')t='dark';"
    + "if(t!=='light'&&t!=='dark')t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';"
    + "d.setAttribute('data-theme',t);d.style.colorScheme=t;"
    + "a=a?String(a).trim().toLowerCase():'';"
    + 'k=/^[a-z0-9._-]+$/.test(a)?(Object.prototype.hasOwnProperty.call(L.a,a)?L.a[a]:L.d):null;'
    + `if(k){var s=document.createElement('style');s.id='${BOOT_SURFACE_ID}';s.textContent=k.s;document.head.appendChild(s)}`
    + 'window.__napkinBootMark=k?k.m:null})()'
}

/** The mark in neutral colours, and the line that recolours it to the agency's (the head script chose them). */
export function bootMarkHtml(): string {
  const recolour = `(function(){var c=window.__napkinBootMark,e=document.getElementById('${MARK_ID}'),i=0;`
    + 'if(c&&e)e.outerHTML=e.outerHTML.replace(/#[0-9A-Fa-f]{6}\\b/g,function(){return c[i++]})})()'
  return bootMark(NEUTRAL_MARK) + `<script>${recolour}</script>`
}
