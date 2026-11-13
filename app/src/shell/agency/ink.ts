// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A client's monogram ink on its own fill (the desk's circles): the one piece of the old accent file that is not
// about sampling a logo (features/align-landing-look.clan). Pure.

import { contrast } from './palette'

/** What text must reach (WCAG AA). */
export const MIN_CONTRAST = 4.5
/** What the adjustment aims for, so a tint on the paper cannot take it under. */
const TARGET = 4.8

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

/**
 * A client's monogram ink on its own fill, at 4.5 to 1 or better. The fill is the client's colour and does not
 * change with the theme, so neither does this pair: it holds in light and dark alike. An ink that already reads is
 * returned as it is; otherwise only its lightness moves, away from the fill, so it keeps its hue and saturation.
 */
export function readableInk(fill: string, ink: string): string {
  const reads = (c: string) => contrast(c, fill) >= TARGET
  if (reads(ink)) return ink
  const [h, s, l] = toHsl(fromHex(ink))
  const lighter = contrast('#FFFFFF', fill) >= contrast('#000000', fill)
  for (let step = 1; step <= 100; step++) {
    const c = toHex(fromHsl([h, s, Math.max(0, Math.min(1, l + (lighter ? 1 : -1) * step * 0.01))]))
    if (reads(c)) return c
  }
  return lighter ? '#FFFFFF' : '#000000'
}
