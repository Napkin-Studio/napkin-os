// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's accent, taken from its logo (features/agency-look.clan).
//
//   sampleAccent   the strongest colour in a logo's pixels, ignoring black, white and grey;
//                  null when the logo has none (then the agency has no accent)
//   accentFor      that colour at the lightness where text in it reads on a mode's paper
//   accentsOf      all three modes at once: what is saved
//
// Pure: no canvas and no DOM in this file, so it is tested with plain arrays
// (tests/agencyAccent.test.ts). The canvas that makes the pixels is in
// look.ts. Only the lightness moves; the hue and the saturation stay the
// logo's, so the accent still looks like the logo's colour.

import { contrast } from './palette'
import type { Mode } from '../../theme'

/** The three surfaces text sits on in each mode: the desk, the paper and the card. Held equal to modes.css by a test. */
export const MODE_SURFACES: Readonly<Record<Mode, readonly [string, string, string]>> = {
  white: ['#F6F1E7', '#FFFDF8', '#FFFFFF'],
  grey: ['#C9C3B6', '#D8D3C7', '#E4DFD4'],
  black: ['#121110', '#1B1A18', '#201E1B'],
}

/** What text in the accent must reach (WCAG AA), and what the adjustment aims for so the agency's own tint on the paper cannot take it under. */
export const MIN_CONTRAST = 4.5
const TARGET = 4.8

export interface Accents { white: string; grey: string; black: string }

type Rgb = [number, number, number]
type Hsl = [number, number, number]

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
export const toHex = ([r, g, b]: Rgb): string => '#' + hex2(r) + hex2(g) + hex2(b)

function fromHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) as Rgb
}

function toHsl([r, g, b]: Rgb): Hsl {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function fromHsl([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** A pixel counts as a colour of its own when it is opaque enough, clearly tinted, and neither near-black nor near-white. */
const MIN_ALPHA = 128
const MIN_SATURATION = 0.28
const MIN_LIGHTNESS = 0.14
const MAX_LIGHTNESS = 0.9
const HUES = 24

/**
 * The strongest colour in RGBA pixels (a canvas's `ImageData.data`), as
 * `#rrggbb`, or null when there is none. Greys, black and white are ignored,
 * and so is anything see-through. The pixels are grouped by hue; the group
 * with the most area weighted by how saturated it is wins, and its average
 * is the colour.
 */
export function sampleAccent(data: ArrayLike<number>): string | null {
  const sum = Array.from({ length: HUES }, () => ({ w: 0, n: 0, rgb: [0, 0, 0] }))
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]]
    const [h, s, l] = toHsl(rgb)
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue
    const g = sum[Math.min(HUES - 1, Math.floor((h / 360) * HUES))]
    g.w += s; g.n += 1
    g.rgb[0] += rgb[0]; g.rgb[1] += rgb[1]; g.rgb[2] += rgb[2]
  }
  const best = sum.reduce((a, b) => (b.w > a.w ? b : a))
  if (best.n === 0) return null
  return toHex(best.rgb.map(v => v / best.n) as Rgb)
}

/** The lowest contrast of `hex` against a mode's three surfaces. */
export function minContrast(hex: string, mode: Mode): number {
  return Math.min(...MODE_SURFACES[mode].map(s => contrast(hex, s)))
}

/**
 * `hex` at the lightness where text in it reads on `mode`'s surfaces at 4.5 to
 * 1 or better: darker on White and Grey, lighter on Black. A colour that
 * already reads is returned as it is.
 */
export function accentFor(hex: string, mode: Mode): string {
  const rgb = fromHex(hex)
  if (minContrast(toHex(rgb), mode) >= TARGET) return toHex(rgb)
  const [h, s, l] = toHsl(rgb)
  const dir = mode === 'black' ? 1 : -1
  for (let step = 1; step <= 100; step++) {
    const c = toHex(fromHsl([h, s, Math.max(0, Math.min(1, l + dir * step * 0.01))]))
    if (minContrast(c, mode) >= TARGET) return c
  }
  // Not reachable for a real colour (black on the lightest paper is 17 to 1); the extreme is the honest answer.
  return dir === 1 ? '#FFFFFF' : '#000000'
}

/** The accent in every mode, from the logo's sampled colour. */
export function accentsOf(hex: string): Accents {
  return { white: accentFor(hex, 'white'), grey: accentFor(hex, 'grey'), black: accentFor(hex, 'black') }
}

/**
 * The CSS that puts the accent on the page: `--agency-accent` per mode, on
 * :root, in a <style> of its own. No accent writes no rule, so the token is
 * simply not there and every use falls back to what it was.
 */
export function accentCss(accent: Accents | null | undefined): string {
  if (!accent) return ''
  const rule = (sel: string, c: string) => `${sel} { --agency-accent: ${c}; }`
  return [
    rule(':root', accent.white),
    rule(":root[data-mode='white']", accent.white),
    rule(":root[data-mode='grey']", accent.grey),
    rule(":root[data-mode='black']", accent.black),
  ].join('\n')
}
