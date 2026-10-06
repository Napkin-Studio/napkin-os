// The region contract: a box in 0-1 coordinates of the image it sits on,
// origin top-left (common.schema.json#/$defs/region). w and h must be > 0.

import type { Region } from '../contracts/types'

export interface Rect { x: number; y: number; w: number; h: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round = (v: number) => Math.round(v * 10000) / 10000

/**
 * A rectangle drawn in display pixels (any corner order, may spill outside the
 * image) → a contract region of the image displayed at `display` size.
 * Returns null when the box is too small to mean anything (under `minPx`).
 */
export function rectToRegion(a: { x: number; y: number }, b: { x: number; y: number }, display: { w: number; h: number }, minPx = 4): Region | null {
  if (display.w <= 0 || display.h <= 0) return null
  const x0 = clamp01(Math.min(a.x, b.x) / display.w)
  const y0 = clamp01(Math.min(a.y, b.y) / display.h)
  const x1 = clamp01(Math.max(a.x, b.x) / display.w)
  const y1 = clamp01(Math.max(a.y, b.y) / display.h)
  if ((x1 - x0) * display.w < minPx || (y1 - y0) * display.h < minPx) return null
  const x = round(x0)
  const y = round(y0)
  const w = round(Math.min(x1 - x0, 1 - x))
  const h = round(Math.min(y1 - y0, 1 - y))
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

/** A region back to pixels of an image (or a display box) of the given size. */
export function regionToRect(r: Region, size: { w: number; h: number }): Rect {
  return { x: r.x * size.w, y: r.y * size.h, w: r.w * size.w, h: r.h * size.h }
}

/** A region centred on a click, used by click-to-select until a segment op exists. */
export function regionAround(point: { x: number; y: number }, display: { w: number; h: number }, frac = 0.28): Region {
  const half = frac / 2
  const cx = clamp01(point.x / display.w)
  const cy = clamp01(point.y / display.h)
  const x = round(clamp01(cx - half))
  const y = round(clamp01(cy - half))
  return { x, y, w: round(Math.min(frac, 1 - x)), h: round(Math.min(frac, 1 - y)) }
}

export function isValidRegion(r: Region): boolean {
  return r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x <= 1 && r.y <= 1 && r.w <= 1 && r.h <= 1
}
