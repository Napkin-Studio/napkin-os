// A mask as pixels (features/image-editor.clan): its steps (edits.ts MaskOp) drawn at any size, so
// the stage previews it at screen size and Fill area sends it at the frame's own size. 0 = keep,
// 255 = change (our convention; the relay flips it for Runway's black = edit). Pure, for the tests.

import type { MaskOp, Pt } from './edits'

/** The alpha of a cut-out at w x h (255 = the subject), for Snap to cut-out. */
export type AlphaOf = (cutoutId: string, w: number, h: number) => Uint8Array | undefined

function brush(m: Uint8Array, w: number, h: number, op: Extract<MaskOp, { t: 'brush' }>) {
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
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
        const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
        if (d >= r) continue
        const v = d <= inner ? 1 : (r - d) / (r - inner)
        const i = y * w + x
        m[i] = op.mode === 'add' ? Math.max(m[i], Math.round(v * 255)) : Math.min(m[i], Math.round((1 - v) * 255))
      }
    }
  }
}

function lasso(m: Uint8Array, w: number, h: number, mode: 'add' | 'sub', poly: Pt[]) {
  if (poly.length < 3) return
  const pts = poly.map((p) => ({ x: p.x * w, y: p.y * h }))
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = from; x <= to; x++) m[y * w + x] = mode === 'add' ? 255 : 0
    }
  }
}

/** A 0/255 mask as run lengths, starting with a run of 0s. */
export function rle(bits: ArrayLike<number>): number[] {
  const out: number[] = []
  let on = false, run = 0
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i] >= 128
    if (b !== on) {
      out.push(run)
      run = 0
      on = b
    }
    run++
  }
  out.push(run)
  return out
}

export function unrle(runs: number[], n: number): Uint8Array {
  const out = new Uint8Array(n)
  let i = 0, on = false
  for (const r of runs) {
    if (on) out.fill(255, i, Math.min(n, i + r))
    i += r
    on = !on
  }
  return out
}

/** A w x h mask shrunk to at most `side` on its longest side (nearest), for keeping a click's mask. */
export function shrink(bits: Uint8Array, w: number, h: number, side = 256): { w: number; h: number; data: Uint8Array } {
  const k = Math.min(1, side / Math.max(w, h))
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k))
  const data = new Uint8Array(sw * sh)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    data[y * sw + x] = bits[Math.min(h - 1, Math.floor(((y + 0.5) * h) / sh)) * w + Math.min(w - 1, Math.floor(((x + 0.5) * w) / sw))]
  }
  return { w: sw, h: sh, data }
}

/** The mask's steps drawn at w x h. */
export function rasterize(ops: readonly MaskOp[], w: number, h: number, alphaOf?: AlphaOf): Uint8Array {
  const m = new Uint8Array(w * h)
  for (const op of ops) {
    if (op.t === 'brush') brush(m, w, h, op)
    else if (op.t === 'lasso') lasso(m, w, h, op.mode, op.pts)
    else if (op.t === 'pick') {
      const src = unrle(op.rle, op.w * op.h)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!src[Math.min(op.h - 1, Math.floor(((y + 0.5) * op.h) / h)) * op.w + Math.min(op.w - 1, Math.floor(((x + 0.5) * op.w) / w))]) continue
        m[y * w + x] = op.mode === 'add' ? 255 : 0
      }
    } else if (op.t === 'snap') {
      const a = alphaOf?.(op.cutout, w, h)
      if (a) for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i], a[i])
    }
  }
  return m
}

/** Whether a mask has any paint. */
export function painted(m: ArrayLike<number>): boolean {
  for (let i = 0; i < m.length; i++) if (m[i]) return true
  return false
}

/** The mask's bounding box, 0-1 (the region a Fill sends beside the mask), or null when empty. */
export function bounds(m: ArrayLike<number>, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] >= 128) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < 0) return null
  return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h }
}

/** The edge of the mask, for marching ants: 1 where a painted pixel touches an unpainted one. */
export function edges(m: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (m[i] < 128) continue
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || m[i - 1] < 128 || m[i + 1] < 128 || m[i - w] < 128 || m[i + w] < 128) out[i] = 1
  }
  return out
}
