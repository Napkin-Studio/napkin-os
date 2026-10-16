// Masks as pixels (features/image-editor.clan): brush, eraser, lasso and soft edge, at any size.
import { describe, expect, it } from 'vitest'
import type { MaskOp } from './edits'
import { applyOp, bounds, edges, opSig, painted, rasterize, RasterCache } from './mask'

const at = (m: Uint8Array, w: number, x: number, y: number) => m[y * w + x]

describe('rasterize', () => {
  it('paints a brush dab of the given radius', () => {
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.1, soft: 0, pts: [{ x: 0.5, y: 0.5 }] }], 100, 100)
    expect(at(m, 100, 50, 50)).toBe(255)
    expect(at(m, 100, 50, 42)).toBe(255)
    expect(at(m, 100, 50, 30)).toBe(0)
  })
  it('the eraser (a subtract stroke) takes paint away', () => {
    const m = rasterize([
      { t: 'brush', mode: 'add', r: 0.2, soft: 0, pts: [{ x: 0.5, y: 0.5 }] },
      { t: 'brush', mode: 'sub', r: 0.05, soft: 0, pts: [{ x: 0.5, y: 0.5 }] },
    ], 100, 100)
    expect(at(m, 100, 50, 50)).toBe(0)
    expect(at(m, 100, 50, 35)).toBe(255)
  })
  it('a soft brush fades toward its edge', () => {
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.2, soft: 1, pts: [{ x: 0.5, y: 0.5 }] }], 100, 100)
    const centre = at(m, 100, 50, 50), mid = at(m, 100, 60, 50), edge = at(m, 100, 68, 50)
    expect(centre).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(edge)
    expect(edge).toBeGreaterThan(0)
  })
  it('a stroke covers the line between its points', () => {
    const m = rasterize([{ t: 'brush', mode: 'add', r: 0.03, soft: 0, pts: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] }], 100, 50)
    expect(at(m, 100, 50, 25)).toBe(255)
    expect(at(m, 100, 50, 10)).toBe(0)
  })
  it('a lasso fills its polygon, and a subtract lasso cuts one out', () => {
    const square = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }]
    const hole = [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }]
    const m = rasterize([{ t: 'lasso', mode: 'add', pts: square }, { t: 'lasso', mode: 'sub', pts: hole }], 100, 100)
    expect(at(m, 100, 25, 25)).toBe(255)
    expect(at(m, 100, 50, 50)).toBe(0)
    expect(at(m, 100, 10, 10)).toBe(0)
  })
  it('a step this editor no longer makes (a click-select pick, a snap) draws nothing', () => {
    const kept = [{ t: 'brush', mode: 'add', r: 0.1, soft: 0, pts: [{ x: 0.25, y: 0.25 }] },
      { t: 'snap', cutout: 'c' }, { t: 'pick', mode: 'add', w: 2, h: 2, rle: [0, 4] }] as unknown as MaskOp[]
    expect(rasterize(kept, 100, 100)).toEqual(rasterize(kept.slice(0, 1), 100, 100))
    expect(new RasterCache().get('m', kept, 100, 100)).toEqual(rasterize(kept.slice(0, 1), 100, 100))
  })
})

describe('the helpers', () => {
  it('finds the bounds, the paint and the edge', () => {
    const m = rasterize([{ t: 'lasso', mode: 'add', pts: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.6 }, { x: 0.2, y: 0.6 }] }], 10, 10)
    expect(painted(m)).toBe(true)
    expect(bounds(m, 10, 10)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 })
    const e = edges(m, 10, 10)
    expect(e[2 * 10 + 2]).toBe(1)
    expect(e[3 * 10 + 3]).toBe(0)
    expect(bounds(new Uint8Array(4), 2, 2)).toBeNull()
  })
})

// features/image-editor-masks-layers.clan P3: the same pixels, drawn incrementally.
describe('incremental drawing', () => {
  // A small seeded random, so a failure repeats.
  const rand = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const randomOp = (r: () => number): MaskOp => {
    const k = r()
    const pts = Array.from({ length: 2 + Math.floor(r() * 8) }, () => ({ x: r(), y: r() }))
    if (k < 0.55) return { t: 'brush', mode: r() < 0.75 ? 'add' : 'sub', r: 0.01 + r() * 0.08, soft: r(), pts }
    return { t: 'lasso', mode: r() < 0.75 ? 'add' : 'sub', pts }
  }

  it('rasterize is the fold of applyOp', () => {
    const r = rand(7)
    const ops = Array.from({ length: 12 }, () => randomOp(r))
    const m = new Uint8Array(64 * 36)
    for (const op of ops) applyOp(m, 64, 36, op)
    expect(m).toEqual(rasterize(ops, 64, 36))
  })

  it('the cache equals a full drawing after appends, undo and clear, for random sequences', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rand(seed)
      const cache = new RasterCache(3)
      let ops: MaskOp[] = []
      for (let step = 0; step < 30; step++) {
        const k = r()
        if (k < 0.6 || !ops.length) ops = [...ops, randomOp(r)]
        else if (k < 0.8) ops = ops.slice(0, -1) // ⌘Z
        else if (k < 0.88) ops = [] // Clear mask
        else ops = structuredClone(ops) // a store write: same content, new objects
        const got = cache.get('m1', ops, 64, 36)
        expect(got, `seed ${seed} step ${step}`).toEqual(rasterize(ops, 64, 36))
      }
    }
  })

  it('a step’s signature survives a structuredClone and changes with its content', () => {
    const op: MaskOp = { t: 'brush', mode: 'add', r: 0.05, soft: 0.2, pts: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] }
    expect(opSig(structuredClone(op))).toBe(opSig(op))
    expect(opSig({ ...op, pts: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.41 }] })).not.toBe(opSig(op))
    expect(opSig({ ...op, mode: 'sub' })).not.toBe(opSig(op))
  })

  // The brush before the squared-distance kernel, for comparison.
  function oldBrush(m: Uint8Array, w: number, h: number, op: Extract<MaskOp, { t: 'brush' }>) {
    const r = Math.max(0.5, op.r * w)
    const inner = r * (1 - Math.min(1, Math.max(0, op.soft)))
    const pts = op.pts.map((p) => ({ x: p.x * w, y: p.y * h }))
    if (pts.length === 1) pts.push(pts[0])
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r))
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r))
      const dx = b.x - a.x, dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
        const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
        if (d >= r) continue
        const v = d <= inner ? 1 : (r - d) / (r - inner)
        const j = y * w + x
        m[j] = op.mode === 'add' ? Math.max(m[j], Math.round(v * 255)) : Math.min(m[j], Math.round((1 - v) * 255))
      }
    }
  }
  it('the brush kernel matches the old one within 1 at 64 x 36 and 1344 x 756', () => {
    for (const [w, h] of [[64, 36], [1344, 756]]) {
      const r = rand(w)
      const ops = Array.from({ length: w > 100 ? 4 : 20 }, (_, i): Extract<MaskOp, { t: 'brush' }> => ({
        t: 'brush', mode: i % 4 === 3 ? 'sub' : 'add', r: 0.01 + r() * 0.06, soft: r(), pts: Array.from({ length: 5 }, () => ({ x: r(), y: r() })),
      }))
      const old = new Uint8Array(w * h)
      for (const op of ops) oldBrush(old, w, h, op)
      const now = rasterize(ops, w, h)
      let worst = 0
      for (let i = 0; i < old.length; i++) worst = Math.max(worst, Math.abs(old[i] - now[i]))
      expect(worst, `${w} x ${h}`).toBeLessThanOrEqual(1)
    }
  })
})
