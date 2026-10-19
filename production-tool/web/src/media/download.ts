// Saving media (features/media-download.clan): one file, or all of it as one zip. The bytes come
// from this browser first, else from the relay's copy (the asset's first https location); with
// neither, nothing is saved and the caller says so. Each download is one beta event, never bytes.

import { zipSync, type Zippable } from 'fflate'
import type { ProductionDocument, Sha256 } from '../contracts/types'
import { record } from '../dogfood/recorder'
import { download } from '../export'
import { remoteUrl } from '../jobs/assets'
import { getBlob } from '../lib/blobs'
import { mediaItems, zipName, type MediaItem, type ViewOf } from './names'

export type BytesFrom = 'browser' | 'relay'

/** The bytes of one asset: this browser, else the relay's copy; null when neither has it. */
export async function mediaBytes(doc: Pick<ProductionDocument, 'assets'>, sha: Sha256): Promise<{ blob: Blob; from: BytesFrom } | null> {
  const local = await getBlob(sha)
  if (local) return { blob: local, from: 'browser' }
  const url = remoteUrl(doc, sha)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (res.ok) return { blob: await res.blob(), from: 'relay' }
  } catch { /* not reachable: said as missing */ }
  return null
}

/** Save one item. False when its bytes are nowhere (nothing is saved). */
export async function downloadItem(doc: ProductionDocument, item: MediaItem): Promise<boolean> {
  const got = await mediaBytes(doc, item.sha256)
  record('download', item.kind, { which: item.which, ok: !!got, ...(got ? { from: got.from } : {}) })
  if (!got) return false
  const blob = got.blob.type ? got.blob : new Blob([got.blob], { type: item.mime })
  download(blob, item.name)
  return true
}

/** Every piece of media as one zip: pictures/, storyboard/, clips/, ad/. Stored, not compressed
 *  (pictures and videos are compressed already, and a big project's clips would only cost time). */
export async function mediaZip(doc: ProductionDocument, project: string | undefined, views?: Map<Sha256, ViewOf>, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; name: string; packed: number; missing: MediaItem[] }> {
  const items = mediaItems(doc, project, views)
  const files: Zippable = {}
  const missing: MediaItem[] = []
  let done = 0
  for (const item of items) {
    onProgress?.(done, items.length)
    const got = await mediaBytes(doc, item.sha256)
    if (got) files[`${item.folder}/${item.name}`] = new Uint8Array(await got.blob.arrayBuffer())
    else missing.push(item)
    done++
  }
  onProgress?.(done, items.length)
  const zip = zipSync(files, { level: 0 })
  return { blob: new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }), name: zipName(project), packed: items.length - missing.length, missing }
}

/** Download all media: the zip saved, and one beta event for it. */
export async function downloadAllMedia(doc: ProductionDocument, project: string | undefined, views?: Map<Sha256, ViewOf>, onProgress?: (done: number, total: number) => void): Promise<{ packed: number; missing: number }> {
  const { blob, name, packed, missing } = await mediaZip(doc, project, views, onProgress)
  record('download', 'media-zip', { which: name, packed, missing: missing.length })
  if (packed) download(blob, name)
  return { packed, missing: missing.length }
}
