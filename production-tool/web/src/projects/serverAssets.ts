// A project's pictures and clips on the relay (features/personal-workspaces.clan), so it opens in
// another browser with every one of them.
//   - Saving sends each picture this browser holds to in/<sha256>, by its own hash, once per session. The relay
//     says "exists" for one it has, and nothing travels: a location in the document is never taken as proof that
//     THIS relay has it (an Export's pictures point at the relay that made them; opened on another, 20 of 23 404ed).
//   - Opening fetches each one this browser lacks: from the media base by its hash, else from in/<sha256> by the relay;
//     the bytes must hash to the name. One that cannot be found stops the open and is named.

import type { DocAsset, InputMime, ProductionDocument } from '../contracts/types'
import { getBlob, putBlobAs } from '../lib/blobs'
import { framesOf, refsList, shotName, takesOf, takeVersion } from '../model/selectors'
import { hexOf, sha256Hex } from '../lib/hash'
import { mediaUrls } from '../lib/media'
import { idbGet, idbPut } from '../lib/idb'
import { NotAProject } from './openFile'
import { SENDABLE, type ProjectServer } from './server'

/** Pictures the relay has, as far as this browser knows: kept between page loads (re-test N6: every new
 *  page asked POST /uploads again, once per picture, for pictures it had sent or brought down before). */
const onServer = new Set<string>()
const HAS_KEY = 'relay-has'
const HAS_MAX = 20_000
let restored: Promise<void> | null = null
const restore = () => (restored ??= idbGet<string[]>('kv', HAS_KEY).then((v) => { for (const sha of v ?? []) onServer.add(sha) }, () => {}))
let keeping: ReturnType<typeof setTimeout> | null = null
/** Remember them, once the burst is over (a cold open brings dozens down at once). */
function remember(sha: string) {
  onServer.add(sha)
  if (keeping) return
  keeping = setTimeout(() => {
    keeping = null
    void idbPut('kv', HAS_KEY, [...onServer].slice(-HAS_MAX)).catch(() => {})
  }, 500)
}

/** Make sure the relay has every picture this browser holds. `upload` is the relay's (POST /uploads, then PUT when it lacks it). */
export async function sendAssets(doc: ProductionDocument, upload: (blob: Blob, mime: InputMime) => Promise<unknown>): Promise<number> {
  let sent = 0
  await restore()
  for (const a of Object.values(doc.assets)) {
    if (onServer.has(a.sha256) || !SENDABLE.includes(a.mime as InputMime)) continue
    const blob = await getBlob(a.sha256)
    if (!blob) continue // not in this browser: it came from elsewhere, and is wherever it came from
    await upload(blob, a.mime as InputMime)
    remember(a.sha256)
    sent++
  }
  return sent
}

/** What a person calls a picture: its name, the shot it is the frame or clip of, or what it is. */
export function describeAsset(doc: ProductionDocument, a: Pick<DocAsset, 'sha256' | 'kind'>): string {
  const ref = refsList(doc).find((r) => r.asset === a.sha256)
  if (ref) return `the picture @${ref.key}_${ref.variant}`
  for (const s of Object.values(doc.shots)) {
    const frame = framesOf(doc, s.id).find((f) => f.asset === a.sha256)
    if (frame) return `frame v${frame.version} of ${shotName(doc, s.id)}`
    const t = takesOf(doc, s.id).find((x) => x.asset === a.sha256)
    if (t) return `clip v${takeVersion(doc, t.id)} of ${shotName(doc, s.id)}`
  }
  const render = Object.values(doc.renders).find((r) => r.asset === a.sha256)
  if (render) return `the rendered ad (v${render.version})`
  if (Object.values(doc.exports).some((e) => e.asset === a.sha256)) return 'an export'
  return `${a.kind === 'video' ? 'a clip' : 'a picture'} (${hexOf(a.sha256).slice(0, 8)})`
}

export class MissingPictures extends NotAProject {}

/**
 * Put every picture and clip of `doc` this browser lacks into it, from the relay. Throws
 * MissingPictures, naming them, when any cannot be had: nothing is opened half-made.
 */
/** How many pictures and clips come down at once (a browser keeps about six connections to one host). */
export const FETCH_AT_ONCE = 6

export async function fetchAssets(doc: ProductionDocument, server: Pick<ProjectServer, 'where' | 'download'>, docId: string): Promise<number> {
  const missing: string[] = []
  let got = 0
  let bytesIn = 0
  const t0 = performance.now()
  // One picture: where it is (the media base by its hash, else the relay's by-hash route), its bytes, its hash.
  const one = async (a: DocAsset) => {
    if (await getBlob(a.sha256)) return
    // By its hash only: the media base's in/ and out/, then the relay's by-hash route. An address the document
    // carries is never fetched (S1-16, S1-17).
    const tries = mediaUrls(a)
    let bytes: Uint8Array | null = null
    for (let i = 0; i <= tries.length && !bytes; i++) {
      const url = i < tries.length ? tries[i] : await server.where(docId, a.sha256, a.mime, a.bytes ?? 1).catch(() => null)
      if (!url) break
      const b = await server.download(url)
      if (b && (await sha256Hex(b)) === hexOf(a.sha256)) bytes = b
    }
    if (!bytes) {
      missing.push(describeAsset(doc, a))
      return
    }
    await putBlobAs(a.sha256, new Blob([bytes.slice().buffer as ArrayBuffer], { type: a.mime }))
    remember(a.sha256)
    got++
    bytesIn += bytes.byteLength
  }
  // Several at once, not one after another: a server-only project with dozens of frames and takes sat on
  // "Opening…" for about 20 s in a fresh browser, each picture waiting on the last (live test 2026-11-16).
  const queue = Object.values(doc.assets)
  await Promise.all(Array.from({ length: Math.min(FETCH_AT_ONCE, queue.length) }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) await one(a)
  }))
  if (got) console.info(`[open] ${got} pictures and clips (${Math.round(bytesIn / 1024)} KB) came down in ${Math.round(performance.now() - t0)} ms`)
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
  restored = Promise.resolve()
}
