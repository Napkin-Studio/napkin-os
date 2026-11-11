// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// An agency logo as it comes into the repo (scripts/agency-logos.mjs): only
// shapes and their fills survive. Everything else in the file (scripts, styles,
// links, ids, clip paths, defs, metadata, comments, event handlers) is dropped,
// and the shapes are written out flat, with coordinates to two decimals. The
// result is idempotent: sanitising a sanitised logo gives it back unchanged
// (tests/agencyLogos.test.ts holds the committed files to that).

const SHAPES: Readonly<Record<string, readonly string[]>> = {
  path: ['d', 'fill-rule', 'clip-rule'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  polygon: ['points'],
}
// Containers whose contents are never drawn as they stand (or are not shapes at all).
const DROP = ['script', 'style', 'defs', 'clipPath', 'mask', 'pattern', 'symbol', 'foreignObject', 'metadata', 'title', 'desc', 'linearGradient', 'radialGradient', 'filter', 'marker', 'a', 'use', 'image', 'text']
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]*$/
const COLOUR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|black|white|none)$/i

function round(n: string): string {
  const v = Math.round(Number(n) * 100) / 100
  return Object.is(v, -0) ? '0' : String(v)
}

/** Numbers to two decimals, kept apart where rounding would run two together. */
function roundAll(s: string): string {
  return s.replace(NUM, (m, off: number, src: string) => {
    const v = round(m)
    return off > 0 && /[\d.]/.test(src[off - 1]) && !v.startsWith('-') ? ' ' + v : v
  }).replace(/\s+/g, ' ').trim()
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4] ?? ''
  return out
}

/** A colour the logo can carry; anything else (url(), currentColor, var()) is not kept. */
function colourOf(v: string | undefined): string | null {
  if (!v) return null
  const c = v.trim().toLowerCase()
  if (!COLOUR.test(c)) return null
  if (c === 'black') return '#000000'
  if (c === 'white') return '#ffffff'
  return c
}

/** The logo's shapes and fills, flat; throws when there is no viewBox or no shape to draw. */
export function sanitiseSvg(src: string): string {
  let s = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '')
  for (const el of DROP) {
    s = s.replace(new RegExp(`<${el}\\b[^>]*/>`, 'gi'), '')
    s = s.replace(new RegExp(`<${el}\\b[\\s\\S]*?</${el}\\s*>`, 'gi'), '')
  }
  const root = /<svg\b[^>]*>/i.exec(s)
  if (!root) throw new Error('not an svg')
  const ra = attrs(root[0])
  const vb = (ra.viewBox || '').trim().split(/[\s,]+/).map(Number)
  if (vb.length !== 4 || vb.some(n => !Number.isFinite(n))) throw new Error('svg has no viewBox')
  const rootFill = colourOf(ra.fill)
  // The fill each shape inherits: its own, else its group's (one level of <g fill>), else the root's, else black.
  const shapes: string[] = []
  const stack: (string | null)[] = []
  for (const m of s.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, rest, self] = m
    if (name === 'g') {
      if (close) stack.pop()
      else if (!self) stack.push(colourOf(attrs(rest).fill))
      continue
    }
    const allowed = SHAPES[name]
    if (!allowed || close) continue
    const a = attrs(rest)
    const inherited = [...stack].reverse().find(f => f != null) ?? rootFill ?? '#000000'
    const fill = colourOf(a.fill) ?? inherited
    if (fill === 'none') continue
    const parts: string[] = []
    for (const k of allowed) {
      const v = a[k]
      if (v == null) continue
      if (k === 'd') { if (!PATH_DATA.test(v)) continue; parts.push(`d="${roundAll(v)}"`) }
      else if (k === 'fill-rule' || k === 'clip-rule') { if (v === 'evenodd' || v === 'nonzero') parts.push(`${k}="${v}"`) }
      else if (k === 'points') { if (/^[\d.,\s eE+-]*$/.test(v)) parts.push(`points="${roundAll(v)}"`) }
      else if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(v.trim())) parts.push(`${k}="${round(v.trim())}"`)
    }
    if (name === 'path' && !parts.some(p => p.startsWith('d='))) continue
    shapes.push(`<${name} fill="${fill}" ${parts.join(' ')}/>`)
  }
  if (!shapes.length) throw new Error('svg has no shapes')
  const [x, y, w, h] = vb.map(n => round(String(n)))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">${shapes.join('')}</svg>`
}

/** The same logo in one colour: every fill replaced (for a wordmark's copy on the other ground). */
export function recolourSvg(svg: string, fill: string): string {
  return svg.replace(/fill="#[0-9a-f]{3,6}"/gi, `fill="${fill.toLowerCase()}"`)
}
