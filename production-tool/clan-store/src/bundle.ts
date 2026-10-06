// The export: `<handle>.clan` plus `assets/<sha256 hex>.<ext>` in one zip.
// The document holds only hashes and locations; the caller resolves the bytes
// (IndexedDB first, then S3/https), and each one is checked against its hash.
import { zipSync, type Zippable } from 'fflate'
import type { Doc, DocAsset } from './types'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

export function assetExt(mime: string): string {
  return EXT[mime.toLowerCase()] ?? 'bin'
}

export function assetPath(a: Pick<DocAsset, 'sha256' | 'mime'>): string {
  return `assets/${a.sha256.replace(/^sha256:/, '')}.${assetExt(a.mime)}`
}

/** Bytes for an asset, or null when they cannot be found. */
export type AssetResolver = (asset: DocAsset) => Promise<Uint8Array | null>

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export interface ExportZip {
  zip: Uint8Array
  /** Assets the resolver had no bytes for (left out, the export still made). */
  missing: string[]
  /** Assets whose bytes did not hash to their sha256 (left out). */
  mismatched: string[]
}

/** File-safe handle for the .clan's name. */
export function clanFileName(handle: string): string {
  const safe = handle.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${safe || 'document'}.clan`
}

export async function buildExportZip(args: {
  clan: Uint8Array
  doc: Pick<Doc, 'participant' | 'assets'>
  resolve: AssetResolver
}): Promise<ExportZip> {
  const files: Zippable = { [clanFileName(args.doc.participant.handle)]: args.clan }
  const missing: string[] = []
  const mismatched: string[] = []
  const seen = new Set<string>()
  for (const a of args.doc.assets ?? []) {
    if (seen.has(a.sha256)) continue
    seen.add(a.sha256)
    let bytes: Uint8Array | null = null
    try {
      bytes = await args.resolve(a)
    } catch {
      bytes = null
    }
    if (!bytes) {
      missing.push(a.sha256)
      continue
    }
    if (`sha256:${await sha256Hex(bytes)}` !== a.sha256) {
      mismatched.push(a.sha256)
      continue
    }
    // Images and video are already compressed: store them as they are.
    files[assetPath(a)] = [bytes, { level: 0 }]
  }
  return { zip: zipSync(files), missing, mismatched }
}
