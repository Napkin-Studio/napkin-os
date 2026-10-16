// Type as layers (features/campaign-formats.clan, phase 3): the brand line, the logo, supers and legal
// laid out per format by ONE pure function, from the Brand board (logo, palette, font) and the format's
// safe area. The relay draws the result over the crop (relay/typeset.py) and stitch over a film; no
// word or logo ever goes to a model. A size's Edit type changes are its layers overrides.
//
// The rules, per shape (r = width / height), all inside the safe area with a margin:
//   strip (r ≥ 3):        line on the left, logo on the right, legal under the line
//   tall strip (r ≤ 1/3): logo at the top, line in the middle, legal at the foot
//   landscape (r ≥ 1.2):  line at the lower left, logo at the lower right, legal along the foot
//   portrait and square:  logo at the top centre, line in the lower third, legal at the foot
// Type sizes are cap heights as a share of the size's height, never under the channel's minimum
// (OOH is read at a distance; print and display have a floor in pixels).

import type { AssetRef, FormatChannel, FormatSet, NamedRef, ProductionDocument, Region, Size, TypeLayer, TypeLayerKind, TypeLayerOverride } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import { assetRef } from '../jobs/assets'
import type { Relay } from '../relay'
import type { Fracs } from './crop'
import { formatById } from './formats'
import { rowFracs } from './rules'
import { channelOfSize } from './make'

export interface BrandKit {
  /** The logo's asset and its shape. */
  logo?: { sha256: string; w: number; h: number }
  /** The words' colour: the palette's first light swatch, else white. */
  colour: string
  font?: string
}

export interface LayoutIn {
  w: number
  h: number
  channel: FormatChannel
  kind?: string
  fracs: Fracs
  copy: { line?: string; legal?: string; supers?: string[] }
  brand: BrandKit
  overrides?: Partial<Record<TypeLayerKind, TypeLayerOverride>>
}

/** A laid-out layer: the wire TypeLayer, with the logo's asset still a hash. */
export interface Laid extends Omit<TypeLayer, 'image'> { logo?: string; capPx?: number }

/** The smallest cap height a channel's type may have: a share of the size's height, and pixels. */
export const MIN_CAP: Record<FormatChannel, { frac: number; px: number }> = {
  ooh: { frac: 0.04, px: 12 }, social: { frac: 0.022, px: 18 }, print: { frac: 0.012, px: 20 }, display: { frac: 0, px: 9 }, film: { frac: 0.03, px: 20 },
}
/** An out-of-home line is read in 3 to 5 seconds: 7 words or fewer. */
export const OOH_WORDS = 7
/** The logo's clear space: this share of its own height free of type on every side. */
export const CLEAR = 0.25

const clamp01 = (b: Region): Region => {
  const x = Math.max(0, Math.min(1, b.x))
  const y = Math.max(0, Math.min(1, b.y))
  return { x, y, w: Math.max(0.001, Math.min(1 - x, b.w)), h: Math.max(0.001, Math.min(1 - y, b.h)) }
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return 0
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The brand kit from the Brand board's named references (logo, palette, typography). */
export function brandKit(d: ProductionDocument): BrandKit {
  const refs = Object.values(d.refs ?? {}) as NamedRef[]
  const logoRef = refs.find((r) => r.role === 'logo' && r.asset)
  const a = logoRef?.asset ? d.assets[logoRef.asset] : undefined
  const swatches = refs.filter((r) => r.role === 'palette').flatMap((r) => r.swatches ?? [])
  const light = swatches.map((s) => s.hex).find((hex) => luminance(hex) > 0.6)
  const font = refs.find((r) => r.role === 'typography' && r.font?.family)?.font?.family
  return {
    ...(logoRef?.asset ? { logo: { sha256: logoRef.asset, w: a?.w ?? 400, h: a?.h ?? 160 } } : {}),
    colour: light ? (light.startsWith('#') ? light : `#${light}`).toUpperCase() : '#FFFFFF',
    ...(font ? { font } : {}),
  }
}

/** The cap height (as a share of the size's height) for a layer, at least the channel's minimum. */
export function capFor(inp: Pick<LayoutIn, 'channel' | 'h'>, want: number, legal = false): number {
  const min = MIN_CAP[inp.channel]
  const floor = legal ? Math.max(6 / inp.h, 0.008) : Math.max(min.frac, min.px / inp.h)
  return Math.min(0.5, Math.max(want, floor))
}

/** Lay the type out for one size. Pure. */
export function layoutType(inp: LayoutIn): Laid[] {
  const { w, h, fracs, copy, brand, overrides = {} } = inp
  const r = w / h
  const [l, t, rt, b] = fracs
  const m = 0.035 * Math.min(w, h)
  // The safe box with a margin, in 0-1 of the size.
  const S = { x: l + m / w, y: t + m / h, w: 1 - l - rt - (2 * m) / w, h: 1 - t - b - (2 * m) / h }
  const out: Laid[] = []
  const line = copy.line?.trim()
  const legal = copy.legal?.trim()
  const lineCap = capFor(inp, r >= 3 ? 0.18 : r <= 1 / 3 ? 0.025 : inp.channel === 'ooh' ? 0.06 : 0.035)
  const legalCap = capFor(inp, r >= 3 ? 0.06 : 0.011, true)
  const lineH = (lineCap / 0.72) * 1.18 * (r >= 3 ? 1 : 2) // room for two lines, one on a strip
  const legalH = (legalCap / 0.72) * 1.18
  const logoAspect = brand.logo ? brand.logo.w / brand.logo.h : 2.5
  const push = (kind: TypeLayerKind, box: Region, extra: Partial<Laid>) => {
    const o = overrides[kind]
    if (o?.hidden) return
    const text = o?.text ?? extra.text
    if (kind !== 'logo' && !text) return
    const sizeFrac = extra.sizeFrac ? Math.min(0.5, extra.sizeFrac * (o?.scale ?? 1)) : undefined
    out.push({ ...extra, kind, box: clamp01(o?.box ?? box), ...(text ? { text } : {}), ...(sizeFrac ? { sizeFrac, capPx: sizeFrac * h } : {}) })
  }
  const lineLayer = (box: Region, align: TypeLayer['align']) =>
    push('line', box, { text: line, sizeFrac: lineCap, colour: brand.colour, align, weight: 'bold' })
  const legalLayer = (box: Region, align: TypeLayer['align']) =>
    push('legal', box, { text: legal, sizeFrac: legalCap, colour: brand.colour, align })
  const logoLayer = (box: Region, align: TypeLayer['align']) => {
    if (!brand.logo) return
    // The logo keeps its shape inside its box.
    const fit = Math.min((box.w * w) / logoAspect, box.h * h)
    const lw = (fit * logoAspect) / w
    const lh = fit / h
    const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w - lw : box.x + (box.w - lw) / 2
    push('logo', { x, y: box.y + (box.h - lh) / 2, w: lw, h: lh }, { logo: brand.logo.sha256, align })
  }

  if (r >= 3) {
    lineLayer({ x: S.x, y: S.y, w: S.w * 0.62, h: legal ? S.h * 0.7 : S.h }, 'left')
    if (legal) legalLayer({ x: S.x, y: S.y + S.h * 0.72, w: S.w * 0.62, h: S.h * 0.28 }, 'left')
    logoLayer({ x: S.x + S.w * 0.7, y: S.y + S.h * 0.15, w: S.w * 0.3, h: S.h * 0.7 }, 'right')
  } else if (r <= 1 / 3) {
    logoLayer({ x: S.x, y: S.y, w: S.w, h: Math.min(S.h * 0.12, ((S.w / logoAspect) * w) / h) }, 'centre')
    lineLayer({ x: S.x, y: S.y + S.h * 0.35, w: S.w, h: S.h * 0.3 }, 'centre')
    legalLayer({ x: S.x, y: S.y + S.h - legalH * 3, w: S.w, h: legalH * 3 }, 'centre')
  } else if (r >= 1.2) {
    const logoH = Math.min(S.h * 0.14, ((S.w * 0.2) / logoAspect) * (w / h))
    const foot = legal ? legalH * 1.6 : 0
    lineLayer({ x: S.x, y: S.y + S.h - foot - lineH, w: S.w * 0.62, h: lineH }, 'left')
    if (legal) legalLayer({ x: S.x, y: S.y + S.h - foot, w: S.w * 0.62, h: foot }, 'left')
    logoLayer({ x: S.x + S.w * 0.74, y: S.y + S.h - foot - logoH, w: S.w * 0.26, h: logoH }, 'right')
  } else {
    const logoH = Math.min(S.h * 0.08, ((S.w * 0.4) / logoAspect) * (w / h))
    logoLayer({ x: S.x, y: S.y, w: S.w, h: logoH }, 'centre')
    const foot = legal ? legalH * 2.4 : 0
    lineLayer({ x: S.x, y: S.y + S.h - foot - lineH * 1.1, w: S.w, h: lineH }, 'centre')
    if (legal) legalLayer({ x: S.x, y: S.y + S.h - foot, w: S.w, h: foot }, 'centre')
  }
  return out
}

/** The layout input for a size of a set. */
export function layoutInput(d: ProductionDocument, set: FormatSet, size: Size): LayoutIn {
  const f = formatById(size.format.format_id)
  return {
    w: size.delivery.width, h: size.delivery.height, channel: channelOfSize(size), kind: f?.format.kind,
    fracs: f ? rowFracs({ format: f.format }) : [0, 0, 0, 0],
    copy: set.copy ?? {}, brand: brandKit(d), overrides: size.layers,
  }
}

/** The wire layers for a size's resize job: the logo as an asset the relay can read. */
export async function layersFor(deps: { relay: Relay; doc: DocumentStore }, set: FormatSet, size: Size): Promise<TypeLayer[]> {
  const d = deps.doc.get()
  const out: TypeLayer[] = []
  for (const { logo, capPx: _cap, ...layer } of layoutType(layoutInput(d, set, size))) {
    void _cap
    if (layer.kind !== 'logo') {
      out.push(layer)
      continue
    }
    if (!logo) continue
    let image: AssetRef
    try {
      image = await assetRef(deps.relay, logo, d)
    } catch {
      continue // the logo is not in this browser: the size is made without it, and Jude says so
    }
    out.push({ ...layer, image })
  }
  return out
}
