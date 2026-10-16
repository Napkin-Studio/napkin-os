// The format packs and the campaign plans Make all sizes reads (features/campaign-formats.clan;
// contracts/format-packs.json, the owner's draft). Pure: a plan or a pack in, the formats it makes out,
// each with its Campaign board lane and, for a film, the lengths it is cut to.

import packsFile from '../../../contracts/format-packs.json'
import type { DeliveryPx, FormatChannel, SafeArea } from '../contracts/types'

export interface PackFormat {
  id: string
  name: string
  kind: 'image' | 'video' | 'display' | 'ooh' | 'print'
  channel?: FormatChannel
  width: number
  height: number
  unit: 'px' | 'mm'
  ratio: string
  delivery_px: DeliveryPx
  safe_area?: SafeArea
  bleed_mm?: number
  notes?: string
  verified: boolean
}
export interface Pack { id: string; name: string; formats: PackFormat[] }
export interface Plan { id: string; name: string; note?: string; items: { pack_id: string; format_id: string; lengths_s?: number[] }[] }
interface PacksFile { version: string; packs: Pack[]; plans?: Plan[] }

const FILE = packsFile as unknown as PacksFile
export const PACKS_VERSION = FILE.version
export const PACKS: readonly Pack[] = FILE.packs
export const PLANS: readonly Plan[] = FILE.plans ?? []

/** The lanes of the Campaign board, in order, with their names. */
export const LANES: readonly { channel: FormatChannel; label: string }[] = [
  { channel: 'film', label: 'Film and online video' },
  { channel: 'social', label: 'Social' },
  { channel: 'ooh', label: 'Out of home' },
  { channel: 'print', label: 'Print' },
  { channel: 'display', label: 'Display' },
]

/** A format's lane: its own channel, else by its kind. */
export function channelOf(f: Pick<PackFormat, 'channel' | 'kind'>): FormatChannel {
  if (f.channel) return f.channel
  return f.kind === 'video' ? 'film' : f.kind === 'image' ? 'social' : f.kind
}

/** One row Make all sizes may make: a format of a pack, with a length for a film. */
export interface PlanRow {
  key: string
  pack: Pack
  format: PackFormat
  channel: FormatChannel
  media: 'image' | 'video'
  /** A film's length (s); absent for a still. */
  length_s?: number
}

/** The film lengths when nothing else is said (owner decision CF5: 30 → 15 and 6). */
export const DEFAULT_LENGTHS = [30, 15, 6]

/** What the sheet offers: the Campaign launch plan first, then each pack. */
export function planChoices(): { kind: 'plan' | 'pack'; id: string; name: string }[] {
  return [...PLANS.map((p) => ({ kind: 'plan' as const, id: p.id, name: p.name })), ...PACKS.map((p) => ({ kind: 'pack' as const, id: p.id, name: p.name }))]
}

export function findFormat(packId: string, formatId: string): { pack: Pack; format: PackFormat } | null {
  for (const pack of PACKS) {
    if (pack.id !== packId) continue
    const format = pack.formats.find((f) => f.id === formatId)
    if (format) return { pack, format }
  }
  return null
}

/** A format by id alone (ids are unique across the file). */
export function formatById(formatId: string): { pack: Pack; format: PackFormat } | null {
  for (const pack of PACKS) {
    const format = pack.formats.find((f) => f.id === formatId)
    if (format) return { pack, format }
  }
  return null
}

/** A row: a film when it has a length, else a still made for the placement (a static Reel or Story). */
const row = (pack: Pack, format: PackFormat, length_s?: number): PlanRow => ({
  key: length_s ? `${format.id}@${length_s}` : format.id,
  pack, format, channel: length_s ? 'film' : channelOf(format) === 'film' ? 'social' : channelOf(format), media: length_s ? 'video' : 'image',
  ...(length_s ? { length_s } : {}),
})

/**
 * The rows of a plan or a pack, in board order. A film (the film lane) is cut to lengths: a pack's to
 * `lengths` (default 30, 15, 6), a plan's to its own, of which `lengths` (when given) keeps those it names.
 * Every other format is a still, a social video placement included (a static Reel or Story).
 */
export function rowsOf(choice: { kind: 'plan' | 'pack'; id: string }, lengths?: readonly number[]): PlanRow[] {
  const out: PlanRow[] = []
  if (choice.kind === 'plan') {
    const plan = PLANS.find((p) => p.id === choice.id)
    for (const item of plan?.items ?? []) {
      const f = findFormat(item.pack_id, item.format_id)
      if (!f) continue
      if (!item.lengths_s) out.push(row(f.pack, f.format))
      else for (const s of item.lengths_s.filter((s) => !lengths || lengths.includes(s))) out.push(row(f.pack, f.format, s))
    }
    return out
  }
  const pack = PACKS.find((p) => p.id === choice.id)
  for (const f of pack?.formats ?? []) {
    if (channelOf(f) !== 'film') out.push(row(pack!, f))
    else for (const s of lengths ?? DEFAULT_LENGTHS) out.push(row(pack!, f, s))
  }
  return out
}

/** "1440×2560", or the physical size for OOH and print ("6.1×3.0 m", "210×297 mm"). */
export function sizeWords(f: Pick<PackFormat, 'width' | 'height' | 'unit' | 'delivery_px'>): string {
  if (f.unit === 'mm') {
    if (f.width >= 1000 || f.height >= 1000) return `${(f.width / 1000).toFixed(1)}×${(f.height / 1000).toFixed(1)} m`
    return `${Math.round(f.width)}×${Math.round(f.height)} mm`
  }
  return `${f.delivery_px.width}×${f.delivery_px.height}`
}

/** A short name for a tile: the pack's long name without its brackets ("48-sheet billboard"). */
export function shortName(f: Pick<PackFormat, 'name'>): string {
  return f.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}
