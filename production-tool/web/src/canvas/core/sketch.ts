// Sketch areas (features/frame-aspect.clan; ui-behaviour 3.7): the shape maths,
// pure and engine-free, so today's canvas, canvas-nodes, scamp sheets (3.19)
// and the Image editor crop (3.12) all call the same functions.
//
// A sketch area is a white rectangle (customData {kind:'sketch', id}) with an
// exact shape (sketches[id].aspect) and, when it is one of the four, a ratio.
// Generate exports exactly the area, strokes crossing its edge clipped to it,
// at exportPx(aspect); the relay renders at the model's nearest size and
// centre-crops back to the aspect (relay/aspect.py). One case table,
// contracts/examples/aspect-cases.json, holds the tolerance and the cases, and
// the tests here and in the relay read it.

import { RATIOS, type Aspect, type Ratio } from '../../contracts/types'
import type { Pt } from './canvasAdapter'

/** Two shapes are the same when their log ratios differ by no more than this (aspect-cases.json). */
export const TOLERANCE = 0.005
/** A sketch area exports with this long side; fitSize's limit, so the export is sent as it is. */
export const EXPORT_LONG_SIDE = 1536

export interface Rect { x: number; y: number; w: number; h: number }

const ASPECT_OF: Record<Ratio, Aspect> = { '16:9': { w: 16, h: 9 }, '9:16': { w: 9, h: 16 }, '1:1': { w: 1, h: 1 }, '4:5': { w: 4, h: 5 } }
/** The size label of each ratio: its common delivery size. */
const DELIVERY: Record<Ratio, Aspect> = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 } }

const logShape = (a: Aspect) => Math.log(a.w / a.h)

export function shapeDistance(a: Aspect, b: Aspect): number {
  return Math.abs(logShape(a) - logShape(b))
}

export function sameShape(a: Aspect, b: Aspect): boolean {
  return shapeDistance(a, b) <= TOLERANCE + 1e-12
}

export function aspectOfRatio(ratio: Ratio): Aspect {
  return { ...ASPECT_OF[ratio] }
}

/** The ratio this shape is (within TOLERANCE), or undefined when it is none of the four. */
export function exactRatio(aspect: Aspect): Ratio | undefined {
  return RATIOS.find((r) => sameShape(aspect, ASPECT_OF[r]))
}

/** The nearest of the four ratios: what a Generate without an area asks for, from its first input's shape. */
export function ratioFor(aspect: Aspect): Ratio {
  let best: Ratio = RATIOS[0]
  for (const r of RATIOS) if (shapeDistance(aspect, ASPECT_OF[r]) < shapeDistance(aspect, ASPECT_OF[best])) best = r
  return best
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

/** A shape in its lowest whole terms ({1344, 704} is {21, 11}). */
export function reducedAspect(aspect: Aspect): Aspect {
  const w = Math.round(aspect.w)
  const h = Math.round(aspect.h)
  const g = gcd(w, h) || 1
  return { w: w / g, h: h / g }
}

/** A shape in its lowest terms: '16:9', '191:100', '2:1'; one of the four by its name. */
export function ratioText(aspect: Aspect): string {
  const r = exactRatio(aspect)
  if (r) return r
  const w = Math.round(aspect.w)
  const h = Math.round(aspect.h)
  const g = gcd(w, h) || 1
  return `${w / g}:${h / g}`
}

/** The area's size label: "16:9 · 1920×1080" (a ratio's delivery size, or a format's own pixels). */
export function aspectLabel(aspect: Aspect): string {
  const r = exactRatio(aspect)
  const small = aspect.w <= 32 && aspect.h <= 32
  const px = r && small ? DELIVERY[r] : small ? exportPx(aspect) : aspect
  return `${ratioText(aspect)} · ${Math.round(px.w)}×${Math.round(px.h)}`
}

/** The export size of an area of this shape: the long side EXPORT_LONG_SIDE, the short side to the shape. */
export function exportPx(aspect: Aspect): Aspect {
  if (aspect.w >= aspect.h) return { w: EXPORT_LONG_SIDE, h: Math.max(1, Math.round((EXPORT_LONG_SIDE * aspect.h) / aspect.w)) }
  return { w: Math.max(1, Math.round((EXPORT_LONG_SIDE * aspect.w) / aspect.h)), h: EXPORT_LONG_SIDE }
}

/** What exportRegion is asked for: exactly the area, at exportPx. */
export interface ExportPlan {
  rect: Rect
  aspect: Aspect
  outW: number
  outH: number
  /** Output pixels per scene unit. */
  scale: number
}

export function exportPlan(rect: Rect, aspect: Aspect): ExportPlan {
  const { w: outW, h: outH } = exportPx(aspect)
  return { rect: { ...rect }, aspect: { ...aspect }, outW, outH, scale: outW / Math.max(1e-9, rect.w) }
}

/**
 * The ghost while dragging: from `start` toward `pointer`, locked to the shape. It is as large as
 * the drag in its longer direction (so the pointer is always on its edge) and grows the way the
 * pointer went.
 */
export function ghostRect(start: Pt, pointer: Pt, aspect: Aspect): Rect {
  const dx = pointer.x - start.x
  const dy = pointer.y - start.y
  const k = aspect.h / aspect.w
  const w = Math.max(Math.abs(dx), Math.abs(dy) / k)
  const h = w * k
  return { x: dx < 0 ? start.x - w : start.x, y: dy < 0 ? start.y - h : start.y, w, h }
}

/**
 * The rectangle after a resize, put back on its shape: anchored at its top-left and led by its
 * width. Null when it is already within half a unit (so nothing is written, and two clients
 * correcting the same resize write the same thing).
 */
export function lockAspect(rect: Rect, aspect: Aspect): Rect | null {
  const h = (rect.w * aspect.h) / aspect.w
  if (Math.abs(h - rect.h) <= 0.5) return null
  return { x: rect.x, y: rect.y, w: rect.w, h }
}

/** An element as membersOf reads it: its box, and what it is. */
export interface Boxed {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  isDeleted?: boolean
  customData?: unknown
  /** A line's or stroke's points, relative to x and y (they may run left of or above it). */
  points?: readonly (readonly [number, number])[]
}

/** An element's box in scene coordinates (a line's from its points). */
export function boxOf(e: Boxed): Rect {
  if (e.points?.length) {
    const xs = e.points.map((p) => p[0])
    const ys = e.points.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return { x: e.x + minX, y: e.y + minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
  }
  const x = Math.min(e.x, e.x + e.width)
  const y = Math.min(e.y, e.y + e.height)
  return { x, y, w: Math.abs(e.width), h: Math.abs(e.height) }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

/** A stroke or shape the person drew: no tag, and not text, an image, a frame or an arrow (nodes.ts classify's 'stroke'). */
export function isStroke(e: Boxed): boolean {
  const c = e.customData
  const tagged = !!c && typeof c === 'object' && 'kind' in c
  return !tagged && !['text', 'image', 'frame', 'magicframe', 'arrow'].includes(e.type)
}

/** The strokes that belong to an area: live, untagged strokes and shapes whose box meets it (inside or crossing). */
export function membersOf<E extends Boxed>(els: readonly E[], rect: Rect): E[] {
  return els.filter((e) => !e.isDeleted && isStroke(e) && intersects(boxOf(e), rect))
}

/** The share of a picture of `size` lost when it is centre-cropped to `aspect` (0 to 1). */
export function lossOf(aspect: Aspect, size: Aspect): number {
  if (sameShape(aspect, size)) return 0
  const box = centreCrop(size, aspect)
  return 1 - (box.w * box.h) / (size.w * size.h)
}

/** The largest centred box of `aspect` inside a picture of `size` (relay/aspect.py centre_crop_box). */
export function centreCrop(size: Aspect, aspect: Aspect): Rect {
  if (size.w * aspect.h > size.h * aspect.w) {
    const w = Math.min(size.w, Math.max(1, Math.round((size.h * aspect.w) / aspect.h)))
    return { x: Math.floor((size.w - w) / 2), y: 0, w, h: size.h }
  }
  const h = Math.min(size.h, Math.max(1, Math.round((size.w * aspect.h) / aspect.w)))
  return { x: 0, y: Math.floor((size.h - h) / 2), w: size.w, h }
}

/** More than this share lost to the crop gets the warning line (open question 7). */
export const BIG_CROP = 0.25
export const BIG_CROP_LINE = 'Most of the picture will be cropped. Make all sizes can extend it instead.'

/** The caption of a picture the relay cropped: "1344×756 · cropped to 16:9". */
export function croppedCaption(out: Aspect, to: Aspect): string {
  return `${out.w}×${out.h} · cropped to ${ratioText(to)}`
}
