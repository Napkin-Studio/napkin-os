// Plain words for the campaign sheets (UAT round 4, Production round 3): a cut plan's reason led by its pick, and the
// file a size downloads as. Kept out of the component files so they stay components only.
import type { Size } from '../contracts/types'
import { formatById, shortName } from './formats'

/** A beat's reason led by the pick it explains, unless it says so already: "Dropped: Filling at the tap only sets up the
 *  refill" (UAT round 4 F35: "…so it goes first" beside an unticked shot read as the opposite of the pick). */
export function pickWords(kept: boolean, why: string | undefined): string {
  const w = (why ?? '').trim()
  if (!w) return kept ? 'Kept' : 'Dropped'
  return /^(kept|keeps|keep|dropped|drops|drop)\b/i.test(w) ? w : `${kept ? 'Kept' : 'Dropped'}: ${w}`
}

/** The file a size downloads as: its format's short name and size, as a .mp4 or a .png. */
export function sizeFileName(size: Pick<Size, 'format' | 'delivery' | 'media'>): string {
  const f = formatById(size.format.format_id)
  const name = (f ? shortName(f.format) : size.format.format_id).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `${name}-${size.delivery.width}x${size.delivery.height}.${size.media === 'video' ? 'mp4' : 'png'}`
}
