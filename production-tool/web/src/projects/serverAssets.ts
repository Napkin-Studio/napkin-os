// A project's pictures and clips on the relay (features/personal-workspaces.clan), so it opens in
// another browser with every one of them.
//   - Saving sends each picture the relay cannot already reach (no https location: drawn, uploaded,
//     or a result on the dev server) to in/<sha256>, by its own hash, once per session.
//   - Opening fetches each one this browser lacks: from its https locations, else from in/<sha256>;
//     the bytes must hash to the name. One that cannot be found stops the open and is named.

import type { DocAsset, InputMime, ProductionDocument } from '../contracts/types'
import { getBlob, putBlobAs } from '../lib/blobs'
import { hexOf, sha256Hex } from '../lib/hash'
import { NotAProject } from './openFile'
import { SENDABLE, type ProjectServer } from './server'

/** Pictures the relay has, as far as this tab knows. */
const onServer = new Set<string>()

const reachable = (a: DocAsset) => a.locations.some((l) => l.startsWith('https://'))

/** Send the pictures the relay cannot reach yet. `upload` is the relay's (POST /uploads, then PUT). */
export async function sendAssets(doc: ProductionDocument, upload: (blob: Blob, mime: InputMime) => Promise<unknown>): Promise<number> {
  let sent = 0
  for (const a of doc.assets) {
    if (onServer.has(a.sha256) || reachable(a) || !SENDABLE.includes(a.mime as InputMime)) continue
    const blob = await getBlob(a.sha256)
    if (!blob) continue // not in this browser: it came from elsewhere, and is wherever it came from
    await upload(blob, a.mime as InputMime)
    onServer.add(a.sha256)
    sent++
  }
  return sent
}

/** What a person calls a picture: its name, the shot it is the frame or clip of, or what it is. */
export function describeAsset(doc: ProductionDocument, a: Pick<DocAsset, 'sha256' | 'kind'>): string {
  const ref = doc.refs.find((r) => r.asset === a.sha256)
  if (ref) return `the picture @${ref.key}_${ref.variant}`
  const shotNo = (shotId: string) => doc.shots?.find((s) => s.id === shotId)?.order
  const frame = doc.frames?.find((f) => f.asset === a.sha256)
  if (frame) return `the frame of shot ${shotNo(frame.shot_id) ?? '?'}`
  const take = doc.takes?.find((t) => t.asset === a.sha256)
  if (take) return `a clip of shot ${shotNo(take.shot_id) ?? '?'}`
  if (doc.exports?.some((e) => e.asset === a.sha256)) return 'the rendered ad'
  return `${a.kind === 'video' ? 'a clip' : 'a picture'} (${hexOf(a.sha256).slice(0, 8)})`
}

export class MissingPictures extends NotAProject {}

/**
 * Put every picture and clip of `doc` this browser lacks into it, from the relay. Throws
 * MissingPictures, naming them, when any cannot be had: nothing is opened half-made.
 */
export async function fetchAssets(doc: ProductionDocument, server: Pick<ProjectServer, 'where' | 'download'>): Promise<number> {
  const missing: string[] = []
  let got = 0
  for (const a of doc.assets) {
    if (await getBlob(a.sha256)) continue
    const tries = a.locations.filter((l) => l.startsWith('https://'))
    let bytes: Uint8Array | null = null
    for (let i = 0; i <= tries.length && !bytes; i++) {
      const url = i < tries.length ? tries[i] : await server.where(a.sha256, a.mime, a.bytes ?? 1).catch(() => null)
      if (!url) break
      const b = await server.download(url)
      if (b && (await sha256Hex(b)) === hexOf(a.sha256)) bytes = b
    }
    if (!bytes) {
      missing.push(describeAsset(doc, a))
      continue
    }
    await putBlobAs(a.sha256, new Blob([bytes.slice().buffer as ArrayBuffer], { type: a.mime }))
    onServer.add(a.sha256)
    got++
  }
  if (missing.length) {
    const list = missing.length > 3 ? `${missing.slice(0, 3).join(', ')} and ${missing.length - 3} more` : missing.join(' and ')
    throw new MissingPictures(`${list.slice(0, 1).toUpperCase()}${list.slice(1)} could not be downloaded from the server. `
      + 'Open the project in the browser that made it and press Save, then try again.')
  }
  return got
}

/** For tests: forget what this tab sent. */
export function forgetSent() {
  onServer.clear()
}
