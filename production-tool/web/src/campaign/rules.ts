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
// Video node through its own sheet (phases 5 and 6: film.ts, filmJobs.ts, FilmSizesSheet.tsx).

import type { Aspect, CapabilitySheet, Config, Provider, ProtectBox, SizeMethod } from '../contracts/types'
import { SHEETS } from '../contracts/load'
import { modelOn, type Sheets } from '../capabilities'
import { cropBox, safeFracs, type Fracs } from './crop'
import type { PlanRow } from './formats'

/** Methods built now, and the build each other one waits for. */
export const RUNNABLE: ReadonlySet<SizeMethod> = new Set(['crop', 'layout', 'extend', 'regenerate'])
export const WAITS_FOR: Partial<Record<SizeMethod, string>> = {
  nearest: 'a later build', reedit: 'the Video node\'s Make all sizes', reframe: 'the Video node\'s Make all sizes',
}
/** The methods a still can be changed to on its tile. */
export const STILL_METHODS = ['crop', 'extend', 'regenerate', 'layout'] as const
/** The methods that spend (a job on a provider, recorded with its cost in History). */
export const PAID: ReadonlySet<SizeMethod> = new Set(['extend', 'regenerate'])

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

/** A method in the tray's and the tile's words: "Extend · Ideogram 4.5", "Crop · free". No price. */
export function methodWords(method: SizeMethod, models: Partial<Record<SizeMethod, MethodModel>>): string {
  if (PAID.has(method)) return models[method] ? `${METHOD_WORD[method]} · ${models[method]!.label}` : `${METHOD_WORD[method]} · off for your agency`
  return method === 'crop' || method === 'layout' ? `${METHOD_WORD[method]} · free` : METHOD_WORD[method]
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
  if (f < REGENERATE_BELOW && available.has('regenerate')) return 'regenerate'
  if (available.has('extend')) return 'extend'
  return available.has('regenerate') ? 'regenerate' : 'crop'
}
