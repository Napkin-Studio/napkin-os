// Export: a zip of document.json, canvas.excalidraw and assets/<sha256>.<ext>.
// TODO(wiring, after D9): pack the document as a .clan through the CLAN store
// (DocumentStore.exportClan, napkin-wasm) and put it in the zip beside these.

import { serializeAsJSON } from '@excalidraw/excalidraw'
import { zipSync, strToU8 } from 'fflate'
import type { CanvasSnapshot } from './canvas/controller'
import { CANVAS_KEY } from './canvas/controller'
import type { DocumentStore } from './doc/types'
import { getBlob } from './lib/blobs'
import { extFor, hexOf } from './lib/hash'
import { idbGet } from './lib/idb'

export async function exportBundle(store: DocumentStore): Promise<{ blob: Blob; name: string; missing: number }> {
  const doc = store.get()
  const files: Record<string, Uint8Array> = {}
  files['document.json'] = strToU8(JSON.stringify(doc, null, 2))
  const canvas = await idbGet<CanvasSnapshot>('kv', CANVAS_KEY)
  files['canvas.excalidraw'] = strToU8(serializeAsJSON(canvas?.elements ?? [], {}, canvas?.files ?? {}, 'local'))
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
  return { blob: new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }), name: `napkin-${doc.participant.handle}-production.zip`, missing }
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
