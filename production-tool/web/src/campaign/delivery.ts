// Export at full size (features/campaign-formats.clan, phase 4; owner CF2): each size's plate (its picture
// before type) upscaled by Magnific for delivery, x4, or x8 for the largest print sizes, then the type
// drawn again at the delivery size on the relay. The same rule as relay/formats.py delivery_scale and
// delivery_input (tested against the same vectors). Magnific's limits are Runway's OpenAPI's: each input
// side 300-8000 px, the output at most 25,300,000 pixels.

import type { DeliveryPx, Size } from '../contracts/types'
import { previewSize } from './crop'

export const UPSCALE_MIN_IN = 300
export const UPSCALE_MAX_IN = 8000
export const UPSCALE_MAX_OUT_PX = 25_300_000
export const DELIVERY_SCALES = [4, 8] as const
export type DeliveryScale = (typeof DELIVERY_SCALES)[number]

type Px = [number, number]

/** The size the plate goes to Magnific at for scale k (relay formats.delivery_input). */
export function deliveryInput(plate: Px, delivery: Px, k: number): Px {
  const [w, h] = plate
  let s = Math.min(1, Math.max(delivery[0] / (k * w), delivery[1] / (k * h)))
  s = Math.min(s, Math.sqrt(UPSCALE_MAX_OUT_PX / (k * k * w * h)))
  return [Math.max(1, Math.floor(w * s)), Math.max(1, Math.floor(h * s))]
}

/** x4 when it reaches the delivery, else x8; the larger output when neither does; null when no upscale
 *  is needed or Magnific cannot take the plate (relay formats.delivery_scale). */
export function deliveryScale(plate: Px, delivery: Px): DeliveryScale | null {
  const [w, h] = plate
  if (w >= delivery[0] && h >= delivery[1]) return null
  let best: DeliveryScale | null = null
  let area = 0
  for (const k of DELIVERY_SCALES) {
    const [iw, ih] = deliveryInput(plate, delivery, k)
    if (Math.min(iw, ih) < UPSCALE_MIN_IN || Math.max(iw, ih) > UPSCALE_MAX_IN) continue
    if (iw * k >= delivery[0] && ih * k >= delivery[1]) return k
    if (iw * ih * k * k > area) {
      best = k
      area = iw * ih * k * k
    }
  }
  return best
}

/** The plate's size: the preview the relay made it at. */
export function plateSize(size: Pick<Size, 'delivery'>): DeliveryPx {
  return previewSize(size.delivery)
}

export type FullPlan = { kind: 'exact' } | { kind: 'ready'; scale?: DeliveryScale } | { kind: 'upscale'; scale: DeliveryScale } | { kind: 'preview' }

/** What Export at full size does with a made size: 'exact' (the preview is the delivery size), 'ready'
 *  (its full file is made for this picture), 'upscale' (Magnific at this scale), 'preview' (Magnific
 *  cannot take it, or it has no plate yet: the preview goes, labelled so), or null (not made). */
export function fullPlan(size: Size): FullPlan | null {
  if (size.media !== 'image' || !size.asset) return null
  const p = plateSize(size)
  if (p.width >= size.delivery.width && p.height >= size.delivery.height) return { kind: 'exact' }
  if (size.full?.asset && size.full.from === size.asset) return { kind: 'ready', ...(size.full.scale ? { scale: size.full.scale } : {}) }
  const k = size.plate ? deliveryScale([p.width, p.height], [size.delivery.width, size.delivery.height]) : null
  return k ? { kind: 'upscale', scale: k } : { kind: 'preview' }
}
