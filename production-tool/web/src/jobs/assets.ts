// Turning local hashes into AssetRefs the relay and providers can read.

import type { AssetRef, InputMime, ProductionDocument, Region } from '../contracts/types'
import { getBlob, putBlob } from '../lib/blobs'
import { boxMaskPng } from '../lib/mask'
import { fitForSending } from '../lib/fitImage'
import type { Relay } from '../relay'
import { RelayError } from '../relay'

const uploaded = new Map<string, AssetRef>()

/** Where the relay already keeps an asset's bytes: its first https location (a relay output, out/ or ads/). */
export function remoteUrl(doc: Pick<ProductionDocument, 'assets'>, sha: string | undefined): string | undefined {
  if (!sha) return undefined
  return doc.assets.find((a) => a.sha256 === sha)?.locations?.find((l) => l.startsWith('https://'))
}

/** `doc`: when given, a video the relay made (an https location) is named by that location and not
 *  uploaded again from this browser (features/video-stage-findings.clan): Render ad re-sent every
 *  clip, failed on clips over the upload limit, and said "A picture is missing" when this browser
 *  no longer had the bytes. Pictures always go through the fit below. */
export async function assetRef(relay: Relay, sha: string, doc?: Pick<ProductionDocument, 'assets'>): Promise<AssetRef> {
  const hit = uploaded.get(sha)
  if (hit) return hit
  const known = doc?.assets.find((a) => a.sha256 === sha)
  const at = doc && known?.kind === 'video' && known.mime === 'video/mp4' ? remoteUrl(doc, sha) : undefined
  if (at) return { sha256: sha, url: at, mime: 'video/mp4' }
  const blob = await getBlob(sha)
  if (!blob) throw new RelayError({ code: 'invalid_input', message: 'A picture is missing from this browser. Add it again.', retryable: false })
  // Fitted again here: every input passes through, including pictures added before a size rule
  // (2026-10-07: a 361x251 picture made before the fit failed on fal's 300x300 minimum).
  const sent = await fitForSending(blob)
  const mime = (sent.type || 'image/png') as InputMime
  const res = await relay.upload(sent, mime)
  const ref: AssetRef = { sha256: res.sha256, url: res.url, mime }
  uploaded.set(sha, ref)
  return ref
}

/**
 * A box on the picture `sha` as a mask input, for a region edit with no painted mask: fal's edit
 * model takes only masks, and the director drops the mask where a provider takes none
 * (features/harness-refusals.clan). Undefined when this browser cannot read the picture's size;
 * the edit then goes by the box alone.
 */
export async function boxMaskRef(relay: Relay, sha: string, region: Region): Promise<AssetRef | undefined> {
  const blob = await getBlob(sha)
  if (!blob || typeof createImageBitmap === 'undefined') return undefined
  let w: number, h: number
  try {
    const bmp = await createImageBitmap(blob)
    ;[w, h] = [bmp.width, bmp.height]
    bmp.close?.()
  } catch {
    return undefined
  }
  return assetRef(relay, await putBlob(await boxMaskPng(region, w, h)))
}
