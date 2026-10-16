// The subject-aware crop (features/campaign-formats.clan): the largest box of a size's shape inside the
// master, placed so every protected box (the subject, the product) sits inside the format's safe area
// when the shape allows it, else centred on them. relay/formats.py works out the same box; both are
// tested against contracts/examples/crop-cases.json. Pure.

import type { Aspect, DeliveryPx, ProtectBox, PxBox, SafeArea } from '../contracts/types'

/** The safe area as shares of the size: left, top, right, bottom. */
export type Fracs = readonly [number, number, number, number]
export const NO_INSET: Fracs = [0, 0, 0, 0]

/**
 * The safe area as shares of the size. % and px are exact; mm needs the format's physical size
 * (`physical`, in mm), which the packs have and the relay does not (so the web always sends its crop).
 */
export function safeFracs(safe: SafeArea | undefined, delivery?: DeliveryPx, physical?: { width: number; height: number; unit: 'px' | 'mm' }): Fracs {
  if (!safe) return NO_INSET
  const dims = safe.unit === '%' ? { w: 100, h: 100 } : safe.unit === 'px' ? (delivery ? { w: delivery.width, h: delivery.height } : null)
    : physical?.unit === 'mm' ? { w: physical.width, h: physical.height } : null
  if (!dims || !dims.w || !dims.h) return NO_INSET
  if (safe.type === 'insets') return [safe.left / dims.w, safe.top / dims.h, safe.right / dims.w, safe.bottom / dims.h]
  const sx = Math.max(0, (1 - safe.width / dims.w) / 2)
  const sy = Math.max(0, (1 - safe.height / dims.h) / 2)
  return [sx, sy, sx, sy]
}

/** Where a crop of `size` starts along one axis of `total`, so [lo, hi] sits in the safe span [a, b] of it. */
function place(lo: number, hi: number, size: number, total: number, a: number, b: number): [number, boolean] {
  const ideal = (lo + hi) / 2 - ((a + b) / 2) * size
  const first = hi - b * size
  const last = lo - a * size
  const room = Math.max(0, total - size)
  if (first <= last + 1e-9) {
    let start = Math.min(Math.max(ideal, first), last)
    start = Math.min(Math.max(start, 0), room)
    return [start, start >= first - 1e-6 && start <= last + 1e-6]
  }
  return [Math.min(Math.max(ideal, 0), room), false]
}

/** The union of the protected boxes, or null when there is none. */
export function unionOf(boxes: readonly PxBox[] | undefined): PxBox | null {
  const live = (boxes ?? []).filter((b) => b.w > 0 && b.h > 0)
  if (!live.length) return null
  const x0 = Math.min(...live.map((b) => b.x))
  const y0 = Math.min(...live.map((b) => b.y))
  const x1 = Math.max(...live.map((b) => b.x + b.w))
  const y1 = Math.max(...live.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The crop of shape `aspect` in a master of `master` pixels, and whether every protected box is in the safe area. */
export function cropBox(master: Aspect, aspect: Aspect, protect?: readonly ProtectBox[] | readonly PxBox[], fracs: Fracs = NO_INSET): { crop: PxBox; fits: boolean } {
  const { w: mw, h: mh } = master
  let cw: number
  let ch: number
  if (mw * aspect.h > mh * aspect.w) {
    cw = Math.min(mw, Math.max(1, Math.round((mh * aspect.w) / aspect.h)))
    ch = mh
  } else {
    cw = mw
    ch = Math.min(mh, Math.max(1, Math.round((mw * aspect.h) / aspect.w)))
  }
  const u = unionOf(protect as readonly PxBox[] | undefined)
  if (!u) return { crop: { x: Math.floor((mw - cw) / 2), y: Math.floor((mh - ch) / 2), w: cw, h: ch }, fits: true }
  const [left, top, right, bottom] = fracs
  const [x, fx] = place(u.x, u.x + u.w, cw, mw, left, 1 - right)
  const [y, fy] = place(u.y, u.y + u.h, ch, mh, top, 1 - bottom)
  return { crop: { x: Math.round(x), y: Math.round(y), w: cw, h: ch }, fits: fx && fy }
}

/** Whether every protected box is inside the safe area of this crop (an Adjust crop may have moved it). */
export function protectedInside(crop: PxBox, protect: readonly PxBox[] | undefined, fracs: Fracs = NO_INSET): boolean {
  const u = unionOf(protect)
  if (!u) return true
  const [l, t, r, b] = fracs
  const e = 0.5
  return u.x >= crop.x + l * crop.w - e && u.x + u.w <= crop.x + (1 - r) * crop.w + e
    && u.y >= crop.y + t * crop.h - e && u.y + u.h <= crop.y + (1 - b) * crop.h + e
}

/** The delivery shape at most `max` px on its longest side, never larger (relay formats.preview_size). */
export function previewSize(delivery: DeliveryPx, max = 2048): DeliveryPx {
  const s = Math.min(1, max / Math.max(delivery.width, delivery.height))
  return { width: Math.max(1, Math.round(delivery.width * s)), height: Math.max(1, Math.round(delivery.height * s)) }
}

/** A crop moved by (dx, dy) master pixels, kept inside the master. */
export function panCrop(crop: PxBox, dx: number, dy: number, master: Aspect): PxBox {
  return {
    ...crop,
    x: Math.round(Math.min(Math.max(crop.x + dx, 0), Math.max(0, master.w - crop.w))),
    y: Math.round(Math.min(Math.max(crop.y + dy, 0), Math.max(0, master.h - crop.h))),
  }
}

/** A crop zoomed in or out about its centre (`k` < 1 is closer), its shape kept, inside the master. */
export function zoomCrop(crop: PxBox, k: number, master: Aspect): PxBox {
  const maxW = Math.min(master.w, (master.h * crop.w) / crop.h)
  const w = Math.min(maxW, Math.max(16, crop.w * k))
  const h = (w * crop.h) / crop.w
  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  return panCrop({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) }, 0, 0, master)
}
