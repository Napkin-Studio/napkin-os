// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's colours on the chrome (features/new-ui-shell.clan). The agency
// layer is three tokens, for light and dark:
//
//   --agency       the agency's colour: the pill, the selected circle, the dial hub
//   --agency-fg    ink on it (near-black or white, whichever reads at 4.5:1 or more)
//   --agency-soft  a wash of it on the paper, for hovers and selected rows
//
// Colours are set by an admin, per agency, in AGENCY_COLOURS below (owner,
// 9 Nov 2026: "set by admin"; nobody picks their own). An agency with no entry
// gets the neutral pair. The layer is a <style> of its own on :root, apart
// from the inline properties App.tsx's resetTheme clears on every open, so an
// app's clan-theme-changed never touches it, and it never replaces --create
// (the Create department, and the one accent). Documents inside the frame keep
// their own paper palette: nothing here reaches the iframe.

/** What an admin sets for an agency: its colour (`accent`) and its darker base. */
export interface AgencyColours {
  /** The agency's display name, on the pill and the desk (admin-set; the session carries the id only). */
  name?: string
  /** The agency's colour on the chrome (the mock's `acc`). */
  accent: string
  /** Its base colour (the mock's `base`): kept for the dial and future use. */
  base: string
}

/**
 * The agency registry's colours, by the agency id people sign in under
 * (`name@<agency>`, lower case). Admin-maintained: a change here is a reviewed
 * change, like the roster. Seeded from the approved mock's agency kits.
 */
export const AGENCY_COLOURS: Readonly<Record<string, AgencyColours>> = {
  wk: { name: 'Wieden+Kennedy', base: '#1E22AA', accent: '#FFB800' },
  tbwa: { name: 'TBWA\\Dublin', base: '#16181D', accent: '#FFD400' },
  ogilvy: { base: '#E4002B', accent: '#FFD6DD' },
  harbour: { base: '#0F6B5C', accent: '#9FE6D8' },
  droga: { base: '#16181D', accent: '#C6F432' },
  napkin: { base: '#515BFF', accent: '#C8CBFF' },
}

/** The agency's name for a signed-in person: the registry's, else `fallback` (the id, title-cased). */
export function agencyNameOf(personId: string | null | undefined, fallback: string): string {
  return coloursOf(agencyIdOf(personId))?.name || fallback
}

/** One theme's agency tokens. */
export interface AgencyTokens { agency: string; fg: string; soft: string }

/** Both themes' tokens. */
export interface AgencyPalette { light: AgencyTokens; dark: AgencyTokens }

const INK = '#101114'
const WHITE = '#FFFFFF'
const PAPER = { light: '#FFFFFF', dark: '#0F1114' }

/** The neutral pair for an agency an admin has not coloured: ink on paper, inverted in dark. */
export const NEUTRAL: AgencyPalette = {
  light: { agency: '#14161B', fg: WHITE, soft: '#F2F3F6' },
  dark: { agency: '#F2F3F5', fg: '#14161B', soft: '#22262D' },
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance of a #rrggbb colour; null when it is not one. */
export function luminance(hex: string): number | null {
  const c = rgb(hex)
  if (!c) return null
  const [r, g, b] = c.map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21); 1 when either is not a colour. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b)
  if (la == null || lb == null) return 1
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Near-black or white, whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return contrast(bg, INK) >= contrast(bg, WHITE) ? INK : WHITE
}

/** `a` mixed into `b` by `t` (0 to 1), as #rrggbb. */
function mix(a: string, b: string, t: number): string {
  const ca = rgb(a)!, cb = rgb(b)!
  return '#' + ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** The tokens for an agency's colours, light and dark; the neutral pair when there are none, or they are not colours. */
export function paletteOf(colours: AgencyColours | null | undefined): AgencyPalette {
  if (!colours || !rgb(colours.accent)) return NEUTRAL
  const a = colours.accent.toUpperCase()
  const fg = inkOn(a)
  return {
    light: { agency: a, fg, soft: mix(a, PAPER.light, 0.16) },
    dark: { agency: a, fg, soft: mix(a, PAPER.dark, 0.2) },
  }
}

/** The agency id from a signed-in person's id (`name@agency`); null for the desktop or an anonymous tenant. */
export function agencyIdOf(personId: string | null | undefined): string | null {
  if (!personId) return null
  const at = personId.indexOf('@')
  const id = at < 0 ? '' : personId.slice(at + 1).trim().toLowerCase()
  return id || null
}

/** The admin-set colours for an agency id, if it has any. */
export function coloursOf(agencyId: string | null | undefined): AgencyColours | null {
  return agencyId ? AGENCY_COLOURS[agencyId] ?? null : null
}

/** The CSS the layer is: both themes, on :root, apart from every other token. */
export function agencyCss(p: AgencyPalette): string {
  const block = (t: AgencyTokens) => `--agency: ${t.agency}; --agency-fg: ${t.fg}; --agency-soft: ${t.soft};`
  return `:root, :root[data-theme='light'] { ${block(p.light)} }\n:root[data-theme='dark'] { ${block(p.dark)} }`
}

const STYLE_ID = 'napkin-agency'
const SURFACE_ID = 'napkin-agency-surface'

/**
 * The agency's tints on the studio's surfaces, as the approved mock draws them
 * (gaps.md §13.0, mock phase 28): the desk, paper and lines take a little of
 * the agency's base (6%, 2.5% and 10% in light; 12%, 9%, 7% and 16% in dark),
 * and the action colour (--ag-act: selected toggles, primary buttons) is the
 * base in light and the accent in dark. An agency an admin has not coloured
 * takes Napkin's kit, as the medallion does (markOf).
 */
export function surfaceCss(colours: AgencyColours | null | undefined): string {
  const c = colours && rgb(colours.base) && rgb(colours.accent) ? colours : NAPKIN_COLOURS
  const b = c.base.toUpperCase(), a = c.accent.toUpperCase()
  const ink = (bg: string) => (inkOn(bg) === INK ? '#141413' : WHITE)
  const mixIn = (pct: string, onto: string) => `color-mix(in srgb, ${b} ${pct}, ${onto})`
  const shared = `--ag-base: ${b}; --ag-acc: ${a}; --ag-acc-ink: ${inkOn(a)}; --accent-line: #C8CBFF;`
  const light = `${shared} --ag-act: ${b}; --ag-act-ink: ${ink(b)}; --desk: ${mixIn('6%', '#F6F1E7')}; --paper: ${mixIn('2.5%', '#FFFDF8')}; --card: #FFFFFF; --line: ${mixIn('10%', '#E2D9C8')};`
  const dark = `${shared} --ag-act: ${a}; --ag-act-ink: ${ink(a)}; --desk: ${mixIn('12%', '#121110')}; --paper: ${mixIn('9%', '#1B1A18')}; --card: ${mixIn('7%', '#201E1B')}; --line: ${mixIn('16%', '#34302A')};`
  return `:root, :root[data-theme='light'] { ${light} }\n:root[data-theme='dark'] { ${dark} }`
}

/** Put the agency's layer on the page (or the neutral one); idempotent. */
export function applyAgency(personId: string | null | undefined, doc: Document = document): void {
  const css = agencyCss(paletteOf(coloursOf(agencyIdOf(personId))))
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = doc.createElement('style')
    el.id = STYLE_ID
    doc.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
  const surface = surfaceCss(coloursOf(agencyIdOf(personId)))
  let sl = doc.getElementById(SURFACE_ID) as HTMLStyleElement | null
  if (!sl) {
    sl = doc.createElement('style')
    sl.id = SURFACE_ID
    doc.head.appendChild(sl)
  }
  if (sl.textContent !== surface) sl.textContent = surface
  setAppliedMark(markOf(personId))
}

// The agency whose layer is on the page, for every Deep O mark that is not told
// its colours (brand/DeepOMark.tsx useAgencyMark): loading signs, the veil.
let appliedMark: { base: string; accent: string } | null = null
const appliedSubs = new Set<() => void>()
function setAppliedMark(m: { base: string; accent: string }): void {
  if (appliedMark && appliedMark.base === m.base && appliedMark.accent === m.accent) return
  appliedMark = m
  appliedSubs.forEach(f => f())
}
/** The mark colours of the agency layer on the page; null before any is applied. */
export function appliedAgencyMark(): { base: string; accent: string } | null { return appliedMark }
/** Be told when the applied agency changes; returns the unsubscribe. */
export function onAppliedAgency(f: () => void): () => void { appliedSubs.add(f); return () => { appliedSubs.delete(f) } }

/** Napkin's own kit: the medallion's colours for an agency an admin has not coloured. */
export const NAPKIN_COLOURS: AgencyColours = AGENCY_COLOURS.napkin

/** The medallion's colours for a signed-in person: their agency's base and accent, else Napkin's. */
export function markOf(personId: string | null | undefined): { base: string; accent: string } {
  const c = coloursOf(agencyIdOf(personId)) ?? NAPKIN_COLOURS
  return { base: c.base, accent: c.accent }
}
