// The sizes Runway's image models render at (features/frame-aspect.clan), so the
// canvas can say before sending how much the relay's centre crop will take. The
// relay's own tables (relay/director/director.py FLASH_RATIOS, PRO_RATIOS) are
// the ones that decide; runwaySizes.test.ts fails if these drift from them, and
// runway-sheet-sync moves both into the capability sheet.

import type { Aspect } from '../contracts/types'
import { lossOf } from '../canvas/core/sketch'

const pairs = (s: string): Aspect[] => s.trim().split(/\s+/).map((p) => {
  const [w, h] = p.split(':').map(Number)
  return { w, h }
})

export const FLASH_SIZES = pairs(`
512:512 416:624 624:416 432:592 592:432 448:576 576:448 384:672 672:384 768:336 256:1024 1024:256
176:1408 1408:176 1024:1024 832:1248 1248:832 864:1184 1184:864 896:1152 1152:896 768:1344 1344:768
1536:672 512:2048 2048:512 352:2816 2816:352 2048:2048 1696:2528 2528:1696 1792:2400 2400:1792
1856:2304 2304:1856 1536:2752 2752:1536 3168:1344 1024:4096 4096:1024 704:5632 5632:704 4096:4096
3392:5056 5056:3392 3584:4800 4800:3584 3712:4608 4608:3712 3072:5504 5504:3072 6336:2688 2048:8192
8192:2048 1408:11264 11264:1408
`)
export const PRO_SIZES = pairs(`
1344:768 768:1344 1024:1024 1184:864 864:1184 1536:672 832:1248 1248:832 896:1152 1152:896 2048:2048
1696:2528 2528:1696 1792:2400 2400:1792 1856:2304 2304:1856 1536:2752 2752:1536 3168:1344 4096:4096
3392:5056 5056:3392 3584:4800 4800:3584 3712:4608 4608:3712 3072:5504 5504:3072 6336:2688
`)

/** The model's table: Gemini 3 Pro's, else 3.1 Flash's (as director.provider_sizes reads them). */
export function sizesFor(model: string | undefined): Aspect[] {
  return model === 'gemini_image3_pro' ? PRO_SIZES : FLASH_SIZES
}

/** The size Runway renders a job of this shape at: the nearest shape, then the nearest to 1 MP (director._nearest_ratio). */
export function runwaySize(aspect: Aspect, model: string | undefined): Aspect {
  const sizes = sizesFor(model)
  const target = Math.log(aspect.w / aspect.h)
  const shape = (s: Aspect) => Math.abs(Math.log(s.w / s.h) - target)
  const area = (s: Aspect) => Math.abs(Math.log((s.w * s.h) / 1_048_576))
  const best = Math.min(...sizes.map(shape))
  const near = sizes.filter((s) => shape(s) <= best + 0.04)
  // Ties break on the 'W:H' text, as the relay's do.
  return near.reduce((a, b) => {
    const d = area(a) - area(b)
    if (Math.abs(d) > 1e-12) return d < 0 ? a : b
    return `${a.w}:${a.h}` <= `${b.w}:${b.h}` ? a : b
  })
}

/** The share of the picture the relay's crop will take on this model (0 to 1). */
export function cropLoss(aspect: Aspect, model: string | undefined): number {
  return lossOf(aspect, runwaySize(aspect, model))
}
