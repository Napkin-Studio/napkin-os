// Turning local hashes into AssetRefs the relay and providers can read.

import type { AssetRef, InputMime, ProductionDocument } from '../contracts/types'
import { getBlob } from '../lib/blobs'
import { fitForSending } from '../lib/fitImage'
import { resolveMediaUrl } from '../lib/media'
import type { Relay } from '../relay'
import { RelayError } from '../relay'

const uploaded = new Map<string, AssetRef>()
/** Uploads on the way: a second ask for the same picture waits for the first (QA 2026-11-17: Update sizes sent 8
 *  sizes of a new master at once, each uploading it, and one failed with UnidentifiedImageError). */
const inflight = new Map<string, Promise<AssetRef>>()

/** `doc`: when given, a video the relay made (found by its hash at the media base, lib/media.ts) is named by that address and not
 *  uploaded again from this browser (features/video-stage-findings.clan): Render ad re-sent every
 *  clip, failed on clips over the upload limit, and said "A picture is missing" when this browser
 *  no longer had the bytes. Pictures always go through the fit below. */
export async function assetRef(relay: Relay, sha: string, doc?: Pick<ProductionDocument, 'assets'>): Promise<AssetRef> {
  const hit = uploaded.get(sha)
  if (hit) return hit
  const going = inflight.get(sha)
  if (going) return going
  const p = upload(relay, sha, doc).finally(() => inflight.delete(sha))
  inflight.set(sha, p)
  return p
}

async function upload(relay: Relay, sha: string, doc?: Pick<ProductionDocument, 'assets'>): Promise<AssetRef> {
  const known = doc?.assets[sha]
  const at = known && known.kind === 'video' && known.mime === 'video/mp4' && (known.origin === 'generated' || known.origin === 'mock') ? await resolveMediaUrl(known) : null
  if (at) return { sha256: sha, url: at, mime: 'video/mp4' }
  const blob = await getBlob(sha)
  if (!blob) throw new RelayError({ code: 'invalid_input', message: 'A picture is missing from this browser. Add it again.', retryable: false })
  // Fitted again here: every input passes through, including pictures added before a size rule
  // (2026-10-07: a 361x251 picture made before the fit failed on a provider's 300x300 minimum).
  const sent = await fitForSending(blob)
  const mime = (sent.type || 'image/png') as InputMime
  const res = await relay.upload(sent, mime)
  const ref: AssetRef = { sha256: res.sha256, url: res.url, mime }
  uploaded.set(sha, ref)
  return ref
}

const logos = new Map<string, Promise<AssetRef>>()
/** A logo for the end card or a size: sent as it is, never fitted for a provider (fitImage pads a picture wider than 2.5:1
 *  with white, which put a wide wordmark on a white box on the end card). Its bytes from this browser, uploaded once. */
export function logoRef(relay: Relay, sha: string, doc?: Pick<ProductionDocument, 'assets'>): Promise<AssetRef> {
  const going = logos.get(sha)
  if (going) return going
  const p = (async () => {
    const blob = await getBlob(sha)
    if (!blob) throw new RelayError({ code: 'invalid_input', message: 'The logo is missing from this browser. Add it again.', retryable: false })
    const mime = (blob.type || doc?.assets[sha]?.mime || 'image/png') as InputMime
    const res = await relay.upload(blob, mime)
    return { sha256: res.sha256, url: res.url, mime }
  })()
  logos.set(sha, p)
  p.catch(() => logos.delete(sha))
  return p
}
