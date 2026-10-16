// Export a Campaign board (features/campaign-formats.clan): one zip of every size that is made, named
// <project>_<format-id>_<w>x<h>.png, with manifest.json listing each file's format, method, source,
// pack version and notes. Out-of-home files and the manifest say "Confirm with the media owner".
// Export zip has the previews (at most 2048 px). Export at full size (phase 4) has each size at its
// delivery size: Magnific's upscale of its plate with the type drawn again (labelled per file with the
// model and the scale), the preview itself where it is already the delivery size, and the preview,
// labelled so, where Magnific cannot take it. No cost anywhere in it.

import { strToU8, zipSync } from 'fflate'
import { previewSize as previewOfSize0 } from './crop'
import type { FormatSet, ProductionDocument, Size } from '../contracts/types'
import { assetBytes } from '../export'
import { fullPlan } from './delivery'
import { formatById, shortName } from './formats'
import { sizesOf } from './make'

export const CONFIRM = 'Confirm with the media owner'

const previewOfSize = (s: Size) => previewOfSize0(s.delivery)
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
  /** Export at full size: how the file reached its size. */
  delivery?: 'exact' | 'upscaled' | 'preview'
  /** The model that upscaled it, and by how much. */
  upscale?: { model: string; scale: number }
  locked: boolean
  checks: { code: string; result: string; note: string; ignored: boolean }[]
  notes?: string
  confirm?: string
}

/** The zip for these sizes of a set (all the made ones when `only` is absent). `full`: Export at full
 *  size, with the upscaler's name for the manifest. */
export async function exportSizes(d: ProductionDocument, setId: string, project: string, only?: readonly string[], full?: { model: string }): Promise<{ blob: Blob; name: string; files: number; missing: number }> {
  const set = d.format_sets[setId]
  if (!set) throw new Error('This board is gone.')
  const files: Record<string, Uint8Array> = {}
  const listed: ManifestFile[] = []
  let missing = 0
  for (const s of sizesOf(d, setId)) {
    if (only && !only.includes(s.id)) continue
    if (!s.asset) continue
    const plan = full ? fullPlan(s) : null
    const sha = plan?.kind === 'ready' ? s.full!.asset! : s.asset
    const a = d.assets[sha]
    const bytes = a ? await assetBytes(a) : null
    if (!bytes) {
      missing++
      continue
    }
    const w = a?.w ?? (plan?.kind === 'ready' ? s.delivery.width : previewOfSize(s).width)
    const h = a?.h ?? (plan?.kind === 'ready' ? s.delivery.height : previewOfSize(s).height)
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
      ...(plan ? { delivery: plan.kind === 'ready' ? 'upscaled' as const : plan.kind === 'exact' ? 'exact' as const : 'preview' as const } : {}),
      ...(plan?.kind === 'ready' && full ? { upscale: { model: full.model, scale: s.full?.scale ?? 4 } } : {}),
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
    note: full
      ? `At delivery size: each file says how (exact, upscaled by ${full.model} with the type drawn again at full size, or the preview where it could not be upscaled). Sizes are the format packs' drafts. ${CONFIRM} for every out-of-home and print file.`
      : `Previews at most 2048 px; Export at full size makes the delivery sizes. Sizes are the format packs' drafts. ${CONFIRM} for every out-of-home and print file.`,
    files: listed,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const zip = zipSync(files, { level: 0 })
  return { blob: new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }), name: `${safe(project)}_campaign${full ? '_full-size' : ''}.zip`, files: listed.length, missing }
}
