// A brand ref's payload (features/pt-canvas-r2.clan; UAT round 2 R2-1): a palette holds swatches, a typography ref a
// font, a brand rule its words (contracts common.schema refRoleTable payload; clan-store integrity.ts refuses a brand ref
// without it). jobs/context.ts brandWords reads exactly these fields and sends them to Dex as input.context.

import type { NamedRef, RefRole } from '../contracts/types'

export type BrandPayload = Pick<NamedRef, 'swatches' | 'font' | 'rule'>
export type BrandRole = Extract<RefRole, 'palette' | 'typography' | 'brand_rule'>
export const BRAND_ROLES: readonly BrandRole[] = ['palette', 'typography', 'brand_rule']
export const isBrandRole = (r: RefRole | undefined): r is BrandRole => !!r && (BRAND_ROLES as readonly string[]).includes(r)

/** At most this many swatches are taken from a picture. */
export const SWATCH_MAX = 6

const HEX = /^#[0-9A-F]{6}$/

/** #RRGGBB, upper case. */
export const hexOf = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/**
 * The picture's main colours, most used first, from its RGBA pixels: each pixel binned to 4 bits a channel, the bins
 * averaged, and a colour kept only when it is far enough from the ones already kept (so a gradient is not five blues).
 * Transparent pixels do not count.
 */
export function topColours(data: Uint8ClampedArray | number[], n = SWATCH_MAX, minDistance = 48): string[] {
  const bins = new Map<number, { r: number; g: number; b: number; count: number }>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, count: 0 }
    bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2]; bin.count++
    bins.set(key, bin)
  }
  const ranked = [...bins.values()].sort((a, b) => b.count - a.count).map((x) => [x.r / x.count, x.g / x.count, x.b / x.count])
  const kept: number[][] = []
  for (const c of ranked) {
    if (kept.length >= n) break
    if (kept.every((k) => Math.hypot(k[0] - c[0], k[1] - c[1], k[2] - c[2]) >= minDistance)) kept.push(c)
  }
  return kept.map(([r, g, b]) => hexOf(r, g, b))
}

/** What a brand role still needs before it can be saved, in words; undefined when it has it. */
export function payloadMissing(role: RefRole, p: BrandPayload): string | undefined {
  if (role === 'palette') return p.swatches?.some((s) => HEX.test(s.hex.toUpperCase())) ? undefined : 'Add at least one colour.'
  if (role === 'typography') return p.font?.family.trim() ? undefined : 'Say which font.'
  if (role === 'brand_rule') return p.rule?.text.trim() ? undefined : 'Write the rule.'
  return undefined
}

/** Only the fields the role holds, cleaned: valid upper-case swatches, a trimmed font and use, a trimmed rule. */
export function payloadFor(role: RefRole, p: BrandPayload): BrandPayload {
  if (role === 'palette') {
    const swatches = (p.swatches ?? []).map((s) => ({ hex: s.hex.toUpperCase(), ...(s.name?.trim() ? { name: s.name.trim() } : {}) })).filter((s) => HEX.test(s.hex))
    return { swatches: swatches.filter((s, i) => swatches.findIndex((o) => o.hex === s.hex) === i) }
  }
  if (role === 'typography' && p.font) return { font: { family: p.font.family.trim(), ...(p.font.use?.trim() ? { use: p.font.use.trim() } : {}) } }
  if (role === 'brand_rule' && p.rule) return { rule: { kind: p.rule.kind, text: p.rule.text.trim() } }
  return {}
}

/** The main colours of a picture blob (drawn small first, so a big picture costs nothing). */
export async function coloursOf(blob: Blob, n = SWATCH_MAX): Promise<string[]> {
  const bmp = await createImageBitmap(blob)
  const side = 64
  const c = new OffscreenCanvas(side, side)
  const g = c.getContext('2d')
  if (!g) return []
  g.drawImage(bmp, 0, 0, side, side)
  bmp.close?.()
  return topColours(g.getImageData(0, 0, side, side).data, n)
}
