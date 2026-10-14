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
})
