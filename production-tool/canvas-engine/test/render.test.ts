// The renderer core and the memory caps (features/engine-ci.clan): the bitmap
// LRU never holds more than its cap, the renderer draws only what the view
// shows, builds a stroke's outline once, and hit-tests the topmost element.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints } from '../src/model/points'
import { element } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { BitmapCache } from '../src/render/bitmaps'
import { backingBytes, deviceClass, drawDpr, MAX_DPR } from '../src/render/caps'
import { Renderer, type DrawContext, type PathLike } from '../src/render/renderer'
import { LIGHT_INK } from '../src/ink/palette'

const bm = (w: number, h: number) => {
  const b = { width: w, height: h, closed: false, close() { b.closed = true } }
  return b
}

describe('BitmapCache', () => {
  it('evicts the least recently used by bytes and never passes its cap', () => {
    const c = new BitmapCache(3 * 100 * 100 * 4)
    const a = bm(100, 100)
    c.put('a', 'full', a)
    c.put('b', 'full', bm(100, 100))
    c.put('c', 'full', bm(100, 100))
    c.get('a', 'full') // a is now the most recent
    c.put('d', 'full', bm(100, 100))
    expect(c.get('b', 'full')).toBeUndefined()
    expect(c.get('a', 'full')).toBe(a)
    expect(c.bytes()).toBeLessThanOrEqual(c.cap)
    expect(c.peak).toBeLessThanOrEqual(c.cap)
  })

  it('does not keep a bitmap larger than the cap, and closes what it drops', () => {
    const c = new BitmapCache(100)
    const big = bm(100, 100)
    expect(c.put('x', 'full', big)).toBe(false)
    expect(big.closed).toBe(true)
    expect(c.size()).toBe(0)
  })
})

describe('caps', () => {
  it('draw at most at ratio 2, with canvases at viewport size', () => {
    expect(drawDpr(3)).toBe(MAX_DPR)
    expect(drawDpr(0)).toBe(1)
    expect(backingBytes({ width: 100, height: 50 }, 3, 1)).toBe(200 * 100 * 4)
  })

  it('an iPad gets the smaller cache', () => {
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })).toBe('ipad')
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('ipad')
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 })).toBe('desktop')
  })
})

describe('Renderer', () => {
  function setup() {
    const store = new SceneStore(new Y.Doc())
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 20, y: 10, pressure: 0.6 }, { x: 40, y: 0, pressure: 0.5 }], { x: 0, y: 0 })
    store.seed([
      element({ id: 'near', kind: 'stroke', z: 'a1', x: 10, y: 10, w: 40, h: 10, style: { width: 3 } }),
      element({ id: 'far', kind: 'shape', z: 'a2', x: 5000, y: 5000, w: 10, h: 10, props: { geo: 'rect' } }),
      element({ id: 'top', kind: 'shape', z: 'a3', x: 0, y: 0, w: 100, h: 100, props: { geo: 'ellipse' } }),
      element({ id: 'node', kind: 'node', z: 'a4', x: 0, y: 0, w: 100, h: 100 }),
    ], { near: pts })
    let built = 0
    const r = new Renderer(store, {
      newPath: (): PathLike => {
        built++
        return { moveTo() {}, lineTo() {}, closePath() {} }
      },
      bitmap: () => undefined,
    })
    const ctx = new Proxy({} as DrawContext, { get: (_t, k) => (k === 'lineWidth' || k === 'globalAlpha' ? 1 : () => {}), set: () => true })
    return { store, r, ctx, built: () => built }
  }

  it('draws only what the view shows, never a node, and builds an outline once', () => {
    const { r, ctx, built } = setup()
    const s1 = r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    expect(s1.drawn).toBe(2)
    expect(s1.culled).toBe(1)
    expect(s1.pathsBuilt).toBe(1)
    const s2 = r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    expect(s2.pathsBuilt).toBe(0)
    expect(built()).toBe(1)
  })

  it('follows the scene: a moved element is culled where it went', () => {
    const { store, r, ctx } = setup()
    store.change((tx) => tx.put([{ ...tx.get('top')!, x: 9000 }]))
    expect(r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1).drawn).toBe(1)
  })

  it('turns a picture about its centre, draws a stacked one as a photo, and glides a tween in between', () => {
    const store = new SceneStore(new Y.Doc())
    store.seed([
      element({ id: 'p', kind: 'image', z: 'a1', x: 0, y: 0, w: 100, h: 200, rotation: 0.2, props: { assetSha: null, status: 'saved', stack: { dx: 0, dy: 0, angle: 0 } } }),
      element({ id: 'q', kind: 'image', z: 'a2', x: 300, y: 0, w: 100, h: 200, props: { assetSha: null, status: 'saved' } }),
    ], {})
    const r = new Renderer(store, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
    const calls: string[] = []
    const ctx = new Proxy({} as DrawContext, {
      get: (_t, k) => (k === 'lineWidth' || k === 'globalAlpha' ? 1 : (...a: unknown[]) => { calls.push(`${String(k)}(${a.map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : '')).join(',')})`) }),
      set: () => true,
    })
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    // p: about its centre (50, 100), a shadow and a white edge before the picture; q: as it lies.
    expect(calls).toContain('rotate(0.2)')
    expect(calls).toContain('translate(50,100)')
    expect(calls.filter((c) => c.startsWith('rotate'))).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith('fillRect')).length).toBe(1 + 2 + 2)
    // A tween from 200 px to the left at t0: drawn at the start, gone once it ends.
    r.tween = { from: new Map([['q', { x: 100, y: 0, rotation: 0 }]]), t0: 1000, ms: 300 }
    expect(r.tweened(store.get('q')!, 1000).x).toBe(100)
    expect(r.tweened(store.get('q')!, 1150).x).toBeGreaterThan(200)
    expect(r.tweened(store.get('q')!, 1300).x).toBe(300)
    expect(r.animating(1100)).toBe(true)
    expect(r.animating(1400)).toBe(false)
  })

  it('hit-tests the topmost element under a point', () => {
    const { r } = setup()
    expect(r.hit(20, 12)?.id).toBe('top')
    expect(r.hit(5005, 5005)?.id).toBe('far')
    expect(r.hit(-50, -50)).toBeUndefined()
  })

  it('draws boards in the look the host gives (rounded, filled, the current one in its colour) over a transparent background', () => {
    const store = new SceneStore(new Y.Doc())
    store.seed([
      element({ id: 'b1', kind: 'board', z: 'a1', x: 0, y: 0, w: 300, h: 200, props: { name: 'Script', purpose: 'script' } }),
      element({ id: 'b2', kind: 'board', z: 'a2', x: 400, y: 0, w: 300, h: 200, props: { name: 'Video', purpose: 'video' } }),
    ], {})
    const r = new Renderer(store, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
    const calls: string[] = []
    const strokes: unknown[] = []
    const ctx = new Proxy({} as DrawContext, {
      get: (t, k) => (k in t ? (t as never)[k] : k === 'lineWidth' || k === 'globalAlpha' ? 1 : (...a: unknown[]) => { calls.push(`${String(k)}${k === 'fillText' ? `:${a[0]}` : ''}`) }),
      set: (_t, k, v) => {
        if (k === 'strokeStyle') strokes.push(v)
        return true
      },
    })
    r.boardLook = { fill: 'rgba(255,255,255,0.55)', stroke: '#D6DAE2', current: '#2F64F5', radius: 16, title: '#4A4F5C', titleBg: '#FAFAFB' }
    r.currentBoard = 'b2'
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1, 'transparent')
    expect(calls[1]).toBe('clearRect')
    expect(calls).not.toContain('strokeRect')
    expect(calls.filter((c) => c === 'ellipse')).toHaveLength(8)
    expect(calls).toContain('fillText:Script')
    expect(strokes).toEqual(['#D6DAE2', '#2F64F5'])
  })

  it('paints a stroke\'s ink name in the host\'s theme, a literal as is, and no colour as ink', () => {
    const store = new SceneStore(new Y.Doc())
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 20, y: 10, pressure: 0.5 }], { x: 0, y: 0 })
    store.seed([
      element({ id: 's1', kind: 'stroke', z: 'a1', x: 0, y: 0, w: 20, h: 10, style: { stroke: 'ink', width: 3 } }),
      element({ id: 's2', kind: 'stroke', z: 'a2', x: 0, y: 20, w: 20, h: 10, style: { stroke: 'orange', width: 3 } }),
      element({ id: 's3', kind: 'stroke', z: 'a3', x: 0, y: 40, w: 20, h: 10, style: { stroke: '#a33b2b', width: 3 } }),
      element({ id: 's4', kind: 'stroke', z: 'a4', x: 0, y: 60, w: 20, h: 10, style: { width: 3 } }),
    ], { s1: pts, s2: pts, s3: pts, s4: pts })
    const r = new Renderer(store, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
    const fills: unknown[] = []
    const ctx = new Proxy({} as DrawContext, {
      get: (_t, k) => (k === 'lineWidth' || k === 'globalAlpha' ? 1 : () => {}),
      set: (_t, k, v) => {
        if (k === 'fillStyle') fills.push(v)
        return true
      },
    })
    const cam = { scrollX: 0, scrollY: 0, zoom: 1 }
    r.draw(ctx, cam, { width: 800, height: 600 }, 1, 'transparent')
    expect(fills).toEqual([LIGHT_INK.ink, LIGHT_INK.orange, '#a33b2b', LIGHT_INK.ink])
    fills.length = 0
    r.inkPalette = { ...LIGHT_INK, ink: '#F2F3F5', orange: '#FF7A5C' }
    r.draw(ctx, cam, { width: 800, height: 600 }, 1, 'transparent')
    expect(fills).toEqual(['#F2F3F5', '#FF7A5C', '#a33b2b', '#F2F3F5'])
  })
})

describe('the selection frame and scaling (canvas-edit-tools)', () => {
  const recorder = () => {
    const calls: string[] = []
    const ctx = new Proxy({} as DrawContext, {
      get: (_t, k) => (k === 'lineWidth' || k === 'globalAlpha' ? 1 : (...a: unknown[]) => { calls.push(`${String(k)}${k === 'fillText' || k === 'setLineDash' ? `:${JSON.stringify(a[0])}` : k === 'scale' ? `:${JSON.stringify(a)}` : ''}`) }),
      set: () => true,
    })
    return { calls, ctx }
  }
  const setup = () => {
    const store = new SceneStore(new Y.Doc())
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 40, y: 20, pressure: 0.5 }], { x: 0, y: 0 })
    store.seed([
      element({ id: 's', kind: 'stroke', z: 'a1', x: 0, y: 0, w: 80, h: 40, groupIds: ['g'], props: { tool: 'pen' } }),
      element({ id: 'k', kind: 'sketch', z: 'a2', x: 200, y: 0, w: 160, h: 90, style: { fill: '#ffffff' }, props: { ratio: '16:9' } }),
    ], { s: pts })
    return new Renderer(store, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  }

  it('draws a scaled stroke at its box, and a sketch area says its ratio is locked', () => {
    const r = setup()
    const { calls, ctx } = recorder()
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    expect(calls).toContain('scale:[2,2]')
    expect(calls).toContain('fillText:"16:9 locked"')
  })

  it('a group frame is one dashed box with four handles and its label, in place of the members’ outlines', () => {
    const r = setup()
    r.selected = new Set(['s'])
    r.frame = { box: { x: 0, y: 0, w: 80, h: 40 }, dashed: true, handles: true, label: 'Ink · 1 stroke · one group' }
    const { calls, ctx } = recorder()
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    // The sketch area's own outline, the dashed box and four handles; no outline round the stroke.
    expect(calls.filter((c) => c === 'strokeRect')).toHaveLength(6)
    expect(calls).toContain('setLineDash:[5,4]')
    expect(calls).toContain('fillText:"Ink · 1 stroke · one group"')
  })

  it('a scale being dragged is drawn round its corner, nothing written', () => {
    const r = setup()
    r.scaling = { ids: new Set(['k']), ox: 200, oy: 0, s: 2 }
    const { calls, ctx } = recorder()
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    expect(calls).toContain('scale:[2,2]')
  })
})
