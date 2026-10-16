// A mask as pixels (features/image-editor.clan): its steps (edits.ts MaskOp) drawn at any size, so
// the stage previews it at screen size and Fill area sends it at the frame's own size. 0 = keep,
// 255 = change (our convention; the relay flips it for Runway's black = edit). Pure, for the tests.

import type { MaskOp, Pt } from './edits'

/** The alpha of a cut-out at w x h (255 = the subject), for Snap to cut-out. */
export type AlphaOf = (cutoutId: string, w: number, h: number) => Uint8Array | undefined

function brush(m: Uint8Array, w: number, h: number, op: Extract<MaskOp, { t: 'brush' }>) {
  const r = Math.max(0.5, op.r * w)
  const inner = r * (1 - Math.min(1, Math.max(0, op.soft)))
  // Squared distances: the square root only for the pixels in the soft band.
  const r2 = r * r, inner2 = inner * inner, band = r - inner
  const add = op.mode === 'add'
  const pts = op.pts.map((p) => ({ x: p.x * w, y: p.y * h }))
  if (pts.length === 1) pts.push(pts[0])
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r))
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r))
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5
      const row = y * w
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
        const ex = px - (a.x + t * dx), ey = py - (a.y + t * dy)
        const d2 = ex * ex + ey * ey
        if (d2 >= r2) continue
        const v = d2 <= inner2 ? 255 : Math.round(((r - Math.sqrt(d2)) / band) * 255)
        const i = row + x
        if (add) { if (v > m[i]) m[i] = v } else if (255 - v < m[i]) m[i] = 255 - v
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

/** One step drawn into `m` (w x h), in place. rasterize is the fold of these over a mask's steps. */
export function applyOp(m: Uint8Array, w: number, h: number, op: MaskOp, alphaOf?: AlphaOf): void {
  switch (op.t) {
    case 'brush': brush(m, w, h, op); return
    case 'lasso': lasso(m, w, h, op.mode, op.pts); return
    case 'pick': {
      const src = unrle(op.rle, op.w * op.h)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!src[Math.min(op.h - 1, Math.floor(((y + 0.5) * op.h) / h)) * op.w + Math.min(op.w - 1, Math.floor(((x + 0.5) * op.w) / w))]) continue
        m[y * w + x] = op.mode === 'add' ? 255 : 0
      }
      return
    }
    case 'snap': {
      const a = alphaOf?.(op.cutout, w, h)
      if (a) for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i], a[i])
      return
    }
    default: {
      const never: never = op
      throw new Error(`unknown mask step ${JSON.stringify(never)}`)
    }
  }
}

/** The mask's steps drawn at w x h. */
export function rasterize(ops: readonly MaskOp[], w: number, h: number, alphaOf?: AlphaOf): Uint8Array {
  const m = new Uint8Array(w * h)
  for (const op of ops) applyOp(m, w, h, op, alphaOf)
  return m
}

/** A short hash of numbers (FNV-1a over their 1e-6 steps): a step's content, not its object identity. */
function hashNums(h: number, xs: Iterable<number>): number {
  for (const v of xs) {
    let n = Math.round(v * 1e6) | 0
    for (let k = 0; k < 4; k++) {
      h ^= n & 0xff
      h = Math.imul(h, 0x01000193)
      n >>>= 8
    }
  }
  return h >>> 0
}

function* coords(pts: readonly Pt[]) {
  for (const p of pts) { yield p.x; yield p.y }
}

/**
 * A step's signature: equal for equal content (a structuredClone keeps it), different when anything
 * that changes its pixels changes. A snap depends on its cut-out's pixels too, so `alphaKey` names
 * them (the cut-out's picture, or '' while it loads). A new MaskOp variant must be added here and in
 * applyOp, or the switch does not compile.
 */
export function opSig(op: MaskOp, alphaKey?: (cutoutId: string) => string): string {
  switch (op.t) {
    case 'brush': return `b${op.mode}${op.r}/${op.soft}/${op.pts.length}/${hashNums(0x811c9dc5, coords(op.pts))}`
    case 'lasso': return `l${op.mode}${op.pts.length}/${hashNums(0x811c9dc5, coords(op.pts))}`
    case 'pick': return `p${op.mode}${op.w}x${op.h}/${op.rle.length}/${hashNums(0x811c9dc5, op.rle)}`
    case 'snap': return `s${op.cutout}/${alphaKey?.(op.cutout) ?? ''}`
    default: {
      const never: never = op
      throw new Error(`unknown mask step ${JSON.stringify(never)}`)
    }
  }
}

interface Cached { sigs: string[]; at: Map<number, Uint8Array> }

/**
 * Masks drawn incrementally (features/image-editor-masks-layers.clan): each mask keeps its drawing after
 * its recent steps, keyed on the steps' content (opSig), so a new stroke draws only itself and ⌘Z goes
 * back to a kept drawing. Results are shared: never write into one.
 */
export class RasterCache {
  private readonly masks = new Map<string, Cached>()
  private readonly keep: number
  constructor(keep = 8) {
    this.keep = keep
  }

  get(id: string, ops: readonly MaskOp[], w: number, h: number, alphaOf?: AlphaOf, alphaKey?: (cutoutId: string) => string): Uint8Array {
    const key = `${id}@${w}x${h}`
    const sigs = ops.map((op) => opSig(op, alphaKey))
    let c = this.masks.get(key)
    if (!c) {
      c = { sigs: [], at: new Map([[0, new Uint8Array(w * h)]]) }
      this.masks.set(key, c)
    }
    let same = 0
    while (same < sigs.length && same < c.sigs.length && sigs[same] === c.sigs[same]) same++
    // Drawings after a step that changed are gone; the newest kept one at or before `same` starts the rest.
    for (const n of [...c.at.keys()]) if (n > same) c.at.delete(n)
    const from = Math.max(...c.at.keys())
    if (from === sigs.length) {
      c.sigs = sigs
      return c.at.get(from)!
    }
    const m = c.at.get(from)!.slice()
    for (let i = from; i < ops.length; i++) applyOp(m, w, h, ops[i], alphaOf)
    c.sigs = sigs
    c.at.set(ops.length, m)
    // Keep the empty start and the last `keep` drawings.
    const ns = [...c.at.keys()].sort((a, b) => a - b)
    for (const n of ns.slice(1, Math.max(1, ns.length - this.keep))) c.at.delete(n)
    return m
  }

  /** Forget masks that are gone. */
  retain(ids: ReadonlySet<string>) {
    for (const k of [...this.masks.keys()]) if (!ids.has(k.slice(0, k.lastIndexOf('@')))) this.masks.delete(k)
  }
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
