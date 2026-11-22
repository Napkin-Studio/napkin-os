// Will this picture hold in that shape? (features/pt-final-and-fit.clan; UAT 2026-11-22: a 4:1 96-sheet from a 4:5
// master was offered Extend, and the relay refused it after the person chose it: "14400:3600 is too far from this
// picture's shape to extend".) Before a method is offered, this says which can run from this master at this shape and,
// when none can hold the protected product, says so in plain words with what to do. Pure; the numbers are the relay's:
// rules.ts extendFits is relay/formats.py extend_fits (three steps of 35 %), and REDRAW_MAX_RATIO is Gemini's 8:1.

import type { Aspect, ProtectBox, SizeMethod } from '../contracts/types'
import { cropBox, unionOf, type Fracs, NO_INSET } from './crop'
import { extendFits, extendSteps, EXTEND_STEPS_MAX, filled } from './rules'

/** The most extreme shape a Redraw (Gemini) reaches, as a ratio either way (resizeSelection.ts MAX_RATIO is this). */
export const REDRAW_MAX_RATIO = 8
/** A redraw puts the master whole inside the shape; the product must then show at least this share of the shape's long side. */
export const PRODUCT_MIN_SHARE = 0.08

export type Fittable = Extract<SizeMethod, 'crop' | 'extend' | 'regenerate'>
export interface Verdict { ok: boolean; why?: string }
export interface Fit {
  methods: Record<Fittable, Verdict>
  /** `none`: nothing is marked as the product. `holds`: some method keeps it. `wont`: no method can. */
  product: 'none' | 'holds' | 'wont'
  /** Plain words for the person when the product won't fit; undefined otherwise. */
  say?: string
  /** What to start from instead when it won't fit. */
  suggest?: 'wider' | 'taller'
}

const ratioWord = (a: Aspect) => {
  const r = a.w / a.h
  if (Math.abs(r - Math.round(r)) < 0.02 && r >= 1) return `${Math.round(r)}:1`
  if (Math.abs(1 / r - Math.round(1 / r)) < 0.02 && r < 1) return `1:${Math.round(1 / r)}`
  return r >= 1 ? `${r.toFixed(1)}:1` : `1:${(1 / r).toFixed(1)}`
}

/** The union of the marked product boxes (role product), else null. */
export function productBox(boxes: readonly ProtectBox[] | undefined) {
  return unionOf((boxes ?? []).filter((b) => b.role === 'product'))
}

/**
 * Which of crop, extend and redraw can run from `master` at `target`, with why not for each that can't, and the verdict
 * on the protected product. `available`: the methods the agency can run (rules.availableMethods). A crop must keep every
 * marked box (the product, the subject) inside the crop; an extend must be reachable in the relay's three steps; a
 * redraw must be on, within 8:1, and leave the product big enough to read when the master is laid whole in the shape.
 */
export function fitFor(master: Aspect, target: Aspect, boxes: readonly ProtectBox[] | undefined, available: ReadonlySet<SizeMethod>, fracs: Fracs = NO_INSET): Fit {
  const shape = ratioWord(target)
  const marked = unionOf(boxes)
  const product = productBox(boxes)
  const out: Record<Fittable, Verdict> = {
    crop: { ok: true },
    extend: { ok: true },
    regenerate: { ok: true },
  }
  if (marked) {
    const { crop, fits } = cropBox(master, target, boxes, fracs)
    const holds = marked.x >= crop.x - 0.5 && marked.y >= crop.y - 0.5 && marked.x + marked.w <= crop.x + crop.w + 0.5 && marked.y + marked.h <= crop.y + crop.h + 0.5
    if (!holds || !fits) out.crop = { ok: false, why: `A crop to ${shape} would cut what must stay.` }
  }
  if (!available.has('extend')) out.extend = { ok: false, why: 'Extend is off for your agency.' }
  else if (!extendFits(master, target)) out.extend = { ok: false, why: `${shape} is too far from this picture's shape to extend: it takes ${extendSteps(master, target)} steps and Extend makes at most ${EXTEND_STEPS_MAX}.` }
  if (!available.has('regenerate')) out.regenerate = { ok: false, why: 'Redraw is off for your agency.' }
  else if (Math.max(target.w / target.h, target.h / target.w) > REDRAW_MAX_RATIO) out.regenerate = { ok: false, why: `${shape} is past the ${REDRAW_MAX_RATIO}:1 a redraw reaches.` }
  else if (product) {
    // The master laid whole in the shape, as large as it goes: how much of the shape's long side the product is.
    const k = Math.min(target.w / master.w, target.h / master.h)
    const share = Math.max((product.w * k) / target.w, (product.h * k) / target.h)
    if (share < PRODUCT_MIN_SHARE) out.regenerate = { ok: false, why: `Redrawn at ${shape} the product would be too small to read.` }
  }
  const any = out.crop.ok || out.extend.ok || out.regenerate.ok
  if (!product) return { methods: out, product: 'none' }
  if (any) return { methods: out, product: 'holds' }
  const suggest: 'wider' | 'taller' = target.w / target.h > master.w / master.h ? 'wider' : 'taller'
  return {
    methods: out, product: 'wont', suggest,
    say: `This picture can't hold the product at ${shape}. Start from a ${suggest} picture, one close to ${shape}, and make this size from that.`,
  }
}

/** Whether `method` may be offered for this master and shape (a method that is not a crop, extend or redraw always may). */
export function methodOffered(fit: Fit, method: SizeMethod): boolean {
  return method === 'crop' || method === 'extend' || method === 'regenerate' ? fit.methods[method].ok : true
}

/** Why `method` is not offered, for its tooltip or the line under the menu; undefined when it is offered. */
export function methodWhy(fit: Fit, method: SizeMethod): string | undefined {
  return method === 'crop' || method === 'extend' || method === 'regenerate' ? fit.methods[method].why : undefined
}

/** How far a master is from a shape: 1 is the same shape, below 0.25 an extend leaves it small (rules.SET_REGENERATE_BELOW). */
export const closeness = (master: Aspect, target: Aspect): number => filled(master, target)
