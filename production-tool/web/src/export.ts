// Export: a zip of <handle>.clan (the document and its decision chain, from
// napkin-wasm), canvas.excalidraw and assets/<sha256>.<ext>. Without the CLAN
// store (the wasm did not load) it falls back to document.json in the zip.

import { serializeAsJSON } from '@excalidraw/excalidraw'
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { buildExportZip, ClanBackedStore } from './doc/clan'
import type { CanvasSnapshot } from './canvas/controller'
import { CANVAS_KEY } from './canvas/controller'
import type { DocAsset } from './contracts/types'
import type { DocumentStore } from './doc/types'
import { getBlob } from './lib/blobs'
import { extFor, hexOf } from './lib/hash'
import { idbGet } from './lib/idb'

/** Bytes for an asset: this browser first, then its https locations. */
export async function assetBytes(a: Pick<DocAsset, 'sha256' | 'locations'>): Promise<Uint8Array | null> {
  const blob = await getBlob(a.sha256)
  if (blob) return new Uint8Array(await blob.arrayBuffer())
  for (const loc of a.locations ?? []) {
    if (!loc.startsWith('https://')) continue
    try {
      const res = await fetch(loc)
      if (res.ok) return new Uint8Array(await res.arrayBuffer())
    } catch { /* try the next */ }
  }
  return null
}

/** `<handle>.clan`, file-safe. */
export function clanName(handle: string): string {
  return `${handle.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'document'}.clan`
}

async function canvasFile(): Promise<Uint8Array> {
  const canvas = await idbGet<CanvasSnapshot>('kv', CANVAS_KEY)
  return strToU8(serializeAsJSON(canvas?.elements ?? [], {}, canvas?.files ?? {}, 'local'))
}

export async function exportBundle(store: DocumentStore): Promise<{ blob: Blob; name: string; missing: number }> {
  const doc = store.get()
  const name = `napkin-${doc.participant.handle}-production.zip`
  if (store instanceof ClanBackedStore) {
    const clan = await store.exportClan()
    const { zip, missing, mismatched } = await buildExportZip({ clan, doc, resolve: assetBytes })
    const files = unzipSync(zip) as Zippable
    files['canvas.excalidraw'] = await canvasFile()
    const out = zipSync(files, { level: 0 })
    const packed = doc.assets.length - missing.length - mismatched.length
    void store.record('exported the work', `${clanName(doc.participant.handle)} and ${packed} assets`)
      .then(() => store.clan.mirrorNow('manual'))
      .catch(() => {})
    return { blob: new Blob([out.slice().buffer as ArrayBuffer], { type: 'application/zip' }), name, missing: missing.length + mismatched.length }
  }
  const files: Record<string, Uint8Array> = {}
  files['document.json'] = strToU8(JSON.stringify(doc, null, 2))
  files['canvas.excalidraw'] = await canvasFile()
  let missing = 0
  for (const a of doc.assets) {
    const blob = await getBlob(a.sha256)
    if (!blob) {
      missing++
      continue
    }
    files[`assets/${hexOf(a.sha256)}.${extFor(a.mime)}`] = new Uint8Array(await blob.arrayBuffer())
  }
  const zip = zipSync(files, { level: 0 })
  return { blob: new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }), name, missing }
}

/** Just the .clan: the document with its whole decision chain. */
export async function exportClanFile(store: ClanBackedStore): Promise<{ blob: Blob; name: string }> {
  await store.record('exported the .clan', clanName(store.get().participant.handle))
  const bytes = await store.exportClan()
  void store.clan.mirrorNow('manual').catch(() => {})
  return { blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/vnd.clan+zip' }), name: clanName(store.get().participant.handle) }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
