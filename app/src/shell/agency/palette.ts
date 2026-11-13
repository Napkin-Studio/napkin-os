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

import { ICON_PNG, ICON_SVG, WORDMARK_SVG } from './logos'
import { recolourSvg, sanitiseSvg } from './svgSanitise'

/** What an admin sets for an agency: its colour (`accent`) and its darker base. */
export interface AgencyColours {
  /** The agency's display name, on the pill, the desk and the sign-in card (admin-set; the session carries the id only). */
  name: string
  /** The agency's colour on the chrome (the mock's `acc`). */
  accent: string
  /** Its base colour (the mock's `base`): kept for the dial and future use. */
  base: string
  /** Its wordmark for a light ground (a data: URI from logos.ts), where a wide mark fits: the agency pill, the sign-in card. */
  logo?: string
  /** Its wordmark for a dark ground. */
  logoOnDark?: string
  /** Its square mark (a data: URI), where a square fits: the brief's agency tile, avatar-sized spots. Without one, initials. */
  icon?: string
  /** Ink on the accent, where the brand sets it (Pluto: navy on lime); else near-black or white, whichever reads. */
  accentInk?: string
  /** The pill's ground: the accent (the default), or the base with an accent hairline (a brand whose mark is white on black). */
  pill?: 'accent' | 'base'
  /**
   * 'line': the accent is never a big fill. Actions are the base in both
   * themes, outlined in the accent, and the accent is the needs and highlight
   * colour (Catapult's crimson). Default 'fill': actions are the base in
   * light and the accent in dark.
   */
  accentUse?: 'fill' | 'line'
  /** 'mono': neutral surfaces (an off-white desk in light, black in dark) instead of the studio's warm paper tinted with the base. */
  surface?: 'warm' | 'mono'
}

const svgUri = (svg: string) => 'data:image/svg+xml,' + encodeURIComponent(svg)
const pngUri = (b64: string) => 'data:image/png;base64,' + b64

/**
 * The agency registry's colours, by the agency id people sign in under
 * (`name@<agency>`, lower case). Admin-maintained: a change here is a reviewed
 * change, like the roster. Seeded from the approved mock's agency kits.
 *
 * This is the one place an agency's look ("template") lives: the sign-in card
 * (shell/SignIn.tsx) takes it as soon as someone types `@<id>` (or an email at
 * `<id>.<tld>`), and the studio wears it after they sign in. To add an agency,
 * an admin adds one line: its id (lower case, the part after the @), its
 * display `name`, its darker `base` and its `accent` (#rrggbb). Every other
 * token, light and dark, is derived (paletteOf, surfaceCss, markOf), and
 * tests/agencyPalette.test.ts checks that the new look reads. Logos are
 * optional: put the files through scripts/agency-logos.mjs (it sanitises them
 * into logos.ts) and set `logo` / `logoOnDark` (wordmark per ground) and
 * `icon` (square); without them the agency's name and initials stand in.
 * Other spellings go in AGENCY_ALIASES. Branding only: nothing here says who
 * has an account.
 */
export const AGENCY_COLOURS: Readonly<Record<string, AgencyColours>> = {
  wk: { name: 'Wieden+Kennedy', base: '#1E22AA', accent: '#FFB800' },
  tbwa: { name: 'TBWA\\Dublin', base: '#16181D', accent: '#FFD400' },
  ogilvy: { name: 'Ogilvy', base: '#E4002B', accent: '#FFD6DD' },
  harbour: { name: 'Harbour & Co', base: '#0F6B5C', accent: '#9FE6D8' },
  droga: { name: 'Droga5', base: '#16181D', accent: '#C6F432' },
  napkin: { name: 'Napkin', base: '#515BFF', accent: '#C8CBFF' },
  // The next three: colours from the owner's brand references, logos from the
  // owner's assets (2026-11-11). tests/agencySkins.test.tsx checks each reads.
  // Boys+Girls: black and white only. The white wordmark on a black pill;
  // black buttons in light, white buttons with black text in dark.
  boysandgirls: {
    name: 'Boys+Girls', base: '#000000', accent: '#FFFFFF', pill: 'base', surface: 'mono',
    logo: svgUri(recolourSvg(WORDMARK_SVG.boysandgirls, '#000000')), logoOnDark: svgUri(WORDMARK_SVG.boysandgirls), icon: pngUri(ICON_PNG.boysandgirls),
  },
  // Catapult: black, with a hint of crimson (their "Get in touch" outline):
  // a hairline on actions and the pill, and the needs colour; never a big fill.
  catapult: {
    name: 'Catapult', base: '#000000', accent: '#C61566', pill: 'base', accentUse: 'line', surface: 'mono',
    logo: svgUri(WORDMARK_SVG.catapult), logoOnDark: svgUri(recolourSvg(WORDMARK_SVG.catapult, '#FFFFFF')), icon: svgUri(ICON_SVG.catapult),
  },
  // Pluto: navy, white and lime (their play button); text on lime is navy, never white.
  pluto: {
    name: 'Pluto', base: '#000047', accent: '#B2F257', accentInk: '#000047',
    logo: svgUri(WORDMARK_SVG.pluto), logoOnDark: svgUri(recolourSvg(WORDMARK_SVG.pluto, '#FFFFFF')),
  },
  // ACNE (a Deloitte business; deloittedigital.com/ie/en/acne.html, owner 2026-11-13): black, with a hint
  // of Deloitte green (#86BC25, their page's progress bar) as Catapult has its crimson: a hairline on
  // actions and the pill, and the needs colour; never a big fill. The mark traced from their site.
  acne: {
    name: 'ACNE', base: '#000000', accent: '#86BC25', pill: 'base', accentUse: 'line', surface: 'mono',
    logo: svgUri(WORDMARK_SVG.acne), logoOnDark: svgUri(recolourSvg(WORDMARK_SVG.acne, '#FFFFFF')),
  },
}

/**
 * Other spellings people sign in under, to the registry id they mean
 * (`x@bg` is Boys+Girls). Only for the look: the roster decides who signs in.
 */
export const AGENCY_ALIASES: Readonly<Record<string, string>> = {
  bg: 'boysandgirls',
  boysgirls: 'boysandgirls',
  'b+g': 'boysandgirls',
  'w+k': 'wk',
}
// napkin-web mirrors the ids, names, colours and aliases above (crates/napkin-web/src/people.rs
// CODE_AGENCIES, CODE_ALIASES) to recognise an agency on the People page; tests/peopleAdmin.test.ts keeps them in step.

/**
 * A published look, as napkin-web serves it (`GET /api/agency-looks`,
 * features/agency-looks-admin.clan). Two tiers: a basic agency made on the
 * People page carries its name, two colours, other spellings and one SVG
 * wordmark (`logo`, a data: URI); an agency in code carries only a published
 * display `name` (its look stays the code's).
 */
export interface AgencyLook { id: string; name?: string; base?: string; accent?: string; aliases?: string[]; logo?: string | null; rev?: number }

// The People page's published looks (features/people-admin.clan, agency-looks-admin.clan): basic agencies
// after the code registry, and display names laid onto code entries (AGENCY_COLOURS itself never changes).
let addedColours: Record<string, AgencyColours> = {}
let addedAliases: Record<string, string> = {}
let codeNames: Record<string, AgencyColours> = {}

/** The SVG text of an SVG data: URI (percent-encoded or base64); null for anything else. */
export function svgOfUri(uri: unknown): string | null {
  if (typeof uri !== 'string') return null
  const m = /^data:image\/svg\+xml(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/i.exec(uri)
  if (!m) return null
  try {
    if (!m[1]) return decodeURIComponent(m[2])
    const bin = atob(m[2])
    return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)))
  } catch { return null }
}

/**
 * A basic agency's look from its name, two colours and its one wordmark (SVG
 * text or an SVG data: URI): every other token is derived as for any agency
 * (paletteOf, surfaceCss), and the dark-ground wordmark is the same SVG
 * recoloured white. The wordmark goes through sanitiseSvg again (idempotent on
 * the server's output); one that does not survive is dropped, the name stands
 * in. Null without a name or with a colour that is not #rrggbb.
 */
export function basicLook(l: { name?: string; base?: string; accent?: string; logo?: string | null }): AgencyColours | null {
  const name = typeof l.name === 'string' ? l.name.trim() : ''
  if (!name || typeof l.base !== 'string' || typeof l.accent !== 'string' || !rgb(l.base) || !rgb(l.accent)) return null
  const c: AgencyColours = { name, base: l.base.trim().toUpperCase(), accent: l.accent.trim().toUpperCase() }
  const raw = typeof l.logo === 'string' ? (svgOfUri(l.logo) ?? (l.logo.trimStart().startsWith('<') ? l.logo : null)) : null
  if (raw) {
    try {
      const svg = sanitiseSvg(raw)
      c.logo = svgUri(svg)
      c.logoOnDark = svgUri(recolourSvg(svg, '#FFFFFF'))
    } catch { /* not a logo: the name stands in */ }
  }
  return c
}

/**
 * Take the published looks into the registry: a basic agency's people wear its
 * look, and an agency in code takes only its published display name (its look,
 * logos and spellings stay the code's, so Reset is always the tested look).
 */
export function registerAgencyLooks(looks: readonly AgencyLook[]): void {
  const colours: Record<string, AgencyColours> = {}
  const names: Record<string, AgencyColours> = {}
  const aliases: Record<string, string> = {}
  for (const l of looks) {
    const id = typeof l?.id === 'string' ? l.id.trim().toLowerCase() : ''
    if (!id) continue
    if (Object.hasOwn(AGENCY_COLOURS, id)) {
      const name = typeof l.name === 'string' ? l.name.trim() : ''
      if (name && name !== AGENCY_COLOURS[id].name) names[id] = { ...AGENCY_COLOURS[id], name }
      continue
    }
    const c = basicLook(l)
    if (!c) continue
    colours[id] = c
    for (const a of l.aliases ?? []) if (typeof a === 'string' && a.trim()) aliases[a.trim().toLowerCase()] = id
  }
  addedColours = colours
  codeNames = names
  addedAliases = aliases
}

/** The basic agencies from the People page that the registry holds now. */
export function addedAgencyIds(): string[] { return Object.keys(addedColours) }

/** The registry id an agency id means (itself, or an alias's target); null when the registry has neither. */
export function canonicalAgencyId(agencyId: string | null | undefined): string | null {
  if (!agencyId) return null
  const id = agencyId.trim().toLowerCase()
  if (Object.hasOwn(AGENCY_COLOURS, id)) return id
  if (Object.hasOwn(AGENCY_ALIASES, id)) return AGENCY_ALIASES[id]
  if (Object.hasOwn(addedColours, id)) return id
  return Object.hasOwn(addedAliases, id) ? addedAliases[id] : null
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
  const fg = accentInkOf(colours)
  return {
    light: { agency: a, fg, soft: mix(a, PAPER.light, 0.16) },
    dark: { agency: a, fg, soft: mix(a, PAPER.dark, 0.2) },
  }
}

/** Ink on an agency's accent: the brand's own where it sets one, else whichever of near-black and white reads. */
export function accentInkOf(colours: AgencyColours): string {
  return colours.accentInk && rgb(colours.accentInk) ? colours.accentInk.toUpperCase() : inkOn(colours.accent)
}

/** The pill's ground, its ink and its rim (Toolbar.tsx AgencyPill): the accent, or the base with an accent hairline. */
export function pillOf(colours: AgencyColours): { bg: string; ink: string; line: string | null } {
  if (colours.pill === 'base') return { bg: colours.base.toUpperCase(), ink: inkOn(colours.base), line: colours.accent.toUpperCase() }
  return { bg: colours.accent.toUpperCase(), ink: accentInkOf(colours), line: null }
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
  const id = canonicalAgencyId(agencyId)
  if (!id) return null
  if (Object.hasOwn(AGENCY_COLOURS, id)) return Object.hasOwn(codeNames, id) ? codeNames[id] : AGENCY_COLOURS[id]
  return addedColours[id] ?? null
}

/** Which ground a colour is: light when near-black ink reads best on it. */
export function groundOf(bg: string): 'light' | 'dark' {
  return inkOn(bg) === INK ? 'light' : 'dark'
}

/** The agency's wordmark for a ground; null when it has none that reads there (then its name, as text). */
export function wordmarkOf(colours: AgencyColours | null | undefined, ground: 'light' | 'dark'): string | null {
  return (ground === 'light' ? colours?.logo : colours?.logoOnDark) || null
}

/**
 * The agency pill's mark (Toolbar.tsx AgencyPill): the wordmark for the pill's
 * ground (the accent), and the icon for a bar too narrow for it. Nulls for an
 * agency with no logos: the pill keeps its name.
 */
export function pillLogoOf(colours: AgencyColours | null | undefined): AgencyLogo {
  if (!colours || !rgb(colours.accent) || !rgb(colours.base)) return { wordmark: null, icon: null }
  return { wordmark: wordmarkOf(colours, groundOf(pillOf(colours).bg)), icon: iconOf(colours) }
}

/** An agency's marks for one place: the wordmark that reads on its ground, and its square icon. */
export interface AgencyLogo { wordmark: string | null; icon: string | null }

/** The agency's square mark; null when it has none (then its initials). */
export function iconOf(colours: AgencyColours | null | undefined): string | null {
  return colours?.icon || null
}

/**
 * The registry agency a half-typed sign-in name points at, for the sign-in
 * card's look: `tia@tbwa` is tbwa, and an email's domain before its TLD is too
 * (`siobhan.ryan@tbwa.com`, `x@tbwa.co.uk`). Null with no @ yet, or for an
 * agency the registry does not have. Only the registry is read, never the
 * roster or the server, so the look says nothing about who has an account.
 */
export function agencyOfSignInName(typed: string): string | null {
  const id = agencyIdOf(typed)
  if (!id) return null
  if (canonicalAgencyId(id)) return canonicalAgencyId(id)
  const labels = id.split('.')
  for (let i = labels.length - 2; i >= 0; i--) if (canonicalAgencyId(labels[i])) return canonicalAgencyId(labels[i])
  return null
}

/** The CSS the layer is: both themes, on :root, apart from every other token. */
export function agencyCss(p: AgencyPalette): string {
  const block = (t: AgencyTokens) => `--agency: ${t.agency}; --agency-fg: ${t.fg}; --agency-soft: ${t.soft};`
  return `:root, :root[data-theme='light'] { ${block(p.light)} }\n:root[data-theme='dark'] { ${block(p.dark)} }`
}

const STYLE_ID = 'napkin-agency'
/** The boot screen's copy of the surface layer (index.html, brand/bootLook.ts), until the shell's own lands. */
export const BOOT_SURFACE_ID = 'napkin-boot-surface'

/** The desk before any agency tint: tokens.css's --desk, and the boot screen's when no agency is known. */
export const DESK_BASE = { light: '#F6F1E7', dark: '#121110' } as const

/**
 * The mark when no agency is known (a browser nobody has signed in on yet):
 * warm graphite on a pale accent, never Napkin's blue, so a first visit does
 * not open in one look and turn into another.
 */
export const NEUTRAL_MARK: { base: string; accent: string } = { base: '#4A453E', accent: '#D9D1C3' }
const SURFACE_ID = 'napkin-agency-surface'

/**
 * The agency's tints on the studio's surfaces, as the approved mock draws them
 * (gaps.md §13.0, mock phase 28): the desk, paper and lines take a little of
 * the agency's base (6%, 2.5% and 10% in light; 12%, 9%, 7% and 16% in dark),
 * and the action colour (--ag-act: selected toggles, primary buttons) is the
 * base in light and the accent in dark. An agency an admin has not coloured
 * takes Napkin's kit, as the medallion does (markOf). An agency's options
 * change this: `surface: 'mono'` swaps the tinted warm paper for neutral
 * surfaces, `accentUse: 'line'` keeps actions in the base with an accent
 * hairline (--ag-act-line) and makes the accent the needs colour (--needs),
 * and `pill: 'base'` puts the pill on the base with an accent rim (--ag-pill*).
 */
export function surfaceCss(colours: AgencyColours | null | undefined): string {
  const c = colours && rgb(colours.base) && rgb(colours.accent) ? colours : NAPKIN_COLOURS
  const b = c.base.toUpperCase(), a = c.accent.toUpperCase()
  const ink = (bg: string) => (inkOn(bg) === INK ? '#141413' : WHITE)
  const accInk = accentInkOf(c), actInk = (bg: string) => (bg === a ? (c.accentInk ? accInk : ink(a)) : ink(bg))
  const mixIn = (pct: string, onto: string) => `color-mix(in srgb, ${b} ${pct}, ${onto})`
  const pill = pillOf(c)
  // Only an agency that sets them writes the pill, hairline and needs tokens; the rest keep the CSS defaults.
  const extra = (pill.line ? ` --ag-pill: ${pill.bg}; --ag-pill-ink: ${pill.ink}; --ag-pill-line: ${pill.line};` : '')
    + (c.accentUse === 'line' ? ` --ag-act-line: ${a}; --needs: ${a}; --needs-ink: ${ink(a)};` : '')
  const shared = `--ag-base: ${b}; --ag-acc: ${a}; --ag-acc-ink: ${accInk}; --accent-line: #C8CBFF;${extra}`
  const act = { light: b, dark: c.accentUse === 'line' ? b : a }
  const surfaces = c.surface === 'mono'
    ? { light: '--desk: #F5F5F4; --paper: #FFFFFF; --card: #FFFFFF; --line: #E2E2E0;', dark: '--desk: #000000; --paper: #111111; --card: #161616; --line: #2A2A2A;' }
    : {
        light: `--desk: ${mixIn('6%', DESK_BASE.light)}; --paper: ${mixIn('2.5%', '#FFFDF8')}; --card: #FFFFFF; --line: ${mixIn('10%', '#E2D9C8')};`,
        dark: `--desk: ${mixIn('12%', DESK_BASE.dark)}; --paper: ${mixIn('9%', '#1B1A18')}; --card: ${mixIn('7%', '#201E1B')}; --line: ${mixIn('16%', '#34302A')};`,
      }
  const light = `${shared} --ag-act: ${act.light}; --ag-act-ink: ${actInk(act.light)}; ${surfaces.light}`
  const dark = `${shared} --ag-act: ${act.dark}; --ag-act-ink: ${actInk(act.dark)}; ${surfaces.dark}`
  return `:root, :root[data-theme='light'] { ${light} }\n:root[data-theme='dark'] { ${dark} }`
}

/** One theme's block of surfaceCss as token: value, with every colour (color-mix included) as #RRGGBB. */
export function surfaceTokens(colours: AgencyColours | null | undefined, theme: 'light' | 'dark'): Record<string, string> {
  const block = surfaceCss(colours).split('\n')[theme === 'light' ? 0 : 1] ?? ''
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+): ([^;]+);/g)) {
    const v = m[2].trim()
    const cm = /^color-mix\(in srgb, (#[0-9A-Fa-f]{6}) ([\d.]+)%, (#[0-9A-Fa-f]{6})\)$/.exec(v)
    out[m[1]] = cm ? mix(cm[1], cm[3], Number(cm[2]) / 100) : rgb(v) ? v.toUpperCase() : v
  }
  return out
}

/** One readability check: `fg` on `bg` reads at `ratio`, and needs `need` (text 4.5:1, a logo 3:1). */
export interface LookCheck { label: string; bg: string; fg: string; ratio: number; need: number }

/** The chrome's own ink over the agency's wash (hovers, selected rows), light and dark. */
export const CHROME_INK = { light: '#14161B', dark: '#F2F3F5' } as const

/** The ink of an SVG data: URI: its first fill, as #RRGGBB; null for anything else. */
export function logoFill(uri: string | null | undefined): string | null {
  const m = /fill="#([0-9a-f]{6}|[0-9a-f]{3})"/i.exec(svgOfUri(uri) ?? '')
  if (!m) return null
  return '#' + (m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1]).toUpperCase()
}

/**
 * Whether a look reads (the People page's "Does it read?" panel, and the
 * tests for every look in code): text on the pill, on the light action colour
 * and on the dark one at 4.5:1, and, for a look with a wordmark, the wordmark
 * on the pill, on a light card and on a dark card at 3:1. `every` adds the
 * pairs the editor does not list but the tests hold every code look to: the
 * accent's own ink, the chrome's ink on the wash, and the needs count.
 */
export function lookChecks(colours: AgencyColours, every = false): LookCheck[] {
  const out: LookCheck[] = []
  const add = (label: string, bg: string, fg: string, need: number) => out.push({ label, bg, fg, ratio: contrast(bg, fg), need })
  const pill = pillOf(colours)
  const light = surfaceTokens(colours, 'light'), dark = surfaceTokens(colours, 'dark')
  add('Text on the pill', pill.bg, pill.ink, 4.5)
  add('Text on the base (buttons, light)', light['--ag-act'], light['--ag-act-ink'], 4.5)
  add('Text on the accent (buttons, dark)', dark['--ag-act'], dark['--ag-act-ink'], 4.5)
  if (colours.logo || colours.logoOnDark) {
    const onPill = logoFill(pillLogoOf(colours).wordmark)
    if (onPill) add('Logo on the pill', pill.bg, onPill, 3)
    const l = logoFill(colours.logo)
    if (l) add('Logo on a light ground (sign-in card)', '#FFFFFF', l, 3)
    const d = logoFill(colours.logoOnDark)
    if (d) add('Logo on a dark ground (recoloured white)', dark['--card'], d, 3)
  }
  if (every) {
    const p = paletteOf(colours)
    add('Ink on the accent', colours.accent.toUpperCase(), accentInkOf(colours), 4.5)
    add('Ink on the wash, light', p.light.soft, CHROME_INK.light, 4.5)
    add('Ink on the wash, dark', p.dark.soft, CHROME_INK.dark, 4.5)
    if (light['--needs']) add('What needs you', light['--needs'], light['--needs-ink'], 4.5)
  }
  return out
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
  // The boot screen painted the last agency's surface before any script ran; the shell's own layer replaces it.
  doc.getElementById(BOOT_SURFACE_ID)?.remove()
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
