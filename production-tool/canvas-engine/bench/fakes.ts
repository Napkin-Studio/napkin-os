// Stand-ins for the browser in the node bench: a 2D context that does nothing
// (so what is timed is the engine's own CPU work: culling, ordering, outlines),
// a path that counts its points, and bitmaps of the preview sizes.

import type { Bitmap } from '../src/render/bitmaps'
import type { DrawContext, PathLike } from '../src/render/renderer'
import { PREVIEW_H, PREVIEW_W } from './scene'
import { SMALL_PREVIEW_W } from '../src/render/caps'

export class CountingPath implements PathLike {
  n = 0
  moveTo() { this.n++ }
  lineTo() { this.n++ }
  closePath() {}
}

export function nullContext(): DrawContext & { calls: number } {
  const ctx = {
    calls: 0,
    fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, font: '', globalAlpha: 1,
  } as DrawContext & { calls: number }
  for (const m of ['setTransform', 'save', 'restore', 'translate', 'fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'ellipse', 'closePath', 'stroke', 'fill', 'drawImage'] as const) {
    ;(ctx as unknown as Record<string, () => void>)[m] = () => { ctx.calls++ }
  }
  return ctx
}

export const fullBitmap = (): Bitmap => ({ width: PREVIEW_W, height: PREVIEW_H, close() {} })
export const smallBitmap = (): Bitmap => ({ width: SMALL_PREVIEW_W, height: Math.round((SMALL_PREVIEW_W * PREVIEW_H) / PREVIEW_W), close() {} })

/** A fixed CPU workload, timed in the same process as the draw, so a slower runner moves both. */
export function controlWorkload(): number {
  let a = 12345
  const xs: number[] = []
  for (let i = 0; i < 200_000; i++) {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0
    xs.push(a / 4294967296)
  }
  xs.sort((p, q) => p - q)
  const objs = xs.slice(0, 20_000).map((x, i) => ({ i, x, s: x.toFixed(6) }))
  return JSON.parse(JSON.stringify(objs)).length
}

export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

export function timeMedian(runs: number, fn: () => void): number {
  const ts: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    ts.push(performance.now() - t0)
  }
  return median(ts)
}
