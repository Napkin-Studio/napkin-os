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

/** Something in a file that could run or reach out, and the line it is on. */
export interface Found { what: string; line: number }

// The whitespace and control characters Rust's char::is_whitespace / is_control take out of an href (svg_sanitise.rs).
// eslint-disable-next-line no-control-regex -- the control characters are the point: Rust's is_control drops them
const HREF_JUNK = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u0000-\u001F\u007F-\u009F]/g

/**
 * Everything in `src` that could run or reach out: script and foreignObject
 * elements, `on*=` handlers, an href that is not `#local` (or is
 * `javascript:`), entity declarations and DOCTYPEs, in the order they appear.
 * Comments are not read (sanitiseSvg deletes them). The server refuses an
 * upload with any of these before it sanitises (crates/napkin-web/src/
 * svg_sanitise.rs active_content, held to the same fixtures,
 * tests/fixtures/svg/hostile/*.found.json); the People page runs it on a new
 * agency's wordmark before the agency is on the server.
 */
export function activeContent(src: string): Found[] {
  const text = src.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ' '))
  const found: [number, string][] = []
  for (const m of text.matchAll(/<!doctype/gi)) found.push([m.index, 'DOCTYPE'])
  for (const m of text.matchAll(/<!entity/gi)) found.push([m.index, 'ENTITY declaration'])
  for (const t of text.matchAll(/<([A-Za-z_][A-Za-z0-9_:.-]*)([^>]*)>/g)) {
    const local = (t[1].split(':').pop() ?? t[1]).toLowerCase()
    if (local === 'script') found.push([t.index, 'script'])
    else if (local === 'foreignobject') found.push([t.index, 'foreignObject'])
    const restAt = t.index + 1 + t[1].length
    for (const a of t[2].matchAll(/(?:^|[\s"'/])([oO][nN][A-Za-z][A-Za-z0-9_.:-]*)\s*=/g))
      found.push([restAt + a.index + (a[0].startsWith(a[1]) ? 0 : 1), `event handler ${a[1]}`])
    for (const h of t[2].matchAll(/(?:^|[\s"'/])(?:[A-Za-z0-9_.-]+:)?[hH][rR][eE][fF]\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) {
      const plain = (h[1] ?? h[2] ?? h[3] ?? '').replace(HREF_JUNK, '')
      const at = restAt + h.index
      if (plain.toLowerCase().startsWith('javascript:')) found.push([at, 'javascript: link'])
      else if (plain && !plain.startsWith('#')) found.push([at, `external link ${[...plain].slice(0, 80).join('')}`])
    }
  }
  found.sort((a, b) => a[0] - b[0])
  return found.map(([at, what]) => ({ what, line: 1 + (text.slice(0, at).match(/\n/g)?.length ?? 0) }))
}
