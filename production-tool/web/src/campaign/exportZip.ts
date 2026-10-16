// Export a Campaign board (features/campaign-formats.clan): one zip of every size that is made, named
// <project>_<format-id>_<w>x<h>.png, with manifest.json listing each file's format, method, source,
// pack version and notes. Out-of-home files and the manifest say "Confirm with the media owner".
// Phase 2 exports the previews (at most 2048 px); delivery size with upscales comes with phase 4.
// No cost anywhere in it.

import { strToU8, zipSync } from 'fflate'
import type { FormatSet, ProductionDocument, Size } from '../contracts/types'
import { assetBytes } from '../export'
import { formatById, shortName } from './formats'
import { sizesOf } from './make'

export const CONFIRM = 'Confirm with the media owner'

const safe = (s: string) => s.trim().toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48) || 'project'

export function fileName(project: string, size: Size, w: number, h: number): string {
  return `${safe(project)}_${size.format.format_id}_${w}x${h}.png`
}

export interface ManifestFile {
  file: string
  format_id: string
  format: string
  pack_id: string
  pack_version: string
  channel: string
  method: Size['method']
  source: { kind: FormatSet['master']['kind']; id: string; asset?: string }
  delivery_px: { width: number; height: number }
  file_px: { width: number; height: number }
  preview: boolean
  locked: boolean
  checks: { code: string; result: string; note: string; ignored: boolean }[]
  notes?: string
  confirm?: string
}

/** The zip for these sizes of a set (all the made ones when `only` is absent). */
export async function exportSizes(d: ProductionDocument, setId: string, project: string, only?: readonly string[]): Promise<{ blob: Blob; name: string; files: number; missing: number }> {
  const set = d.format_sets[setId]
  if (!set) throw new Error('This board is gone.')
  const files: Record<string, Uint8Array> = {}
  const listed: ManifestFile[] = []
  let missing = 0
  for (const s of sizesOf(d, setId)) {
    if (only && !only.includes(s.id)) continue
    if (!s.asset) continue
    const a = d.assets[s.asset]
    const bytes = a ? await assetBytes(a) : null
    if (!bytes) {
      missing++
      continue
    }
    const w = a?.w ?? s.delivery.width
    const h = a?.h ?? s.delivery.height
    const name = fileName(project, s, w, h)
    files[name] = bytes
    const f = formatById(s.format.format_id)
    const ooh = f?.format.kind === 'ooh' || f?.format.channel === 'ooh'
    listed.push({
      file: name,
      format_id: s.format.format_id,
      format: f ? shortName(f.format) : s.format.format_id,
      pack_id: s.format.pack_id,
      pack_version: s.format.pack_version,
      channel: f?.format.channel ?? (s.media === 'video' ? 'film' : 'social'),
      method: s.method,
      source: { kind: set.master.kind, id: set.master.id, ...(s.from_asset ? { asset: s.from_asset } : {}) },
      delivery_px: s.delivery,
      file_px: { width: w, height: h },
      preview: w !== s.delivery.width || h !== s.delivery.height,
      locked: !!s.locked,
      checks: Object.entries(s.checks ?? {}).map(([code, c]) => ({ code, result: c!.result, note: c!.note, ignored: !!c!.ignored })),
      ...(f?.format.notes ? { notes: f.format.notes } : {}),
      ...(ooh ? { confirm: CONFIRM } : {}),
    })
  }
  if (!listed.length) throw new Error('No size is made yet: nothing to export.')
  const manifest = {
    project,
    exported_at: new Date().toISOString(),
    plan: set.plan ?? { kind: 'pack', id: set.pack.pack_id },
    master: set.master,
    note: `Previews at most 2048 px; delivery sizes come with a later build. Sizes are the format packs' drafts. ${CONFIRM} for every out-of-home and print file.`,
    files: listed,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const zip = zipSync(files, { level: 0 })
  return { blob: new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }), name: `${safe(project)}_campaign.zip`, files: listed.length, missing }
}
