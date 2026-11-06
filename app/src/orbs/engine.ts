// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Orbs: one WebGL context for every circle on the page. Shrey's sphere + ring
// shader (shader.ts, never edited here), drawn into one atlas canvas, each
// circle copied to its own 2D canvas. Ported from the Deck Maker template's
// `Orbs` block (app/templates/deck-maker/index.html) and the landing mock's
// engine, typed and made testable:
//   - createOrbs() makes an engine with its own state; shared() is the shell's one.
//   - everything the browser gives (matchMedia, rAF, IntersectionObserver, the
//     window's pointer) is read from globalThis at the moment it is needed, so a
//     test can install pretend ones, and a page with none stays flat.
//   - flat SVG is the fallback in every failing case (no WebGL, context lost,
//     reduced data, unknown agent, a shader that will not compile, "Force flat").
// The circle itself is React's: `host.wrap` holds the flat <svg> and a <canvas>;
// the engine never moves or re-parents a node it did not make.
//
// PORT (what differs from the template, all marked): the circle shadow is off
// (controls are flat); the ring is clamped to the circle's box; ring colours come
// from the landing's --lc-ring-* tokens read from the circle's own element (so
// light and dark follow the page); an `idle` ring; the pointer is followed across
// the whole window; no hand-off between agents (the landing has none); idle
// circles redraw at about 15 fps; a hard cap on live circles.

import { pseudoAgent, rgb, type Agent } from './agents'
import { FRAG, VERT } from './shader'
import { arc0, arc1, CA, cir0, cir1, clamp, PA, poseSpan, writeStatic } from './pose'
import { STYLE } from './tables'

export type OrbActivity = 'human' | 'error' | 'work' | 'think' | 'read' | 'check' | 'idle'

export interface OrbSpec {
  /** A material name from tables.ts: the sphere is a blank one of that material. */
  agent: string
  activity: OrbActivity
  /** Nominal CSS size of the circle's box. */
  size: number
  /** Where the circle lives on the page. Keeps its ring and turn across a re-render. No size in it. */
  slot: string
  /** Steps done of total, for the one circle whose run reports them: the arc's length. */
  steps?: readonly [number, number] | null
}

export interface OrbHost {
  /** The element that holds the flat svg and the canvas; gets `data-orb="on"` while 3D shows. */
  wrap: HTMLElement
  canvas: HTMLCanvasElement
}

export interface OrbHandle {
  update(spec: OrbSpec): void
  /** A press from the keyboard: the same ripple a pointer press makes. */
  kick(): void
  /** A press at a screen point: the squish and ripple; the pointer is then followed until it is released. */
  press(x: number, y: number): boolean
  detach(): void
}

export interface OrbStats {
  ok: boolean
  flat: boolean
  lost: boolean
  soft: boolean
  reason: string
  renderer: string
  frames: number
  skipped: number
  draws: number
  drawn: number
  uploads: number
  flushes: number
  px: number
  cpuMs: number
  avgMs: number
  fps: number
  scale: number
  circles: number
  slots: number
  reduce: boolean
  dpr: number
}

type GL = WebGLRenderingContext
interface Rip { x: number; y: number; t0: number; amp: number }
interface Interact {
  press: number; ox: number; oy: number; vx: number; vy: number; hov: number
  light: [number, number]; ptr: { x: number; y: number } | null; drag: { sx: number; sy: number } | null
  rips: Rip[]; ripI: number; R: number; busy: boolean; ripOn: number
}
interface Ring { v: Float32Array; c: Float32Array; swell: number; rt: number; ringR: number; len: number; ang: number }
interface Circle {
  wrap: HTMLElement; cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null
  size: number; k: number; css: number; A: Agent; act: OrbActivity; steps: readonly [number, number] | null
  slot: string; settled: boolean; attached: boolean; inAll: boolean; shown: boolean; goneAt: number
  mt: number; energy: number; vis: boolean; wakeUntil: number; acc: number; last: number
  ax: number; ay: number; d: number; R0: number; dir: [number, number]
  RING: Ring; I: Interact; rip: Float32Array
}

const L_MIN = 0.1
const GAP_K = 20 / 140 // the clan's ring sits 20 px outside a ~140 px sphere; kept as a proportion so it scales
const MAXW = 2048, MAXH = 1024 // the atlas never grows past this; more circles than fit are drawn in batches
const SOFT = /swiftshader|llvmpipe|softpipe|software/i // a software renderer: one pixel per CSS pixel
/** More circles than this stay flat: browsers refuse many contexts, and a phone cannot draw them all. */
export const MAX_LIVE = 40
/** An arc that says "working" without claiming progress it does not know (several jobs, or none reporting steps). */
export const FIXED_ARC = 0.34
export const HUMAN_ARC = 0.25
const IDLE_MS = 66 // an idle, untouched circle is redrawn about 15 times a second
const FOLLOW_FLOOR = 0.3, FOLLOW_REACH = 3, FOLLOW_MAX = 0.16 // strength floor; reach in radii; most lean in radii

/** The ring tokens (the landing's --lc-ring-*), one per style. */
const TOKEN_OF: Record<string, string> = {
  work: '--lc-ring-work', think: '--lc-ring-think', read: '--lc-ring-read', check: '--lc-ring-check',
  human: '--lc-ring-human', error: '--lc-ring-error', idle: '--lc-ring-wait',
}
const ACTIVITIES = new Set(Object.keys(TOKEN_OF))

/** The arc length for a circle: the one place the shell decides how much ring to draw. */
export function arcLength(act: OrbActivity, steps: readonly [number, number] | null): number {
  if (act === 'error') return 0.62
  if (act === 'idle') return 1
  if (act === 'human') return HUMAN_ARC
  if (steps && steps[1] > 0) return Math.max(L_MIN, Math.min(steps[0], steps[1]) / steps[1])
  return FIXED_ARC
}

/** Parse what getComputedStyle gives for a colour: #rgb, #rrggbb, rgb(), rgba(), color(srgb r g b). */
export function parseColour(v: string): number[] | null {
  v = String(v || '').trim()
  let m = /^#([0-9a-f]{6})$/i.exec(v)
  if (m) return rgb('#' + m[1])
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v)
  if (m) return rgb('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3])
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(v)
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255]
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(v)
  if (m) return [+m[1], +m[2], +m[3]]
  return null
}

type Win = Window & typeof globalThis
const W = (): Win => globalThis as unknown as Win
const nowS = () => performance.now() / 1000

export function createOrbs() {
  const motion = { reduce: false }
  const PTR = { clientX: null as number | null, clientY: null as number | null, dirty: false }
  const ENG = {
    ok: false, frames: 0, skipped: 0, draws: 0, uploads: 0, flushes: 0, drawn: 0, px: 0, cpuMs: 0, avgMs: 16, fps: 0,
    scale: 1, lost: false, flat: false, soft: false, reason: '', renderer: '', dpr: 1,
  }
  const ALL: Circle[] = [], LIST: Circle[] = []
  const SLOTS = new Map<string, Circle>()
  const BYWRAP = new WeakMap<Element, Circle>()
  const COLORS: Record<string, Float32Array> = {}
  const bgV = new Float32Array(3), trackV = new Float32Array(3), accV = new Float32Array(3)
  const v2 = new Float32Array(2), rs = new Float32Array(4), rf = new Float32Array(4), rg = new Float32Array(4)
  const pingV = new Float32Array(4), wob = new Float32Array(4), DIRV: [number, number] = [1, 0]
  let gl: GL | null = null, glcv: HTMLCanvasElement | null = null
  let U: { f1(n: string, v: number): void; v(n: string, size: 2 | 3 | 4, arr: Float32Array): void } | null = null
  let AW = 256, AH = 256, phase = 0 // phase: 0 not started, 1 running, -1 flat for good
  let rafId = 0, lastWall = 0, lastFrame = 0, govN = 0, fpsT = 0, fpsN = 0, wakeAll = true
  let themeEl: HTMLElement | null = null
  let epoch = 0 // bumps when the context comes back, so circles drawn while it was gone can try again
  const listeners = new Set<() => void>()
  let io: IntersectionObserver | null = null
  const undo: Array<() => void> = []
  const BATCH: Circle[] = []
  let nBatch = 0

  const publish = () => {
    // The page can say what the engine is doing, for people and for the smoke test.
    try {
      const de = W().document?.documentElement
      if (!de) return
      de.setAttribute('data-orbs', ENG.ok && !ENG.flat ? 'gl' : 'flat')
      de.setAttribute('data-orbs-gl', ENG.ok ? '1' : '0')
      de.setAttribute('data-orbs-why', ENG.ok ? (ENG.flat ? 'forced flat' : '') : ENG.reason)
    } catch { /* no document */ }
  }

  // ── theme: ring colours, the surface behind glass and the track, read from the circle's own tokens ──
  function resolve(cs: CSSStyleDeclaration, el: HTMLElement, name: string, fb: string): number[] {
    const raw = cs.getPropertyValue(name).trim()
    const direct = parseColour(raw)
    if (direct) return direct
    // An unresolved token (color-mix of other tokens): ask the browser what colour it makes.
    const doc = W().document
    try {
      const probe = doc.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`
      el.appendChild(probe)
      const got = parseColour(W().getComputedStyle(probe).color)
      probe.remove()
      if (got) return got
      const c2 = doc.createElement('canvas')
      c2.width = c2.height = 1
      const x = c2.getContext('2d')
      if (x) {
        x.fillStyle = raw || fb
        x.fillRect(0, 0, 1, 1)
        const d = x.getImageData(0, 0, 1, 1).data
        return [d[0] / 255, d[1] / 255, d[2] / 255]
      }
    } catch { /* fall through */ }
    return rgb(fb)
  }
  function readTheme() {
    const el = themeEl && themeEl.isConnected ? themeEl : (ALL[0]?.wrap ?? null)
    if (!el) return
    themeEl = el
    const cs = W().getComputedStyle(el)
    for (const k of Object.keys(STYLE)) COLORS[k] = Float32Array.from(resolve(cs, el, TOKEN_OF[k] ?? '--lc-ring-work', '#FF4F2E'))
    accV.set(resolve(cs, el, '--lc-ring-work', '#FF4F2E'))
    // --card is on :root; read it where the circle is.
    const card = parseColour(cs.getPropertyValue('--card')) ?? [1, 1, 1]
    bgV.set(card)
    trackV.set(resolve(cs, el, '--lc-ring-track', '#D3D6DC'))
    wake()
  }

  // ── the one context ──
  function build(): boolean {
    try {
      if (!glcv) return false
      gl = glcv.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }) as GL | null
      if (!gl) { ENG.reason = 'no WebGL: flat SVG'; return (ENG.ok = false) }
      const g = gl
      const sh = (type: number, src: string) => {
        const s = g.createShader(type)!
        g.shaderSource(s, src); g.compileShader(s)
        if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'shader')
        return s
      }
      const pr = g.createProgram()!
      g.attachShader(pr, sh(g.VERTEX_SHADER, VERT)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(pr)
      if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(pr) ?? 'link')
      g.useProgram(pr)
      g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
      const loc = g.getAttribLocation(pr, 'a'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
      g.clearColor(0, 0, 0, 0); g.disable(g.DEPTH_TEST); g.disable(g.BLEND)
      // Uniform cache, as in the clan: a value that did not change is not sent again.
      const locs: Record<string, WebGLUniformLocation | null> = {}, last: Record<string, number | Float32Array> = {}
      const UL = (n: string) => (n in locs ? locs[n] : (locs[n] = g.getUniformLocation(pr, n)))
      const same = (a: Float32Array, b: number | Float32Array | undefined) => {
        if (!b || typeof b === 'number' || a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
        return true
      }
      U = {
        f1(n, v) { if (last[n] === v) return; last[n] = v; g.uniform1f(UL(n), v); ENG.uploads++ },
        v(n, size, arr) {
          const l = last[n]
          if (same(arr, l)) return
          if (l && typeof l !== 'number' && l.length === arr.length) l.set(arr); else last[n] = Float32Array.from(arr)
          if (size === 2) g.uniform2fv(UL(n), arr); else if (size === 3) g.uniform3fv(UL(n), arr); else g.uniform4fv(UL(n), arr)
          ENG.uploads++
        },
      }
      const dbg = g.getExtension('WEBGL_debug_renderer_info')
      ENG.renderer = String(dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER))
      ENG.soft = SOFT.test(ENG.renderer) // software rendering: pixel ratio 1, drawn at CSS size
      return (ENG.ok = true)
    } catch (e) {
      ENG.reason = 'shader failed: flat SVG (' + (e as Error).message + ')'
      gl = null
      return (ENG.ok = false)
    }
  }
  function init(): boolean {
    const w = W(), nav = w.navigator as Navigator & { connection?: { saveData?: boolean } }
    const reducedData = w.matchMedia('(prefers-reduced-data: reduce)').matches || !!(nav && nav.connection && nav.connection.saveData)
    if (reducedData) { ENG.reason = 'reduced data: flat SVG'; return false }
    glcv = w.document.createElement('canvas'); glcv.width = AW; glcv.height = AH
    glcv.addEventListener('webglcontextlost', e => {
      e.preventDefault(); ENG.ok = false; ENG.lost = true; ENG.reason = 'WebGL context lost: flat SVG'
      for (const c of ALL) c.wrap.removeAttribute('data-orb')
      for (const c of ALL) c.shown = false
      publish(); epoch++; for (const f of [...listeners]) f()
    }) // the flat SVG shows again
    glcv.addEventListener('webglcontextrestored', () => {
      if (build()) { ENG.lost = false; ENG.reason = ''; wake(); publish(); epoch++; for (const f of [...listeners]) f() }
    }) // and the 3D comes back, circle by circle, at its next drawn frame
    return build()
  }
  /** Started by the first circle, not at load: a page that never draws one never makes a context. */
  function ensure(): boolean {
    if (phase) return phase > 0
    phase = -1
    try {
      const w = W()
      if (typeof w.document === 'undefined' || typeof w.matchMedia !== 'function' || typeof w.requestAnimationFrame !== 'function') { ENG.reason = 'no browser: flat SVG'; publish(); return false }
      lastWall = nowS()
      const rm = w.matchMedia('(prefers-reduced-motion: reduce)')
      motion.reduce = rm.matches
      if (!init()) { publish(); return false }
      phase = 1
      const onRm = (e: MediaQueryListEvent) => { motion.reduce = e.matches; wake() }
      rm.addEventListener('change', onRm); undo.push(() => rm.removeEventListener('change', onRm))
      const dk = w.matchMedia('(prefers-color-scheme: dark)')
      dk.addEventListener('change', readTheme); undo.push(() => dk.removeEventListener('change', readTheme))
      if (typeof w.MutationObserver === 'function') {
        const mo = new w.MutationObserver(readTheme)
        mo.observe(w.document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-color-scheme'] })
        undo.push(() => mo.disconnect())
      }
      if (typeof w.IntersectionObserver === 'function') {
        io = new w.IntersectionObserver(es => {
          for (const e of es) {
            const c = BYWRAP.get(e.target)
            if (c) { c.vis = e.isIntersecting; if (c.vis) c.wakeUntil = nowS() + 0.5 }
          }
        }, { rootMargin: '40px' })
        undo.push(() => { io?.disconnect(); io = null })
      }
      const vis = () => { lastWall = nowS(); lastFrame = 0; wake() }
      w.document.addEventListener('visibilitychange', vis); undo.push(() => w.document.removeEventListener('visibilitychange', vis))
      wireWindow()
      publish()
      rafId = w.requestAnimationFrame(frame)
      return true
    } catch (e) { ENG.reason = 'flat SVG (' + (e as Error).message + ')'; ENG.ok = false; publish(); return false }
  }

  // ── the pointer: one, window-wide; every circle leans toward it, no click, no radius cutoff ──
  const pressedAny = () => ALL.some(c => c.I.drag)
  function track(e: PointerEvent) {
    if (e.pointerType === 'touch' && !pressedAny()) return
    PTR.clientX = e.clientX; PTR.clientY = e.clientY; PTR.dirty = true
    const t = nowS() + 0.35
    for (const c of ALL) if (c.vis && c.wakeUntil < t) c.wakeUntil = t
  }
  function releaseAll(e?: PointerEvent) {
    for (const c of ALL) if (c.I.drag) { c.I.drag = null; addRipple(c, c.I.ox * 0.3, c.I.oy * 0.3, 0.8); c.wakeUntil = nowS() + 1 }
    if (e && e.pointerType === 'touch') { PTR.clientX = null; PTR.clientY = null; for (const c of ALL) c.I.ptr = null }
  }
  function wireWindow() {
    const w = W()
    const on = <K extends string>(t: EventTarget, k: K, f: (e: never) => void, o?: AddEventListenerOptions | boolean) => {
      t.addEventListener(k, f as EventListener, o); undo.push(() => t.removeEventListener(k, f as EventListener, o))
    }
    on(w, 'pointermove', track, { passive: true })
    if ('onpointerrawupdate' in w) on(w, 'pointerrawupdate', track, { passive: true })
    on(w, 'pointerup', releaseAll, true); on(w, 'pointercancel', releaseAll, true)
    on(w, 'blur', () => releaseAll())
    const dirty = () => { PTR.dirty = true; wake() }
    on(w, 'scroll', dirty, { passive: true, capture: true }); on(w, 'resize', dirty)
    on(w.document, 'pointerleave', () => { if (!pressedAny()) { PTR.clientX = null; PTR.clientY = null; for (const c of ALL) c.I.ptr = null } })
  }

  // ── a circle ──
  function geometry(c: Circle, size: number) {
    c.size = size; c.k = clamp(size / 100, 0.4, 1)
    c.R0 = (size / 2 / c.k - 9) / (1 + GAP_K + 0.2)
  }
  function fresh(host: OrbHost, spec: OrbSpec, A: Agent): Circle {
    const c: Circle = {
      wrap: host.wrap, cv: host.canvas, ctx: host.canvas.getContext('2d'), size: spec.size, k: 1, css: 1, A, act: spec.activity, steps: spec.steps ?? null,
      slot: spec.slot, settled: false, attached: true, inAll: false, shown: false, goneAt: 0,
      mt: Math.random() * 30, energy: 1, vis: true, wakeUntil: nowS() + 2.5, acc: 0, last: 0, ax: 0, ay: 0, d: 0, R0: 50, dir: [1, 0],
      RING: { v: Float32Array.from(STYLE.work), c: new Float32Array(3), swell: 0, rt: 0, ringR: 0, len: L_MIN, ang: Math.random() },
      I: { press: 0, ox: 0, oy: 0, vx: 0, vy: 0, hov: 0, light: [0, 0], ptr: null, drag: null, rips: [], ripI: 0, R: 50, busy: false, ripOn: 0 },
      rip: new Float32Array(16),
    }
    geometry(c, spec.size)
    return c
  }
  const styleName = (c: Circle) => (ACTIVITIES.has(c.act) ? c.act : 'idle')
  function settleLook(c: Circle) {
    // Start eased at the target look, so a first paint does not animate in from "work".
    const s0 = styleName(c)
    if (COLORS[s0]) { c.RING.v.set(STYLE[s0]); c.RING.c.set(COLORS[s0]); c.RING.len = arcLength(c.act, c.steps) }
  }
  function localPt(c: Circle, e: { clientX: number; clientY: number }) {
    const r = c.wrap.getBoundingClientRect()
    const s = r.width > 0 ? (r.width / c.size) * c.k : c.k // the box may be styled smaller than its nominal size
    return { x: (e.clientX - r.left - r.width / 2) / s, y: (e.clientY - r.top - r.height / 2) / s }
  }
  function addRipple(c: Circle, x: number, y: number, amp: number) {
    c.I.rips[c.I.ripI++ % 4] = { x, y, t0: nowS(), amp: amp * (motion.reduce ? 0.4 : 1) }
  }
  function live(): number { let n = 0; for (const c of ALL) if (c.attached) n++; return n }

  /** Give a circle's element the 3D look, or return null and leave it flat. */
  function attach(host: OrbHost, spec: OrbSpec): OrbHandle | null {
    if (!host || !host.wrap || !host.canvas || !ACTIVITIES.has(spec.activity)) return null
    if (!ensure() || !ENG.ok) return null
    const A = pseudoAgent(spec.agent)
    if (!A) return null // an unknown agent stays the flat neutral circle
    let c = SLOTS.get(spec.slot) ?? null
    // A slot is one place: a second live circle asking for it is a different circle and gets its own state.
    if (c && c.attached && c.wrap !== host.wrap && c.wrap.isConnected) c = null
    if (!c && live() >= MAX_LIVE) return null
    const now = nowS()
    if (c) {
      // The same place as before, at any size: keep the ring and the turn.
      c.wrap = host.wrap; c.cv = host.canvas; c.ctx = host.canvas.getContext('2d'); c.vis = true; c.wakeUntil = now + 2.5
      c.I.ptr = null; c.I.drag = null; c.I.rips.length = 0; c.shown = false; c.attached = true
      if (c.size !== spec.size) geometry(c, spec.size)
      c.A = A
    } else {
      c = fresh(host, spec, A)
      if (!SLOTS.has(spec.slot)) SLOTS.set(spec.slot, c)
    }
    c.act = spec.activity; c.steps = spec.steps ?? null
    if (!themeEl || !themeEl.isConnected) themeEl = host.wrap
    if (!COLORS.work) readTheme()
    if (!c.inAll && !c.settled) { settleLook(c); c.settled = true }
    BYWRAP.set(host.wrap, c)
    if (PTR.clientX != null) c.I.ptr = localPt(c, { clientX: PTR.clientX, clientY: PTR.clientY ?? 0 })
    io?.observe(host.wrap)
    if (!c.inAll) { c.inAll = true; ALL.push(c) }
    wakeAll = true
    const mine = c
    return {
      update(s) {
        if (!ACTIVITIES.has(s.activity)) return
        const A2 = pseudoAgent(s.agent)
        if (A2) mine.A = A2
        mine.act = s.activity; mine.steps = s.steps ?? null
        if (mine.size !== s.size) geometry(mine, s.size)
        mine.wakeUntil = nowS() + 2.5; wakeAll = true
      },
      kick() { addRipple(mine, 0, 0, 1); mine.wakeUntil = nowS() + 2.5; wakeAll = true },
      press(x, y) { return press(mine, x, y) },
      detach() {
        mine.attached = false; mine.goneAt = nowS()
        io?.unobserve(mine.wrap); BYWRAP.delete(mine.wrap)
        mine.wrap.removeAttribute('data-orb')
        const i = ALL.indexOf(mine); if (i >= 0) ALL.splice(i, 1)
        mine.inAll = false
      },
    }
  }

  /** Upgrade every `[data-orb-host]` under `root`; `stateFor` may add steps per element. Returns the handles. */
  function scan(root: ParentNode | null, stateFor?: (el: HTMLElement) => Partial<OrbSpec> | null | undefined): OrbHandle[] {
    if (!root || typeof root.querySelectorAll !== 'function') return []
    const out: OrbHandle[] = []
    root.querySelectorAll<HTMLElement>('[data-orb-host]').forEach(el => {
      const canvas = el.querySelector('canvas')
      if (!canvas) return
      const base: OrbSpec = {
        agent: el.getAttribute('data-orb-agent') ?? '', activity: (el.getAttribute('data-orb-activity') ?? 'idle') as OrbActivity,
        size: +(el.getAttribute('data-orb-size') ?? 0) || 60, slot: el.getAttribute('data-orb-slot') ?? '',
      }
      const h = attach({ wrap: el, canvas }, { ...base, ...(stateFor?.(el) ?? {}) })
      if (h) out.push(h)
    })
    return out
  }

  function press(c: Circle, x: number, y: number): boolean {
    if (ENG.flat || !ENG.ok || !c.attached) return false
    const q = localPt(c, { clientX: x, clientY: y }), m = Math.hypot(q.x, q.y), lim = c.I.R * 0.9
    if (m > lim) { q.x *= lim / m; q.y *= lim / m }
    PTR.clientX = x; PTR.clientY = y; PTR.dirty = true
    c.I.ptr = localPt(c, { clientX: PTR.clientX ?? 0, clientY: PTR.clientY ?? 0 }); c.I.drag = { sx: q.x, sy: q.y }
    addRipple(c, q.x, q.y, 1); c.wakeUntil = nowS() + 2.5; wakeAll = true
    return true
  }

  // ── interaction, per circle (pointer and ripples are relative to the circle's centre) ──
  function interact(c: Circle, dt: number, wall: number) {
    const I = c.I, rm = motion.reduce, R = I.R, p = I.ptr
    let tx = 0, ty = 0, lt0 = 0, lt1 = 0, near = false
    if (p) {
      const d = Math.hypot(p.x, p.y), ux = d > 1e-6 ? p.x / d : 0, uy = d > 1e-6 ? p.y / d : 0, hit = R * 1.35
      const s = FOLLOW_FLOOR + (1 - FOLLOW_FLOOR) * Math.exp(-d / (R * FOLLOW_REACH)) // smooth falloff, never zero
      near = d < hit
      if (!rm) {
        const m = R * FOLLOW_MAX * s * Math.min(1, d / (R * 0.5)); tx = ux * m; ty = uy * m
        const k = Math.min(1, d / hit) * (0.6 + 0.4 * s) * 0.9; lt0 = ux * k; lt1 = uy * k
      } else if (near) { lt0 = (p.x / hit) * 0.9; lt1 = (p.y / hit) * 0.9 }
      if (I.drag && !rm) {
        let dx = (p.x - I.drag.sx) * 0.6, dy = (p.y - I.drag.sy) * 0.6
        const m = Math.hypot(dx, dy), max = R * 0.22
        if (m > max) { dx *= max / m; dy *= max / m }
        tx += dx; ty += dy
        const t = Math.hypot(tx, ty), mt = R * 0.3
        if (t > mt) { tx *= mt / t; ty *= mt / t }
      }
    }
    I.vx += (-170 * (I.ox - tx) - 10 * I.vx) * dt; I.vy += (-170 * (I.oy - ty) - 10 * I.vy) * dt; I.ox += I.vx * dt; I.oy += I.vy * dt
    I.press += (((I.drag && !rm) ? 1 : 0) - I.press) * (1 - Math.exp(-dt * (I.drag ? 22 : 9)))
    I.hov += ((near ? 1 : 0) - I.hov) * (1 - Math.exp(-dt * 8))
    const lk = 1 - Math.exp(-dt * 6)
    I.light[0] += (lt0 - I.light[0]) * lk; I.light[1] += (lt1 - I.light[1]) * lk
    let alive = 0
    for (let i = 0; i < 4; i++) { const r = I.rips[i]; if (r && wall - r.t0 < 3.2) alive = 1 }
    I.ripOn = alive
    I.busy = !!(I.drag || alive || Math.abs(I.vx) + Math.abs(I.vy) + Math.abs(I.ox - tx) + Math.abs(I.oy - ty) > 0.05
      || (I.hov > 0.01 && I.hov < 0.99) || Math.abs(I.light[0] - lt0) + Math.abs(I.light[1] - lt1) > 0.002 || Math.abs(I.press) > 0.003)
  }

  // ── one circle into its atlas cell ──
  function renderOne(c: Circle, dt: number, wall: number, dpr: number) {
    if (!gl || !U) return
    const rm = motion.reduce, I = c.I, RING = c.RING, A = c.A
    const err = c.act === 'error'
    const eT = (err || c.act === 'human') ? 0.3 : 1
    c.energy += (eT - c.energy) * Math.min(1, dt * 3)
    if (!rm) c.mt += dt * c.energy
    const mt = c.mt, uDpr = dpr * c.k, half = c.d / uDpr / 2
    const cx = c.ax / uDpr + half, cy = c.ay / uDpr + half
    const R = c.R0 * (1 + 0.035 * I.hov) * (1 - 0.08 * I.press); I.R = R

    poseSpan(A, rm ? 0 : mt, PA, CA); writeStatic(PA, CA)
    for (let i = 0; i < 4; i++) wob[i] = A.t.wob[i] * (rm ? 0 : 1)
    const breath = 1 + (rm ? 0 : A.t.breath * Math.sin(mt * 2.4 * A.sp))
    const off = Math.hypot(I.ox, I.oy), dragOn = off > 1
    if (dragOn) { DIRV[0] = I.ox / off; DIRV[1] = I.oy / off }
    const dir = dragOn ? DIRV : c.dir
    const slosh = rm ? 0 : (dragOn ? off / (R * 1.6) : 0)

    const ek = 1 - Math.exp(-dt * 6), sName = styleName(c), T = STYLE[sName], tc = COLORS[sName] ?? COLORS.work ?? new Float32Array(3)
    for (let i = 0; i < 10; i++) RING.v[i] += (T[i] - RING.v[i]) * ek
    for (let i = 0; i < 3; i++) RING.c[i] += (tc[i] - RING.c[i]) * ek
    RING.swell += (0 - RING.swell) * ek
    RING.rt += dt * (rm ? 0 : 1)
    RING.len += (arcLength(c.act, c.steps) - RING.len) * (1 - Math.exp(-dt * 3))
    if (!rm) RING.ang += (dt * RING.v[9]) / 360
    const ringPad = R * (Math.abs(wob[0]) + Math.abs(wob[1]) + Math.abs(wob[2]) + Math.abs(wob[3]) + Math.abs(slosh) + Math.max(0, breath - 1))
    RING.ringR = Math.min(R + GAP_K * R + ringPad, half - 8) // PORT: clamped so the ring never leaves the circle's box

    gl.viewport(c.ax, AH - c.ay - c.d, c.d, c.d)
    v2[0] = AW; v2[1] = AH; U.v('uRes', 2, v2); U.f1('uDpr', uDpr)
    v2[0] = cx + I.ox; v2[1] = cy + I.oy; U.v('uC', 2, v2); v2[0] = cx; v2[1] = cy; U.v('uRC', 2, v2)
    U.f1('uR', R); v2[0] = dir[0]; v2[1] = dir[1]; U.v('uDir', 2, v2); U.v('uWob', 4, wob)
    U.f1('uTime', mt); U.f1('uBreath', breath); U.f1('uP', 0); U.f1('uTw', 0); U.f1('uSlosh', slosh)
    U.f1('uRingR', RING.ringR); U.f1('uRT', RING.rt); U.f1('uSwell', RING.swell); U.f1('uPingOn', 0)
    U.v('uBaseA', 3, A.base); U.v('uInkA', 3, A.ink); U.v('uMatA', 3, A.mat); U.v('uBaseB', 3, A.base); U.v('uInkB', 3, A.ink); U.v('uMatB', 3, A.mat)
    U.v('uAccent', 3, accV); U.v('uRingCol', 3, RING.c); U.v('uBg', 3, bgV); U.v('uTrack', 3, trackV)
    U.v('uArc0', 4, arc0); U.v('uArc1', 4, arc1); U.v('uCir0', 4, cir0); U.v('uCir1', 4, cir1)
    const rip = c.rip
    for (let i = 0; i < 4; i++) {
      const r = I.rips[i], q = i * 4
      if (r) { rip[q] = cx + r.x; rip[q + 1] = cy + r.y; rip[q + 2] = wall - r.t0; rip[q + 3] = r.amp } else { rip[q] = 0; rip[q + 1] = 0; rip[q + 2] = -1; rip[q + 3] = 0 }
    }
    U.v('uRip', 4, rip); U.f1('uRipOn', I.ripOn ? 1 : 0); v2[0] = I.light[0]; v2[1] = I.light[1]; U.v('uLight', 2, v2)
    rs[0] = RING.v[0]; rs[1] = RING.v[1]; rs[2] = RING.v[2]; rs[3] = RING.v[3]; U.v('uRS', 4, rs)
    rf[0] = RING.v[4]; rf[1] = RING.v[5]; rf[2] = RING.v[6]; rf[3] = RING.v[7]; U.v('uRFx', 4, rf)
    rg[0] = RING.len; rg[1] = RING.ang - Math.floor(RING.ang); rg[2] = RING.v[8]; U.v('uRG', 4, rg); pingV.fill(-1); U.v('uPing', 4, pingV)
    gl.drawArrays(gl.TRIANGLES, 0, 3); ENG.draws++; ENG.px += c.d * c.d
  }

  // ── the frame: pack the circles that need drawing into the atlas, draw each, copy each cell to its canvas ──
  function flush() {
    for (let i = 0; i < nBatch; i++) {
      const c = BATCH[i]
      if (c.cv.width !== c.d) { c.cv.width = c.cv.height = c.d }
      if (c.ctx && glcv) {
        c.ctx.globalCompositeOperation = 'copy'
        c.ctx.drawImage(glcv, c.ax, c.ay, c.d, c.d, 0, 0, c.d, c.d)
      }
      if (!c.shown) { c.shown = true; if (!ENG.flat) c.wrap.setAttribute('data-orb', 'on') } // the canvas has its first picture: cross-fade from the flat one
    }
    nBatch = 0; ENG.flushes++
  }
  function frame(nowMs: number) {
    const w = W()
    rafId = w.requestAnimationFrame(frame)
    step(nowMs)
  }
  /** One frame. Public so a test can drive the clock. */
  function step(nowMs: number) {
    if (!ENG.ok || ENG.flat || !glcv) return
    const wall = nowMs / 1000, dt = Math.max(0, Math.min(0.05, wall - lastWall)); lastWall = wall
    const t0 = performance.now()
    let n = 0
    for (let i = ALL.length - 1; i >= 0; i--) {
      const c = ALL[i]
      if (!c.wrap.isConnected) { io?.unobserve(c.wrap); c.inAll = false; c.attached = false; c.goneAt = wall; ALL.splice(i, 1); continue }
      if (PTR.clientX != null && c.vis && (PTR.dirty || c.I.busy || wall < c.wakeUntil)) c.I.ptr = localPt(c, { clientX: PTR.clientX, clientY: PTR.clientY ?? 0 })
      interact(c, dt, wall); c.acc += dt
      // Idle and untouched: about 15 fps. Everything else every frame. Reduced motion: only when something changes.
      const calm = !c.I.busy && wall >= c.wakeUntil
      const due = !calm || (!motion.reduce && (c.act !== 'idle' || (wall - c.last) * 1000 >= IDLE_MS))
      if (c.vis && (wakeAll || due)) LIST[n++] = c
    }
    // A slot nobody reattached for a while is forgotten.
    for (const [k, c] of SLOTS) if (!c.attached && wall - c.goneAt > 30) SLOTS.delete(k)
    wakeAll = false; PTR.dirty = false
    if (!n) { ENG.skipped++; lastFrame = 0; return }
    if (lastFrame) {
      const ms = nowMs - lastFrame; ENG.avgMs += (ms - ENG.avgMs) * 0.05
      if (!ENG.soft && ++govN > 45) {
        govN = 0
        if (ENG.avgMs > 26 && ENG.scale > 0.6) ENG.scale = Math.max(0.6, ENG.scale - 0.15)
        else if (ENG.avgMs < 14 && ENG.scale < 1) ENG.scale = Math.min(1, ENG.scale + 0.1)
      }
    }
    lastFrame = nowMs
    const dpr = ENG.soft ? 1 : Math.min(W().devicePixelRatio || 1, 2) * ENG.scale // a software renderer draws at CSS size
    ENG.dpr = dpr
    ENG.uploads = 0; ENG.draws = 0; ENG.flushes = 0; ENG.px = 0; ENG.drawn = n
    // The atlas is sized to what is drawn (a big idle buffer costs a full-buffer copy on software renderers).
    let x = 0, y = 0, shelf = 0, needW = 0
    for (let i = n - 1; i >= 0; i--) {
      const d = Math.max(1, Math.round(LIST[i].size * dpr))
      if (x + d > MAXW) { x = 0; y += shelf; shelf = 0 }
      x += d; if (x > needW) needW = x; if (d > shelf) shelf = d
    }
    const needH = Math.min(MAXH, y + shelf)
    if (needW > AW || needH > AH || needW < AW / 2 || needH < AH / 2) { AW = Math.max(64, needW); AH = Math.max(64, needH); glcv.width = AW; glcv.height = AH }
    x = 0; y = 0; shelf = 0
    for (let i = n - 1; i >= 0; i--) {
      const c = LIST[i], d = Math.max(1, Math.round(c.size * dpr))
      if (x + d > AW) { x = 0; y += shelf; shelf = 0 }
      if (y + d > AH) { flush(); x = 0; y = 0; shelf = 0 }
      c.ax = x; c.ay = y; c.d = d
      renderOne(c, c.acc, wall, dpr); c.acc = 0; c.last = wall
      BATCH[nBatch++] = c
      x += d; if (d > shelf) shelf = d
    }
    flush()
    const cpu = performance.now() - t0; ENG.cpuMs += (cpu - ENG.cpuMs) * 0.1; ENG.frames++
    fpsN++; if (wall - fpsT >= 0.5) { ENG.fps = fpsN / (wall - fpsT); fpsN = 0; fpsT = wall }
  }

  function wake() { wakeAll = true; const t = nowS() + 2.5; for (const c of ALL) c.wakeUntil = t }

  return {
    attach,
    scan,
    /** Subscribe to the engine losing or getting its context back; returns the unsubscribe. */
    onChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } },
    /** Counts losses and restorations of the context. */
    epoch: () => epoch,
    /**
     * Can circles be drawn in 3D now (WebGL is up)? Starts the engine on the first ask, so a page that
     * never shows a circle never makes a context. A circle renders its canvas only when this is true,
     * so a page without WebGL has no canvas in it at all.
     */
    canDraw(): boolean { return ensure() && ENG.ok },
    ensure,
    /** A press from the keyboard on a circle's host element: the same ripple a pointer press makes. */
    kick(el: Element | null) { const c = el && BYWRAP.get(el); if (c) { addRipple(c, 0, 0, 1); c.wakeUntil = nowS() + 2.5; wakeAll = true } },
    /** A press at a screen point on a circle's host element. */
    press(el: Element | null, x: number, y: number): boolean { const c = el && BYWRAP.get(el); return c ? press(c, x, y) : false },
    /** 3D is showing (WebGL is up and not forced flat). */
    ok: () => ENG.ok && !ENG.flat,
    hasGL: () => ENG.ok,
    isReduced: () => motion.reduce,
    setFlat(v: boolean) {
      ENG.flat = !!v
      for (const c of ALL) { if (ENG.flat) { c.wrap.removeAttribute('data-orb'); c.shown = false } }
      if (!ENG.flat) wake()
      publish()
    },
    setReduce(v: boolean) { motion.reduce = !!v; wake() },
    /** What a circle's pointer state is, for tests. */
    tilt(el: Element | null) { const c = el && BYWRAP.get(el); return c ? { ox: c.I.ox, oy: c.I.oy, lx: c.I.light[0], ly: c.I.light[1], press: c.I.press, hov: c.I.hov, drag: !!c.I.drag } : null },
    stats(): OrbStats { return { ...ENG, circles: ALL.length, slots: SLOTS.size, reduce: motion.reduce } },
    step,
    /** Stop the loop and take every listener off. Tests; the shell's one engine lives as long as the page. */
    dispose() {
      if (rafId) { try { W().cancelAnimationFrame?.(rafId) } catch { /* none */ } rafId = 0 }
      for (const f of undo.splice(0)) f()
      ALL.length = 0; SLOTS.clear(); phase = -1
    },
  }
}

export type Orbs = ReturnType<typeof createOrbs>

let one: Orbs | null = null
/** The shell's one engine: one WebGL context for every circle. */
export function shared(): Orbs { return one ?? (one = createOrbs()) }
