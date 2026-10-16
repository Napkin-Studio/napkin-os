// The rule table (features/campaign-formats.clan, approach D): a method per format, from the master,
// the protected boxes, the format's shape and safe area, and the methods the capability sheet offers.
// Pure. The paid tests (docs/production-tool/campaign-formats-tests-2026-10-16.md) set the defaults:
// crop when the protected boxes fit the safe area; else extend (Ideogram 4.5 at high reached every
// shape tested, up to 4:1 and 9:16), or regenerate on Gemini 3 Pro when an extend would leave the
// subject small (the master would fill under 35% of the size); layout for banner strips.
//
// What runs today: crop (free, on the relay). Extend, regenerate and layout need phase 4, cutdowns
// phase 5 and reframes phase 6; until then a still whose method is not built is made as a crop, and
// its tile and tray row say which method it waits for (approach A, usable alone).

import type { Aspect, CapabilitySheet, ProtectBox, SizeMethod } from '../contracts/types'
import { SHEETS } from '../contracts/load'
import { cropBox, safeFracs, type Fracs } from './crop'
import type { PlanRow } from './formats'

/** Methods built now, and the build each other one waits for. */
export const RUNNABLE: ReadonlySet<SizeMethod> = new Set(['crop'])
export const WAITS_FOR: Partial<Record<SizeMethod, string>> = {
  extend: 'phase 4', regenerate: 'phase 4', layout: 'phase 4', nearest: 'phase 4', reedit: 'phase 5', reframe: 'phase 6',
}

export const METHOD_WORD: Record<SizeMethod, string> = {
  crop: 'Crop', extend: 'Extend', regenerate: 'Regenerate', layout: 'Layout', nearest: 'Nearest ratio', reedit: 'Re-edit', reframe: 'Reframe',
}

/** Below this share of the size filled by the master, an extend leaves the subject small: regenerate. */
export const REGENERATE_BELOW = 0.35
/** A display banner this long or this tall is laid out on a brand colour field. */
export const STRIP = 3

export interface Master { w: number; h: number; media: 'image' | 'video' }

export interface MethodChoice {
  /** The method the rule table picks. */
  method: SizeMethod
  /** What is made now: the method itself when built, else crop for a still, else nothing. */
  now: SizeMethod | null
  /** Why it is not made as itself now ("Extend needs phase 4"), or why the row cannot be made. */
  waits?: string
  /** The row cannot be made from this master at all (a film from a still). */
  unavailable?: string
  /** The crop keeps every protected box in the safe area. */
  fits: boolean
}

/** The paid methods a capability sheet offers for resize (its method field; contracts check.py). */
export function sheetMethods(sheet: CapabilitySheet | undefined): Set<SizeMethod> {
  const spec = (sheet?.ops as Record<string, { method?: SizeMethod; alternates?: { method?: SizeMethod }[] } | undefined> | undefined)?.resize
  const out = new Set<SizeMethod>()
  for (const s of spec ? [spec, ...(spec.alternates ?? [])] : []) if (s.method) out.add(s.method)
  return out
}

/** The methods the rule table may pick: the free ones and what the routed sheet offers. */
export function availableMethods(sheet: CapabilitySheet | undefined = SHEETS.runway): Set<SizeMethod> {
  return new Set<SizeMethod>(['crop', 'layout', 'reedit', 'reframe', ...sheetMethods(sheet)])
}

/** The share of the size the master fills when extended to it (1: same shape). */
export function filled(master: Aspect, target: Aspect): number {
  const m = master.w / master.h
  const t = target.w / target.h
  return Math.min(m / t, t / m)
}

/** The safe area of a row as shares of its size. */
export function rowFracs(row: Pick<PlanRow, 'format'>): Fracs {
  const f = row.format
  return safeFracs(f.safe_area, f.delivery_px, { width: f.width, height: f.height, unit: f.unit })
}

export function aspectOf(row: Pick<PlanRow, 'format'>): Aspect {
  return { w: row.format.delivery_px.width, h: row.format.delivery_px.height }
}

const wait = (m: SizeMethod) => `${METHOD_WORD[m]} needs ${WAITS_FOR[m] ?? 'a later build'}`

/** The method for one row (approach D), and what is made now. */
export function methodFor(row: PlanRow, master: Master, protect: readonly ProtectBox[] | undefined, available: ReadonlySet<SizeMethod> = availableMethods(), masterLengthS?: number): MethodChoice {
  const target = aspectOf(row)
  if (row.media === 'video') {
    if (master.media !== 'video') return { method: 'reedit', now: null, unavailable: 'Films are made from the ad: select the Video node.', fits: false }
    const same = Math.abs(Math.log(master.w / master.h) - Math.log(target.w / target.h)) < 0.01
    const method: SizeMethod = same ? 'reedit' : 'reframe'
    if (same && masterLengthS && row.length_s && Math.abs(row.length_s - masterLengthS) < 0.5) return { method, now: null, waits: 'The ad itself', fits: true }
    return { method, now: null, waits: wait(method), fits: false }
  }
  if (master.media === 'video') return { method: 'crop', now: null, unavailable: 'Stills are made from a key visual: select a frame or a picture.', fits: false }
  const r = target.w / target.h
  const { fits } = cropBox(master, target, protect, rowFracs(row))
  let method: SizeMethod
  if (row.format.kind === 'display' && (r >= STRIP || r <= 1 / STRIP) && available.has('layout')) method = 'layout'
  else if (fits || (!available.has('extend') && !available.has('regenerate'))) method = 'crop'
  else if (filled(master, target) < REGENERATE_BELOW && available.has('regenerate')) method = 'regenerate'
  else method = available.has('extend') ? 'extend' : 'regenerate'
  if (RUNNABLE.has(method)) return { method, now: method, fits }
  return { method, now: 'crop', waits: wait(method), fits }
}
