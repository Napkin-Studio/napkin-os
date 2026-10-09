// Open a file (features/project-home.clan): an Export zip (export.ts: the .clan,
// assets/<sha256>.<ext> and canvas.excalidraw; or document.json when it was made
// without the .clan engine) or a bare .clan becomes a new project. Its pictures
// go into the shared blob store (each checked against its hash) and its canvas
// is put back.

import { unzipSync } from 'fflate'
import { sha256Hex } from '../../../clan-store/src'
import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument } from '../contracts/types'

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

export interface Unpacked {
  /** The .clan bytes, when there is one. */
  clan?: Uint8Array
  /** The plain-data document (an export made without the .clan engine). */
  json?: ProductionDocument
  canvas?: CanvasSnapshot
  /** Pictures and clips whose bytes match their name's hash. */
  assets: { sha256: string; bytes: Uint8Array; mime: string }[]
  /** Assets left out because their bytes did not match their hash. */
  mismatched: number
  /** A name from the file, for when the document gives none. */
  fileName: string
}

export class NotAProject extends Error {}

export async function unpackFile(bytes: Uint8Array, fileName: string): Promise<Unpacked> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new NotAProject('That is not an Export zip or a .clan file.')
  }
  const name = fileName.replace(/\.(zip|clan)$/i, '').replace(/^napkin-(.*)-production$/, '$1').trim()
  // A bare .clan is itself a zip, with its manifest at the top.
  if ('manifest.yaml' in entries) return { clan: bytes, assets: [], mismatched: 0, fileName: name }

  const out: Unpacked = { assets: [], mismatched: 0, fileName: name }
  const clanName = Object.keys(entries).find((k) => !k.includes('/') && k.endsWith('.clan'))
  if (clanName) out.clan = entries[clanName]
  else if (entries['document.json']) {
    try {
      out.json = JSON.parse(new TextDecoder().decode(entries['document.json'])) as ProductionDocument
    } catch {
      throw new NotAProject('The zip\'s document.json could not be read.')
    }
  } else throw new NotAProject('That zip has no .clan in it: choose an Export zip or a .clan file.')

  if (entries['canvas.excalidraw']) {
    try {
      const scene = JSON.parse(new TextDecoder().decode(entries['canvas.excalidraw'])) as Partial<CanvasSnapshot>
      out.canvas = { elements: scene.elements ?? [], files: scene.files ?? {} }
    } catch { /* no canvas then; the document still comes in */ }
  }
  for (const [path, data] of Object.entries(entries)) {
    const m = /^assets\/([0-9a-f]{64})\.(\w+)$/.exec(path)
    if (!m) continue
    if ((await sha256Hex(data)) !== m[1]) {
      out.mismatched++
      continue
    }
    out.assets.push({ sha256: `sha256:${m[1]}`, bytes: data, mime: MIME[m[2].toLowerCase()] ?? 'application/octet-stream' })
  }
  return out
}
