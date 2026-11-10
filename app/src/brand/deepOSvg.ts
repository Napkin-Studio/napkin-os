// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Deep O as markup: the one source of the mark's geometry, for every place that
// draws it. <DeepOMark> (brand/DeepOMark.tsx) renders these strings and repaints
// them per frame; the pre-JS boot splash (brand/bootLook.ts), the favicon,
// the app icons (scripts/deep-o-icons.mjs) and the home CLAN app take the static,
// CSS-animated cut of the same strings. Nothing else draws the mark.
//
// Two cuts, as the grammar (design/new-ui/identity-v4/mark/deep-o-grammar.js) has them:
//   > 24 px   the approved mock's satin "H1" mark (napkin-app-v1.html mountH1Mark):
//             a sphere with a window; a sky over a sea whose horizon is the accent;
//             the ring round it is the progress arc.
//   <= 24 px  the grammar's small cut (liveSVG with SMALL): flat tones, hinted
//             geometry (a smaller, deeper window, a little more turn) and NO horizon
//             line, which read as a minus sign or a Pokeball at that size.

import { createModel, mixO, type MarkModel, type MarkParams, type MarkState } from './deepO'
import { frameAttrs, type Look } from '../components/medallionMotion'
import { mix } from '../components/medallionLook'
import { NAPKIN_COLOURS } from '../shell/agency/palette'

/** The mark's two colours: the agency's base (the sphere) and accent (the horizon and the ring). */
export interface MarkPalette { base: string; accent: string }

/** Napkin's own kit, for when no agency is known (the registry's `napkin` entry). */
export const NAPKIN_MARK: MarkPalette = { base: NAPKIN_COLOURS.base, accent: NAPKIN_COLOURS.accent }

/** At this size and below the mark is the grammar's small cut. */
export const SMALL_MAX = 24
/** The arc's share of the ring while the length of the wait is unknown (indeterminate). */
export const INDETERMINATE_LEN = 0.28
/** Seconds the indeterminate arc takes to go round once. */
export const SPIN_PERIOD = 2.4

/** The progress a state shows when the host gives none: needs closes most of the ring, done all of it. */
export function defaultProgress(state: MarkState): number {
  return state === 'needs' ? 0.85 : state === 'done' ? 1 : state === 'working' ? INDETERMINATE_LEN : 0
}

/** A model eased fully to `state` (a still, a first paint, a static cut). */
export function settledModel(state: MarkState, progress = defaultProgress(state)): MarkModel {
  const m = createModel({ state, progress })
  m.snap(true)
  return m
}

const REST: Look = { lx: 0, ly: 0, vx: 0, vy: 0 }

// ---------- > 24 px: the satin mark ----------

export type H1Attrs = ReturnType<typeof frameAttrs>

/** Every attribute of the satin mark for eased params `c` (the mock's tickH1Mark). */
export function h1Attrs(p: MarkPalette, c: MarkParams, arcTail: number, look: Look = REST, t = 0): H1Attrs {
  return frameAttrs(p.base, p.accent, c, arcTail, look, t)
}

/**
 * The satin mark's inside (everything in the <svg>), ids prefixed `uid`. Nodes the
 * draw loop repaints carry `data-k`. `spin`: the ring sits in a `.deep-o-spin` group
 * that CSS turns (the static, CSS-animated cut), so its own rotation is left at 12 o'clock.
 */
export function h1Inner(p: MarkPalette, A: H1Attrs, uid: string, opt: { spin?: boolean } = {}): string {
  const { base, accent } = p
  const u = (k: string) => `${uid}${k}`
  const rim = `cx="${(A.wall.x + 2.2).toFixed(2)}" cy="${(A.wall.y + 2.2).toFixed(2)}"`
  const rot = opt.spin ? 'rotate(-90)' : A.rot
  const ring = `<circle data-k="arc-halo" r="44.2" fill="none" stroke="${A.line}" stroke-width="8.5" stroke-linecap="round" opacity="${A.haloOpacity}" stroke-dasharray="${A.dash}" transform="${rot}"/>`
    + `<circle data-k="arc" class="deep-o-arc" r="44.2" fill="none" stroke="${A.line}" stroke-width="5.2" stroke-linecap="round" opacity="${A.arcOpacity}" stroke-dasharray="${A.dash}" transform="${rot}" data-testid="medallion-arc"/>`
  return '<defs>'
    + `<radialGradient id="${u('sphere')}" cx="30%" cy="24%" r="76%" fx="26%" fy="20%"><stop offset="0%" stop-color="${mix(base, '#FFFFFF', 0.34)}"/><stop offset="46%" stop-color="${mix(base, '#FFFFFF', 0.06)}"/><stop offset="100%" stop-color="${mix(base, '#050609', 0.52)}"/></radialGradient>`
    + `<linearGradient id="${u('fresnel')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.42"/><stop offset="50%" stop-color="${base}" stop-opacity="0"/><stop offset="100%" stop-color="${accent}" stop-opacity="0.28"/></linearGradient>`
    + `<linearGradient id="${u('wall')}" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0%" stop-color="${mix(base, '#020305', 0.76)}"/><stop offset="55%" stop-color="${mix(base, '#06070B', 0.56)}"/><stop offset="100%" stop-color="${mix(mix(base, '#06070B', 0.45), accent, 0.18)}"/></linearGradient>`
    + `<linearGradient id="${u('sky')}" x1="0" y1="0" x2="0" y2="1"><stop data-k="sky-top" offset="0%" stop-color="${A.skyTop}"/><stop data-k="sky-bot" offset="100%" stop-color="${A.skyBot}"/></linearGradient>`
    + `<linearGradient id="${u('sea')}" x1="0" y1="0" x2="0" y2="1"><stop data-k="sea-top" offset="0%" stop-color="${A.seaTop}"/><stop offset="100%" stop-color="#040508"/></linearGradient>`
    + `<filter id="${u('cavity')}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="-2.2" dy="2.8" stdDeviation="2.4" flood-color="#000000" flood-opacity="0.52"/></filter>`
    + `<clipPath id="${u('cut')}"><circle data-k="cut-clip" cx="${A.wall.x}" cy="${A.wall.y}" r="33"/></clipPath>`
    + `<clipPath id="${u('win')}"><circle data-k="win-clip" cx="${A.win.x}" cy="${A.win.y}" r="28.2"/></clipPath>`
    + '</defs>'
    + '<ellipse cx="1" cy="44" rx="28" ry="4.5" fill="rgba(10,12,18,0.22)"/>'
    + `<circle r="47" fill="url(#${u('sphere')})" stroke="rgba(255,255,255,0.14)" stroke-width="1.1"/>`
    + `<circle r="46.4" fill="none" stroke="url(#${u('fresnel')})" stroke-width="1.3"/>`
    + `<g clip-path="url(#${u('cut')})"><circle data-k="wall-fill" cx="${A.wall.x}" cy="${A.wall.y}" r="33" fill="url(#${u('wall')})"/>`
    + `<circle data-k="cavity-rim-sh" ${rim} r="34" fill="none" stroke="#000000" stroke-width="5.5" stroke-opacity="0.48"/></g>`
    + `<g clip-path="url(#${u('win')})" filter="url(#${u('cavity')})"><rect x="-50" y="-50" width="100" height="100" fill="url(#${u('sky')})"/>`
    + `<path data-k="bloom" d="${A.wave}" fill="none" stroke="${A.line}" stroke-width="10" stroke-linecap="round" opacity="${A.bloomOpacity}"/>`
    + `<path data-k="sea" d="${A.sea}" fill="url(#${u('sea')})"/>`
    + `<path data-k="wave" d="${A.wave}" fill="none" stroke="${A.line}" stroke-width="4.3" stroke-linecap="round" opacity="${A.waveOpacity}"/>`
    + `<circle data-k="win-ao" cx="${A.win.x}" cy="${A.win.y}" r="28.5" fill="none" stroke="#020306" stroke-width="4.2" stroke-opacity="0.42"/></g>`
    + `<circle data-k="lip" cx="${A.win.x}" cy="${A.win.y}" r="28.2" fill="none" stroke="${A.line}" stroke-width="1.25" stroke-opacity="${A.lipOpacity}"/>`
    + (opt.spin ? `<g class="deep-o-spin">${ring}</g>` : ring)
}

/** A node the painter can write to: an element, or a test's stand-in. */
export interface PaintNode { setAttribute(name: string, value: string): void; readonly isConnected: boolean }
export interface PaintRoot { querySelectorAll(sel: string): Iterable<PaintNode & { getAttribute(name: string): string | null }> }

/**
 * The draw loop's `set` for paintH1: finds each `data-k` node in `el`, and finds
 * them again once they are gone from the page. Whatever replaces the markup (the
 * first paint written again by React), the loop paints the nodes that show, never
 * detached ones, so the mark on screen always follows its model.
 */
export function nodePainter(el: PaintRoot): (k: string, a: Record<string, string | number>) => void {
  const nodes = new Map<string, PaintNode>()
  const collect = () => { nodes.clear(); for (const n of el.querySelectorAll('[data-k]')) nodes.set(n.getAttribute('data-k')!, n) }
  collect()
  return (k, a) => {
    let n = nodes.get(k)
    if (!n || !n.isConnected) { collect(); n = nodes.get(k) }
    if (n) for (const [x, v] of Object.entries(a)) n.setAttribute(x, String(v))
  }
}

/** One frame of the satin mark onto its nodes (by `data-k`): attributes only. */
export function paintH1(set: (k: string, a: Record<string, string | number>) => void, A: H1Attrs): void {
  set('sky-top', { 'stop-color': A.skyTop })
  set('sky-bot', { 'stop-color': A.skyBot })
  set('sea-top', { 'stop-color': A.seaTop })
  set('cut-clip', { cx: A.wall.x, cy: A.wall.y })
  set('wall-fill', { cx: A.wall.x, cy: A.wall.y })
  set('cavity-rim-sh', { cx: (A.wall.x + 2.2).toFixed(2), cy: (A.wall.y + 2.2).toFixed(2) })
  set('win-clip', { cx: A.win.x, cy: A.win.y })
  set('win-ao', { cx: A.win.x, cy: A.win.y })
  set('lip', { cx: A.win.x, cy: A.win.y, stroke: A.line, 'stroke-opacity': A.lipOpacity })
  set('sea', { d: A.sea })
  set('wave', { d: A.wave, stroke: A.line, opacity: A.waveOpacity })
  set('bloom', { d: A.wave, stroke: A.line, opacity: A.bloomOpacity })
  set('arc', { stroke: A.line, opacity: A.arcOpacity, 'stroke-dasharray': A.dash, transform: A.rot })
  set('arc-halo', { stroke: A.line, opacity: A.haloOpacity, 'stroke-dasharray': A.dash, transform: A.rot })
}

// ---------- <= 24 px: the grammar's small cut ----------

const TAU = Math.PI * 2
const GEO_FACE: [number, number] = [0.15, 0.15]
const SMALL = { RH: 0.5, ZF: -0.4, EX: 1.25 }
const K = 48
const WARM_ARC = '#EED8B8'

const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
const relLum = (h: string) => { const c = rgb(h).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const contrast = (a: string, b: string) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
/** The grammar's agency rule: a mark too close to its surface (below 1.6:1) gets a rim in ink or paper. */
export const rimFor = (shell: string, bg: string): string | null => contrast(shell, bg) < 1.6 ? (relLum(bg) > 0.4 ? '#16181D' : '#E9EAEC') : null

/** The grammar's projection of the lip, the pane and the arc's path, for a pose `face` (silhouette radius 1). */
function project(face: [number, number]) {
  const RH = SMALL.RH, ZM = Math.sqrt(1 - RH * RH), ZF = SMALL.ZF
  const n = Math.hypot(face[0], face[1], 1), f = [face[0] / n, face[1] / n, 1 / n]
  const X = [f[2], 0, -f[0]], xl = Math.hypot(X[0], X[1], X[2]); X[0] /= xl; X[2] /= xl
  const Y = [f[1] * X[2] - f[2] * X[1], f[2] * X[0] - f[0] * X[2], f[0] * X[1] - f[1] * X[0]]
  const D = 5.2, sil = 2.6 / Math.sqrt(D * D - 1)
  const at = (l: number[]) => { const w = [0, 1, 2].map(j => X[j] * l[0] + Y[j] * l[1] + f[j] * l[2]); const s = 2.6 / (D - w[2]) / sil; return [w[0] * s, -w[1] * s] }
  const ring = (z: number) => Array.from({ length: 72 }, (_, i) => { const a = i / 72 * TAU; return at([RH * Math.cos(a), RH * Math.sin(a), z]) })
  const cw = Array.from({ length: 72 }, (_, i) => { const a = Math.PI / 2 - i / 72 * TAU; return at([RH * Math.cos(a), RH * Math.sin(a), ZM]) })
  return { m: ring(ZM), fl: ring(ZF), cw }
}
const pathOf = (pts: number[][]) => 'M' + pts.map(q => (q[0] * K).toFixed(2) + ' ' + (q[1] * K).toFixed(2)).join('L') + 'Z'

/**
 * The small cut's inside (the grammar's liveSVG at <= 24 px), for eased params `c`.
 * The sphere is the agency's base and the ring its accent, as the satin mark's.
 * `surface` is the colour behind it (for the contrast rim); `arcOpacity` scales the ring.
 * `spin`: the ring's dash offset is left for CSS to turn (class `deep-o-dash`).
 */
export function smallInner(p: MarkPalette, size: number, surface: string, c: MarkParams, arcTail: number, uid: string, opt: { arcOpacity?: number; spin?: boolean } = {}): string {
  const R = project([GEO_FACE[0] * SMALL.EX + c.fx, GEO_FACE[1] * SMALL.EX + c.fy])
  const rim = rimFor(p.base, surface)
  let shell = mixO(p.base, '#0B0C10', 0.5 * c.night); shell = mixO(shell, '#6A6D74', 0.88 * (1 - c.sat))
  const wall = mixO(shell, '#0B0C10', 0.58)
  let pane = mixO(p.base, '#FFFFFF', 0.5 + 0.22 * Math.min(1, c.glow) + 0.1 * c.swell)
  pane = mixO(pane, mixO(p.base, '#000000', 0.82), c.night)
  pane = mixO(pane, '#6E7178', 0.9 * (1 - c.sat))
  const len = Math.max(0.001, Math.min(1, c.len)), arcW = 9.5 * (c.hw / 0.062)
  const arcCol = c.sat < 0.5 ? '#9A9CA1' : c.warm > 0.5 ? WARM_ARC : p.accent
  const tail = ((arcTail % 1) + 1) % 1
  const op = Math.min(1, c.arcOn) * c.pulse * (opt.arcOpacity ?? 1)
  const dash = len >= 0.995 ? '1 0' : `${len.toFixed(3)} ${(1 - len).toFixed(3)}`
  const arc = c.arcOn > 0.03
    ? `<path data-k="arc"${opt.spin ? ' class="deep-o-dash"' : ''} d="${pathOf(R.cw)}" pathLength="1" fill="none" stroke="${arcCol}" stroke-width="${arcW.toFixed(2)}" stroke-linecap="round" stroke-dasharray="${dash}" stroke-dashoffset="${opt.spin ? 0 : (-tail).toFixed(3)}" opacity="${op.toFixed(2)}"/>`
    : ''
  return `<defs><clipPath id="${uid}m"><path d="${pathOf(R.m)}"/></clipPath><clipPath id="${uid}f"><path d="${pathOf(R.fl)}"/></clipPath></defs>`
    + `<circle r="48" fill="${shell}"/>`
    + (rim ? `<circle r="${(48 - 50 / size).toFixed(2)}" fill="none" stroke="${rim}" stroke-width="${(100 / size).toFixed(2)}"/>` : '')
    + `<path d="${pathOf(R.m)}" fill="${wall}"/>`
    + `<g clip-path="url(#${uid}m)"><g clip-path="url(#${uid}f)"><rect x="-50" y="-50" width="100" height="100" fill="${pane}"/></g></g>`
    + arc
}

// ---------- the static cut: plain markup, CSS-animated ----------

/** The stylesheet the static cut needs: the ring turns while it waits; under reduced motion it only breathes. */
export const DEEP_O_CSS = '.deep-o-static{display:block;flex-shrink:0;overflow:visible}'
  + `.deep-o-static .deep-o-spin{transform-box:fill-box;transform-origin:center;animation:deep-o-turn ${SPIN_PERIOD}s linear infinite}`
  + `.deep-o-static .deep-o-dash{animation:deep-o-dash ${SPIN_PERIOD}s linear infinite}`
  + '@keyframes deep-o-turn{to{transform:rotate(360deg)}}'
  + '@keyframes deep-o-dash{to{stroke-dashoffset:-1}}'
  + '@keyframes deep-o-breathe{0%,100%{opacity:1}50%{opacity:.4}}'
  + '@media (prefers-reduced-motion:reduce){.deep-o-static .deep-o-spin,.deep-o-static .deep-o-dash{animation:deep-o-breathe 2.4s ease-in-out infinite}}'

export interface StaticMarkOptions {
  size: number
  palette?: MarkPalette
  state?: MarkState
  /** Steps done / steps; leave it out while working for the indeterminate, turning arc. */
  progress?: number
  /** Id prefix; every copy on one page needs its own. */
  uid?: string
  /** Read out instead of hiding the mark from screen readers. */
  label?: string
  /** The colour behind it, for the small cut's contrast rim. */
  surface?: string
  /** Extra attributes on the <svg> (a class, a data- hook). */
  attrs?: string
}

/** The mark as one static <svg> string: the boot splash, the favicon, the icons, pages with no React. */
export function staticMarkSvg(o: StaticMarkOptions): string {
  const palette = o.palette ?? NAPKIN_MARK
  const state = o.state ?? 'awake'
  const spin = state === 'working' && o.progress == null
  const m = settledModel(state, o.progress ?? defaultProgress(state))
  const uid = o.uid ?? 'deepo'
  const inner = o.size <= SMALL_MAX
    ? smallInner(palette, o.size, o.surface ?? '#FFFFFF', m.c, 0, uid, { spin })
    : h1Inner(palette, h1Attrs(palette, m.c, 0), uid, { spin })
  const a11y = o.label ? ` role="img" aria-label="${o.label.replace(/"/g, '&quot;')}"` : ' aria-hidden="true"'
  return `<svg xmlns="http://www.w3.org/2000/svg" class="deep-o-static" width="${o.size}" height="${o.size}" viewBox="-50 -50 100 100"${a11y}${o.attrs ? ' ' + o.attrs : ''}>${inner}</svg>`
}

/** The favicon (and the manifest's "any" icon): the small cut, awake, in Napkin's colours. */
export function faviconSvg(): string {
  return staticMarkSvg({ size: 16, uid: 'fav', label: 'Napkin Studio' }).replace(' width="16" height="16"', '')
}

/** The app icon source (the manifest's PNGs): the satin mark, awake, in Napkin's colours. */
export function appIconSvg(size: number): string {
  return staticMarkSvg({ size, uid: 'icon', label: 'Napkin Studio' })
}

/** A static cut as a template for a page's own script: `__ID__` for the id prefix, `__SIZE__` for the size. */
export function markTemplate(size: number, state: MarkState = 'working'): string {
  return staticMarkSvg({ size, state, uid: '__ID__' }).replace(` width="${size}" height="${size}"`, ' width="__SIZE__" height="__SIZE__"')
}

/**
 * The home CLAN app (crates/napkin-host/assets/home_app.html) with its loading
 * sign's regions written from here: the stylesheet, and the small and satin
 * templates its `spinner()` fills in.
 */
export function homeAppRegions(html: string): string {
  const put = (s: string, begin: string, end: string, body: string) => {
    const a = s.indexOf(begin), b = s.indexOf(end)
    if (a < 0 || b < a) throw new Error(`home_app.html lost its ${begin} … ${end} marks`)
    return s.slice(0, a + begin.length) + body + s.slice(b)
  }
  const js = `\n  var DEEP_O = ${JSON.stringify({ small: markTemplate(20), satin: markTemplate(44) })};\n  `
  return put(put(html, '/* deep-o:css:begin */', '/* deep-o:css:end */', ` ${DEEP_O_CSS} `), '// deep-o:js:begin', '// deep-o:js:end', js)
}
