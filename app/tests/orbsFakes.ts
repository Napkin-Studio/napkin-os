// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A pretend browser and a pretend WebGL, enough for the Orbs engine to run its
// frames without a GPU: the tests count what it asked of them. No DOM library:
// the engine reads the browser from globalThis at the moment it needs it.

type Fn = (...a: unknown[]) => unknown

export interface FakeGL {
  calls: string[]
  uniforms: Record<string, number | number[]>
  draws: Array<{ viewport: number[] }>
  compiled: number
  renderer: string
  failCompile: boolean
  [k: string]: unknown
}

export function fakeGL(opts: { renderer?: string; failCompile?: boolean } = {}): FakeGL {
  let vp = [0, 0, 0, 0]
  const gl: FakeGL = {
    calls: [], uniforms: {}, draws: [], compiled: 0, renderer: opts.renderer ?? 'ANGLE (Fake GPU)', failCompile: !!opts.failCompile,
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, DEPTH_TEST: 8, BLEND: 9, TRIANGLES: 10, RENDERER: 11,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => { gl.compiled++ },
    getShaderParameter: () => !gl.failCompile, getShaderInfoLog: () => 'fake compile error',
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
    useProgram: () => {}, bindBuffer: () => {}, createBuffer: () => ({}), bufferData: () => {},
    getAttribLocation: () => 0, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    clearColor: () => {}, disable: () => {}, getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 99 }),
    getParameter: (p: unknown) => (p === 99 ? gl.renderer : 'fake'),
    getUniformLocation: (_p: unknown, n: unknown) => String(n),
    uniform1f: (l: unknown, v: unknown) => { gl.uniforms[String(l)] = v as number },
    uniform2fv: (l: unknown, v: unknown) => { gl.uniforms[String(l)] = Array.from(v as ArrayLike<number>) },
    uniform3fv: (l: unknown, v: unknown) => { gl.uniforms[String(l)] = Array.from(v as ArrayLike<number>) },
    uniform4fv: (l: unknown, v: unknown) => { gl.uniforms[String(l)] = Array.from(v as ArrayLike<number>) },
    viewport: (...a: unknown[]) => { vp = a as number[] },
    drawArrays: () => { gl.draws.push({ viewport: vp }) },
  }
  return gl
}

export class FakeCanvas {
  width = 0
  height = 0
  gl: FakeGL | null
  copies: unknown[][] = []
  handlers: Record<string, Array<(e: unknown) => void>> = {}
  contexts: string[] = []
  constructor(gl: FakeGL | null) { this.gl = gl }
  getContext(kind: string) {
    this.contexts.push(kind)
    if (kind === 'webgl') return this.gl
    return { globalCompositeOperation: '', drawImage: (...a: unknown[]) => { this.copies.push(a) }, fillRect() {}, getImageData: () => ({ data: [214, 218, 226, 255] }), set fillStyle(_v: string) {} }
  }
  addEventListener(k: string, f: (e: unknown) => void) { (this.handlers[k] ??= []).push(f) }
  fire(k: string) { let stopped = false; for (const f of this.handlers[k] ?? []) f({ preventDefault: () => { stopped = true } }); return stopped }
}

export class FakeEl {
  attrs: Record<string, string> = {}
  isConnected = true
  rect = { left: 0, top: 0, width: 100, height: 100 }
  canvas = new FakeCanvas(null)
  style = { cssText: '' }
  getBoundingClientRect() { return this.rect }
  setAttribute(k: string, v: string) { this.attrs[k] = v }
  removeAttribute(k: string) { delete this.attrs[k] }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null }
  appendChild() {}
  remove() {}
  at(left: number, top: number, size = 100) { this.rect = { left, top, width: size, height: size }; return this }
}

export interface Browser {
  gl: FakeGL | null
  glCanvas: FakeCanvas
  media: Record<string, boolean>
  tokens: Record<string, string>
  frames: Array<(t: number) => void>
  events: Record<string, Array<(e: unknown) => void>>
  root: FakeEl
  io: Array<{ cb: (es: unknown[]) => void; observed: Set<unknown> }>
  canvasesMade: number
  fire(type: string, e?: Record<string, unknown>): void
  setMedia(q: string, v: boolean): void
  restore(): void
}

const KEYS = ['document', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'IntersectionObserver', 'MutationObserver',
  'addEventListener', 'removeEventListener', 'devicePixelRatio', 'navigator', 'onpointerrawupdate'] as const

/** Install a pretend browser on globalThis. `restore()` puts everything back. */
export function installBrowser(o: { gl?: FakeGL | null; media?: Record<string, boolean>; tokens?: Record<string, string>; dpr?: number; withIO?: boolean } = {}): Browser {
  const g = globalThis as unknown as Record<string, unknown>
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const k of KEYS) saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
  const set = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  const b: Browser = {
    gl: o.gl === undefined ? fakeGL() : o.gl, glCanvas: undefined as unknown as FakeCanvas,
    media: { ...(o.media ?? {}) },
    tokens: { '--lc-ring-work': '#FF4F2E', '--lc-ring-think': '#7A5AF8', '--lc-ring-read': '#B87100', '--lc-ring-check': '#238A55', '--lc-ring-human': '#E0560C', '--lc-ring-error': '#16191D', '--lc-ring-wait': '#9EA3AB', '--lc-ring-track': 'color-mix(in oklab, #000 16%, #fff)', '--card': '#FFFFFF', ...(o.tokens ?? {}) },
    frames: [], events: {}, root: new FakeEl(), io: [], canvasesMade: 0,
    fire(type, e = {}) { for (const f of b.events[type] ?? []) f({ type, ...e }) },
    setMedia(q, v) { b.media[q] = v; for (const l of mqls.filter(m => m.q === q)) for (const f of l.fns) f({ matches: v }) },
    restore() { for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete g[k] } },
  }
  const mqls: Array<{ q: string; fns: Array<(e: unknown) => void> }> = []
  set('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') { b.canvasesMade++; const c = new FakeCanvas(b.gl); b.glCanvas ??= c; return c }
      return new FakeEl()
    },
    documentElement: b.root,
    addEventListener: () => {}, removeEventListener: () => {},
  })
  set('matchMedia', (q: string) => {
    const m = { q, fns: [] as Array<(e: unknown) => void> }; mqls.push(m)
    return { get matches() { return !!b.media[q] }, addEventListener: (_: string, f: (e: unknown) => void) => { m.fns.push(f) }, removeEventListener: (_: string, f: (e: unknown) => void) => { m.fns = m.fns.filter(x => x !== f) } }
  })
  set('requestAnimationFrame', (f: (t: number) => void) => { b.frames.push(f); return b.frames.length })
  set('cancelAnimationFrame', () => {})
  set('getComputedStyle', () => ({ getPropertyValue: (n: string) => b.tokens[n] ?? '', color: 'rgb(214, 218, 226)' }))
  set('MutationObserver', class { observe() {} disconnect() {} })
  if (o.withIO !== false) {
    set('IntersectionObserver', class {
      rec = { cb: undefined as unknown as (es: unknown[]) => void, observed: new Set<unknown>() }
      constructor(cb: (es: unknown[]) => void) { this.rec.cb = cb; b.io.push(this.rec) }
      observe(el: unknown) { this.rec.observed.add(el) }
      unobserve(el: unknown) { this.rec.observed.delete(el) }
      disconnect() { this.rec.observed.clear() }
    })
  }
  set('addEventListener', (t: string, f: (e: unknown) => void) => { (b.events[t] ??= []).push(f) })
  set('removeEventListener', (t: string, f: (e: unknown) => void) => { b.events[t] = (b.events[t] ?? []).filter(x => x !== f) })
  set('devicePixelRatio', o.dpr ?? 2)
  delete g.navigator
  delete g.onpointerrawupdate
  return b
}

/** Run frames at 60 fps from `t0` ms for `n` frames through the engine's own step. */
export function run(step: (t: number) => void, t0: number, n: number): number {
  let t = t0
  for (let i = 0; i < n; i++) { t += 1000 / 60; step(t) }
  return t
}

export type { Fn }
