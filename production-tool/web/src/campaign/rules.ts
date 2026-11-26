// The rule table (features/campaign-formats.clan, approach D): a method per format, from the master,
// the protected boxes, the format's shape and safe area, and the methods the capability sheet offers.
// Pure. The paid tests (docs/production-tool/campaign-formats-tests-2026-10-16.md) set the defaults:
// crop when the protected boxes fit the safe area; else extend (Ideogram 4.5 at high reached every
// shape tested, up to 4:1 and 9:16), or regenerate on Gemini 3 Pro when an extend would leave the
// subject small (the master would fill under 35% of the size); layout for banner strips.
//
// What runs (phase 4): crop and layout (free, on the relay), extend (Ideogram 4.5 at high) and
// regenerate (Gemini 3 Pro), each paid method on the model the agency allows (an agency with Ideogram
// off regenerates instead of extending). A film's lengths (reedit) and shapes (reframe) are made from a
// Film node through its own sheet (phases 5 and 6: film.ts, filmJobs.ts, FilmSizesSheet.tsx).

import type { Aspect, CapabilitySheet, Config, Provider, ProtectBox, SizeMethod } from '../contracts/types'
import { SHEETS } from '../contracts/load'
import { modelOn, type Sheets } from '../capabilities'
import { cropBox, safeFracs, type Fracs } from './crop'
import type { PlanRow } from './formats'

/** Methods built now, and the build each other one waits for. */
export const RUNNABLE: ReadonlySet<SizeMethod> = new Set(['crop', 'layout', 'extend', 'regenerate'])
export const WAITS_FOR: Partial<Record<SizeMethod, string>> = {
  nearest: 'a later build', reedit: 'the Film node\'s Make all sizes', reframe: 'the Film node\'s Make all sizes',
}
/** The methods a still can be changed to on its tile. */
export const STILL_METHODS = ['crop', 'extend', 'regenerate', 'layout'] as const
/** The methods that spend (a job on a provider, recorded with its cost in History). */
export const PAID: ReadonlySet<SizeMethod> = new Set(['extend', 'regenerate'])

export const METHOD_WORD: Record<SizeMethod, string> = {
  crop: 'Crop', extend: 'Extend', regenerate: 'Regenerate', layout: 'Layout', nearest: 'Nearest ratio', reedit: 'Re-edit', reframe: 'Reframe',
}

/** Below this share of the size filled by the master, an extend leaves the subject small: regenerate (Resize on canvas pictures). */
export const REGENERATE_BELOW = 0.35
/**
 * The same, for Make all sizes (2026-11-03, art-director): lower, because a regenerate draws a new picture that rarely
 * matches the master, so it is the last resort; an extend keeps the master's own pixels.
 */
export const SET_REGENERATE_BELOW = 0.25
/**
 * An extend grows the picture in steps of at most EXTEND_STEP_GROWTH, at most EXTEND_STEPS_MAX of them (relay/formats.py
 * steps_needed and extend_fits: the same numbers). Past that (16:9 to 9:16 is 3.2 times) the bands were seeded with
 * mirrored shapes the model kept, four suns stacked (UAT round 4 S1-1): it is not an extend, it is a Redraw at that shape.
 */
export const EXTEND_STEP_GROWTH = 0.35
export const EXTEND_STEPS_MAX = 3

/** How many extend steps of at most 35 % reach `target` from `master` (uncapped; 1 for the same shape). */
export function extendSteps(master: Aspect, target: Aspect): number {
  const grow = 1 / filled(master, target)
  if (grow <= 1.0001) return 1
  return Math.max(1, Math.ceil(Math.log(grow) / Math.log(1 + EXTEND_STEP_GROWTH) - 1e-9))
}

/** Whether an extend reaches `target` in at most three steps of 35 % (16:9 to 21:9, 1:1 or 4:5 does; to 9:16 does not). */
export const extendFits = (master: Aspect, target: Aspect): boolean => extendSteps(master, target) <= EXTEND_STEPS_MAX

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

type ResizeSpec = { model: string; label?: string; method?: SizeMethod; alternates?: { model: string; label?: string; method?: SizeMethod }[] }

/** The paid methods a capability sheet offers for resize (its method field; contracts check.py). */
export function sheetMethods(sheet: CapabilitySheet | undefined): Set<SizeMethod> {
  const spec = (sheet?.ops as Record<string, ResizeSpec | undefined> | undefined)?.resize
  const out = new Set<SizeMethod>()
  for (const s of spec ? [spec, ...(spec.alternates ?? [])] : []) if (s.method) out.add(s.method)
  return out
}

/** The model a paid method runs on, in the tray's and the tile's words ("Ideogram 4.5"). */
export interface MethodModel { provider: Provider; model: string; label: string }

/**
 * The model each paid method runs on for this agency: on the first provider the config routes resize
 * to, the op's own model or its alternate whose method it is, when the agency allows its maker (the
 * relay picks the same: service._run_model). No config: Runway's sheet, every maker on.
 */
export function methodModels(config?: Pick<Config, 'routing' | 'allow'>, sheets: Sheets = SHEETS): Partial<Record<SizeMethod, MethodModel>> {
  const out: Partial<Record<SizeMethod, MethodModel>> = {}
  for (const provider of config ? config.routing.resize ?? [] : ['runway' as Provider]) {
    const spec = (sheets[provider]?.ops as Record<string, ResizeSpec | undefined> | undefined)?.resize
    for (const s of spec ? [spec, ...(spec.alternates ?? [])] : []) {
      if (!s.method || out[s.method] || !modelOn(sheets, provider, s.model, config?.allow)) continue
      out[s.method] = { provider, model: s.model, label: s.label ?? s.model }
    }
  }
  return out
}

/** The methods the rule table may pick: the free ones and the paid ones the agency can run. */
export function availableMethods(models: Partial<Record<SizeMethod, MethodModel>> = methodModels()): Set<SizeMethod> {
  return new Set<SizeMethod>(['crop', 'layout', 'reedit', 'reframe', ...(Object.keys(models) as SizeMethod[])])
}

/** A method in the tray's and the tile's words: "Extend · Ideogram 4.5", "Crop". No price, and no "free" or "paid" (owner
 *  rule 2026-10-13, UAT round 4 S2-4: costs only in Decisions). */
export function methodWords(method: SizeMethod, models: Partial<Record<SizeMethod, MethodModel>>): string {
  if (PAID.has(method)) return models[method] ? `${METHOD_WORD[method]} · ${models[method]!.label}` : `${METHOD_WORD[method]} · off for your agency`
  return METHOD_WORD[method]
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
    if (master.media !== 'video') return { method: 'reedit', now: null, unavailable: 'Films are made from the ad: select the Film node.', fits: false }
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
  else if ((filled(master, target) < SET_REGENERATE_BELOW || !extendFits(master, target)) && available.has('regenerate')) method = 'regenerate'
  else method = available.has('extend') && extendFits(master, target) ? 'extend' : 'regenerate'
  if (RUNNABLE.has(method) && (!PAID.has(method) || available.has(method))) return { method, now: method, fits }
  return { method, now: 'crop', waits: wait(method), fits }
}

/** Auto on a loose picture (features/resize-selection.clan): a crop keeps at least this share of it. */
export const AUTO_CROP_KEEPS = 0.8

/**
 * Auto for Resize… on canvas pictures, which have no protected boxes: the rule table's order. Crop when
 * the crop keeps most of the picture (it "fits"); else extend; regenerate where the picture would fill
 * under REGENERATE_BELOW of the shape (the subject must fill it), or when extend is off for the agency.
 */
export function autoMethod(master: Aspect, target: Aspect, available: ReadonlySet<SizeMethod> = availableMethods()): SizeMethod {
  const f = filled(master, target)
  if (f >= AUTO_CROP_KEEPS) return 'crop'
  if ((f < REGENERATE_BELOW || !extendFits(master, target)) && available.has('regenerate')) return 'regenerate'
  if (available.has('extend') && extendFits(master, target)) return 'extend'
  return available.has('regenerate') ? 'regenerate' : 'crop'
}
